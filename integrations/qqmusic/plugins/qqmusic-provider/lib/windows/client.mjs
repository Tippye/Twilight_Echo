import { buildWindowsComm, buildWindowsSignatureMetadata, WINDOWS_CLIENT_VERSION } from './comm.mjs'
import { nativeSigned64 } from './json-integer.mjs'
import {
  buildWindowsQQCodeLoginCall, buildWindowsQQTokenLoginCall,
  buildWindowsQQTokenRefreshCall, buildWindowsQQMusicKeyRefreshCall,
  WINDOWS_LOGIN_REQUEST_KEY, WINDOWS_QQ_TOKEN_REFRESH_REQUEST_KEY,
  WINDOWS_QQ_MUSIC_KEY_REFRESH_REQUEST_KEY
} from './login-request.mjs'
import { extractWindowsLoginSession, parseWindowsRpcResponse, WindowsRpcError } from './response.mjs'
import { buildWindowsSignedRequest, WINDOWS_SIGNED_ENDPOINT } from './wire.mjs'

export const WINDOWS_AUTH_KEY = 'windows-auth'
export { WINDOWS_CLIENT_VERSION } from './comm.mjs'
export const WINDOWS_USER_AGENT =
  'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)'
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10000
const VERIFIED_TTL_MS = 60000
const ISSUER_ORIGIN = new URL(WINDOWS_SIGNED_ENDPOINT).origin
const REDIRECT_CODES = new Set([301, 302, 307, 308])
// Protocol OnEvt_RefreshToken explicitly clears cached access material for these codes.
const CREDENTIAL_REJECTION_CODES = new Set([1000, 104401, 101010])
const SESSION_STRINGS = ['openid', 'access_token', 'refresh_token', 'musickey', 'unionid',
  'refresh_key', 'encryptUin']
const SESSION_INT64 = ['expired_at', 'musicid', 'musickeyCreateTime']

export class WindowsHttpError extends Error {
  constructor(status) {
    super(`QQ 音乐 HTTP 请求失败（${status}）`)
    this.name = 'WindowsHttpError'
    this.status = status
  }
}

function abortError() {
  const error = new Error('QQ 音乐请求已取消')
  error.name = 'AbortError'
  return error
}

function networkError() {
  const error = new Error('QQ 音乐请求失败，请稍后重试')
  error.name = 'WindowsNetworkError'
  return error
}

function invalidResponse() {
  const error = new Error('QQ 音乐返回了无效响应')
  error.name = 'WindowsResponseError'
  return error
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fingerprint(session) {
  return session ? JSON.stringify(session) : null
}

function normalizedSession(value) {
  try {
    const session = extractWindowsLoginSession(value)
    return session.loginType === 2 ? session : null
  } catch {
    return null
  }
}

function waitFor(promise, signal) {
  if (!signal) return Promise.resolve(promise)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError())
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', cancel)
    })
  })
}

/** Bound the bytes actually received, including a decompressed fetch body. */
async function readResponse(response, signal) {
  const body = response.body
  if (!body) throw invalidResponse()
  const chunks = []
  let size = 0
  const append = (chunk) => {
    if (!(chunk instanceof Uint8Array)) throw invalidResponse()
    size += chunk.byteLength
    if (size > MAX_RESPONSE_BYTES) throw invalidResponse()
    chunks.push(Buffer.from(chunk))
  }
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { value, done } = await waitFor(reader.read(), signal)
        if (done) break
        append(value)
      }
    } catch (error) {
      reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
  } else {
    throw invalidResponse()
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } catch {
    throw invalidResponse()
  }
}

/** CAFcf reads every native field; missing fields are not a proved partial refresh contract. */
function parseNativeRefresh(data) {
  if (!object(data)) throw invalidResponse()
  const result = {}
  for (const key of SESSION_STRINGS) {
    if (!Object.hasOwn(data, key) || typeof data[key] !== 'string' || data[key].includes('\0')) {
      throw invalidResponse()
    }
    result[key] = data[key]
  }
  for (const key of SESSION_INT64) {
    if (!Object.hasOwn(data, key)) throw invalidResponse()
    const value = data[key]
    const decimal = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
    try { result[key] = nativeSigned64(decimal).rawJSON }
    catch { throw invalidResponse() }
  }
  if (!Number.isInteger(data.loginType) || data.loginType < -0x80000000 || data.loginType > 0x7fffffff) {
    throw invalidResponse()
  }
  result.loginType = data.loginType
  return result
}

function loginOptions(session, deviceName) {
  return { openid: session.openid, musickey: session.musickey, expiredIn: session.expired_at,
    musicId: session.musicid, refreshKey: session.refresh_key, accessToken: session.access_token,
    refreshToken: session.refresh_token, deviceName }
}

/** Owns Windows credentials; stored bytes become UI login state only after remote confirmation. */
export class WindowsMusicClient {
  #settings
  #getDevice
  #fetch
  #now
  #epoch = 0
  #closed = false
  #controllers = new Set()
  #writes = Promise.resolve()
  #checks = Promise.resolve()
  #verified = null
  #excellent = null

  constructor({ settings, getDevice, fetch = globalThis.fetch, now = Date.now } = {}) {
    if (!settings || typeof settings.get !== 'function' || typeof settings.set !== 'function' ||
      typeof settings.delete !== 'function' || typeof getDevice !== 'function' ||
      typeof fetch !== 'function' || typeof now !== 'function') {
      throw new TypeError('Windows client requires settings, device and fetch owners')
    }
    this.#settings = settings
    this.#getDevice = getDevice
    this.#fetch = fetch
    this.#now = now
  }

  #assert(epoch, signal) {
    if (this.#closed || epoch !== this.#epoch || signal?.aborted) throw abortError()
  }

  #time() {
    const value = this.#now()
    if (!Number.isSafeInteger(value)) throw new Error('QQ 音乐系统时间无效')
    return value
  }

  #advance() {
    this.#epoch += 1
    this.#verified = null
    this.#excellent = null
    for (const controller of this.#controllers) controller.abort()
  }

  #scope(signal) {
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS)
    timer.unref?.()
    this.#controllers.add(controller)
    return { signal: controller.signal, release: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      this.#controllers.delete(controller)
    } }
  }

  async #stored(epoch) {
    await this.#writes
    this.#assert(epoch)
    let result
    try { result = normalizedSession(await this.#settings.get(WINDOWS_AUTH_KEY)) }
    catch { throw new Error('QQ 音乐会话存储不可用') }
    this.#assert(epoch)
    return result
  }

  async #device(epoch, signal) {
    this.#assert(epoch, signal)
    const scope = this.#scope(signal)
    try {
      const device = await waitFor(this.#getDevice(), scope.signal)
      this.#assert(epoch, scope.signal)
      if (!object(device)) throw invalidResponse()
      return { ...device }
    } catch (error) {
      if (scope.signal.aborted || this.#closed || epoch !== this.#epoch || error?.name === 'AbortError') throw abortError()
      throw new Error('QQ 音乐设备信息不可用')
    } finally {
      scope.release()
    }
  }

  #enqueue(operation) {
    const result = this.#writes.then(async () => {
      try { return await operation() }
      catch (error) {
        if (error?.name === 'AbortError') throw abortError()
        throw new Error('QQ 音乐会话存储不可用')
      }
    })
    this.#writes = result.catch(() => {})
    return result
  }

  async #commit(session, epoch, expected, device, verified, signal) {
    return this.#enqueue(async () => {
      this.#assert(epoch, signal)
      const previous = await this.#settings.get(WINDOWS_AUTH_KEY)
      this.#assert(epoch, signal)
      if (expected !== undefined) {
        const current = normalizedSession(previous)
        if (fingerprint(current) !== expected) throw abortError()
      }
      await this.#settings.set(WINDOWS_AUTH_KEY, { ...session })
      if (this.#closed || epoch !== this.#epoch || signal?.aborted) {
        // A settings write already started cannot be aborted. Restore its predecessor
        // inside the same queue before a replacement login or logout can write.
        if (previous === undefined) await this.#settings.delete(WINDOWS_AUTH_KEY)
        else await this.#settings.set(WINDOWS_AUTH_KEY, previous)
      }
      this.#assert(epoch, signal)
      this.#verified = verified ? { session: fingerprint(session), guid: device.guid,
        at: this.#time() } : null
    })
  }

  async #reject(epoch, expected) {
    this.#verified = null
    this.#excellent = null
    return this.#enqueue(async () => {
      this.#assert(epoch)
      const current = normalizedSession(await this.#settings.get(WINDOWS_AUTH_KEY))
      this.#assert(epoch)
      if (fingerprint(current) === expected) await this.#settings.delete(WINDOWS_AUTH_KEY)
      this.#assert(epoch)
    })
  }

  async getSession() {
    const session = await this.#stored(this.#epoch)
    return session ? { ...session } : null
  }

  async request(key, call, { signal, session, includeUid = false, includeOpenUdid = false } = {}) {
    const epoch = this.#epoch
    this.#assert(epoch)
    const scope = this.#scope(signal)
    let activeResponse
    try {
      if (typeof key !== 'string' || key.length === 0 || key === 'comm' || key.includes('\0') ||
        !object(call) || typeof call.module !== 'string' || typeof call.method !== 'string' ||
        !object(call.param) || typeof includeUid !== 'boolean' || typeof includeOpenUdid !== 'boolean') {
        throw new TypeError('Windows RPC call is invalid')
      }
      const device = await this.#device(epoch, scope.signal)
      this.#assert(epoch)
      session = session === undefined ? await this.#stored(epoch) : session
      if (session !== null && session !== undefined) {
        session = normalizedSession(session)
        if (!session) throw new Error('QQ 音乐会话无效')
      }
      const identity = session?.musicid ?? '0'
      const comm = buildWindowsComm({ uin: identity, versionMain: WINDOWS_CLIENT_VERSION.main,
        versionSub: WINDOWS_CLIENT_VERSION.sub, wid: device.wid, openid: session?.openid ?? '',
        accessToken: session?.access_token ?? '', accessTokenExpiresAt: session?.expired_at ?? '0',
        unionId: session?.unionid ?? '', musickey: session?.musickey ?? '', guid: device.guid,
        tmeLoginType: session?.loginType ?? 2, includeOpenUdid,
        uid: includeUid && session ? session.musicid : undefined, meshDevops: device.meshDevops ?? '',
        channelId: device.channelId, encodedOsVersion: device.encodedOsVersion })
      const metadata = buildWindowsSignatureMetadata({ fullVersion: WINDOWS_CLIENT_VERSION.full,
        accountIdentity: identity, unixTime: String(Math.floor(this.#time() / 1000)), guid: device.guid })
      const signed = buildWindowsSignedRequest(Buffer.from(JSON.stringify({ comm, [key]: call }), 'utf8'), metadata)
      const headers = { ...signed.headers, 'User-Agent': WINDOWS_USER_AGENT, Accept: '*/*',
        'Accept-Language': 'zh-CN', 'Accept-Encoding': 'gzip, deflate',
        // Observed SDK constructor default1; actual vkey caller override remains unproved.
        'Content-Type': 'application/x-www-form-urlencoded' }
      let url = signed.url
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        this.#assert(epoch)
        const pending = this.#fetch(url, { method: signed.method, headers, body: signed.body,
          redirect: 'manual', signal: scope.signal })
        const response = await waitFor(Promise.resolve(pending).then((value) => {
          if (scope.signal.aborted) {
            value.body?.cancel().catch(() => {})
            throw abortError()
          }
          return value
        }), scope.signal)
        activeResponse = response
        this.#assert(epoch)
        if (response.url && new URL(response.url).origin !== ISSUER_ORIGIN) throw new WindowsHttpError(response.status)
        if (REDIRECT_CODES.has(response.status)) {
          const location = response.headers.get('location')
          let next
          try { next = new URL(location, url) } catch { throw new WindowsHttpError(response.status) }
          if (!location || next.origin !== ISSUER_ORIGIN || next.username || next.password || redirects === 3) {
            throw new WindowsHttpError(response.status)
          }
          response.body?.cancel().catch(() => {})
          url = next.href
          continue
        }
        if (!response.ok) throw new WindowsHttpError(response.status)
        const text = await readResponse(response, scope.signal)
        this.#assert(epoch)
        try { return parseWindowsRpcResponse(text, key) }
        catch (error) {
          if (error instanceof WindowsRpcError) throw error
          throw invalidResponse()
        }
      }
      throw invalidResponse()
    } catch (error) {
      if (scope.signal.aborted || this.#closed || epoch !== this.#epoch || error?.name === 'AbortError') throw abortError()
      if (error instanceof WindowsHttpError || error instanceof WindowsRpcError || error?.name === 'WindowsResponseError') throw error
      throw networkError()
    } finally {
      if (activeResponse?.body && !activeResponse.body.locked) {
        activeResponse.body.cancel().catch(() => {})
      }
      scope.release()
    }
  }

  async loginWithQQCode(code, { signal } = {}) {
    if (typeof code !== 'string' || code.length === 0 || code.includes('\0')) throw new Error('QQ 音乐授权码无效')
    this.#assert(this.#epoch, signal)
    this.#advance()
    const epoch = this.#epoch
    const device = await this.#device(epoch, signal)
    this.#assert(epoch, signal)
    const data = await this.request(WINDOWS_LOGIN_REQUEST_KEY,
      buildWindowsQQCodeLoginCall({ code, deviceName: device.deviceName }), { signal, session: null })
    this.#assert(epoch, signal)
    const session = normalizedSession(data)
    if (!session) throw invalidResponse()
    await this.#commit(session, epoch, undefined, device, true, signal)
    return true
  }

  async #refreshToken(session, device, signal) {
    const data = await this.request(WINDOWS_QQ_TOKEN_REFRESH_REQUEST_KEY,
      buildWindowsQQTokenRefreshCall(loginOptions(session, device.deviceName)), { signal, session })
    const fresh = parseNativeRefresh(data)
    // ac57c updates these fields and retains existing musickey/refresh_token/creation time.
    const result = normalizedSession({ ...session, openid: fresh.openid, access_token: fresh.access_token,
      expired_at: fresh.expired_at, musicid: fresh.musicid, refresh_key: fresh.refresh_key })
    if (!result || result.musicid !== session.musicid) throw invalidResponse()
    return result
  }

  async checkLogin({ signal } = {}) {
    const epoch = this.#epoch
    this.#assert(epoch, signal)
    const result = this.#checks.then(() => this.#checkLogin(epoch, signal))
    this.#checks = result.catch(() => {})
    return waitFor(result, signal)
  }

  /** The native Excellent gate is identity.HugeVip (JsonCpp signed Int), not
   * ordinary login/svip. Cache only this current session/device, in memory. */
  async getExcellentCapability({ signal } = {}) {
    const epoch = this.#epoch
    this.#assert(epoch, signal)
    if (!await this.checkLogin({ signal })) return { known: true, available: false, reason: 'login' }
    const session = await this.#stored(epoch)
    const expected = fingerprint(session)
    if (!session) throw abortError()
    const device = await this.#device(epoch, signal)
    const assertOwner = async () => {
      this.#assert(epoch, signal)
      if (fingerprint(await this.#stored(epoch)) !== expected ||
          (await this.#device(epoch, signal)).guid !== device.guid) throw abortError()
      this.#assert(epoch, signal)
    }
    await assertOwner()
    const time = this.#time()
    if (this.#excellent?.session === expected && this.#excellent.guid === device.guid &&
        time >= this.#excellent.at && time - this.#excellent.at < VERIFIED_TTL_MS) {
      return { ...this.#excellent.result }
    }
    const data = await this.request('VipLogin.VipLoginInter.vip_login_base', {
      module: 'VipLogin.VipLoginInter', method: 'vip_login_base', param: {}
    }, { session, signal })
    await assertOwner()
    const value = object(data?.identity) && Object.hasOwn(data.identity, 'HugeVip')
      ? data.identity.HugeVip : undefined
    const known = typeof value === 'number' && Number.isInteger(value) &&
      value >= -0x80000000 && value <= 0x7fffffff
    const result = { known, available: known && value !== 0,
      ...(!known ? { reason: 'unknown' } : value === 0 ? { reason: 'membership' } : {}) }
    this.#excellent = { session: expected, guid: device.guid, at: this.#time(), result }
    return { ...result }
  }

  async #checkLogin(epoch, signal) {
    this.#assert(epoch, signal)
    const stored = await this.#stored(epoch)
    if (!stored) { this.#verified = null; return false }
    const expected = fingerprint(stored)
    const device = await this.#device(epoch, signal)
    this.#assert(epoch, signal)
    const time = this.#time()
    const expired = BigInt(stored.expired_at) <= BigInt(Math.floor(time / 1000))
    if (!expired && this.#verified?.session === expected && this.#verified.guid === device.guid &&
      time >= this.#verified.at && time - this.#verified.at < VERIFIED_TTL_MS) return true
    this.#verified = null
    try {
      if (expired && stored.refresh_token.length === 0) { await this.#reject(epoch, expected); return false }
      const session = expired ? await this.#refreshToken(stored, device, signal) : stored
      this.#assert(epoch, signal)
      const data = await this.request(WINDOWS_LOGIN_REQUEST_KEY,
        buildWindowsQQTokenLoginCall(loginOptions(session, device.deviceName)), { signal, session })
      this.#assert(epoch, signal)
      const confirmed = normalizedSession(data)
      if (!confirmed || confirmed.musicid !== stored.musicid) throw invalidResponse()
      await this.#commit(confirmed, epoch, expected, device, true, signal)
      return true
    } catch (error) {
      if (error instanceof WindowsRpcError) {
        if (CREDENTIAL_REJECTION_CODES.has(error.code)) await this.#reject(epoch, expected)
        return false
      }
      throw error
    }
  }

  async refreshMusicKey({ signal } = {}) {
    const epoch = this.#epoch
    this.#assert(epoch, signal)
    const session = await this.#stored(epoch)
    if (!session) return false
    const device = await this.#device(epoch, signal)
    this.#assert(epoch, signal)
    const expected = fingerprint(session)
    this.#verified = null
    try {
      const data = await this.request(WINDOWS_QQ_MUSIC_KEY_REFRESH_REQUEST_KEY,
        buildWindowsQQMusicKeyRefreshCall(loginOptions(session, device.deviceName)), { signal, session })
      this.#assert(epoch, signal)
      const fresh = normalizedSession(data)
      if (!fresh || fresh.musicid !== session.musicid) throw invalidResponse()
      await this.#commit(fresh, epoch, expected, device, false, signal)
      return true
    } catch (error) {
      if (error instanceof WindowsRpcError) {
        if (CREDENTIAL_REJECTION_CODES.has(error.code)) await this.#reject(epoch, expected)
        return false
      }
      throw error
    }
  }

  async logout() {
    this.#advance()
    await this.#enqueue(() => this.#settings.delete(WINDOWS_AUTH_KEY))
  }

  /** Invalidate pending requests while retaining the session from before their writes. */
  async cancelPending() {
    this.#assert(this.#epoch)
    this.#advance()
    await this.#writes
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#advance()
  }

  deactivate() { this.close() }
}
