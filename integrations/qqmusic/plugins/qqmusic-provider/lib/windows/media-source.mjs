import { createHash } from 'node:crypto'
import { buildWindowsMediaFilename } from './filename.mjs'
import { buildWindowsVkeyCall } from './vkey-request.mjs'
import { inspectWindowsMediaTail, validateWindowsAudioHeader } from './container.mjs'
import { WindowsMediaStream } from './media-stream.mjs'
import { WINDOWS_USER_AGENT } from './client.mjs'
import { windowsQualityDefinition } from './quality.mjs'

export const WINDOWS_MEDIA_ALLOWED_ORIGINS = Object.freeze([
  'https://dl.stream.qqmusic.qq.com', 'https://isure.stream.qqmusic.qq.com'
])
const ORIGINS = new Set(WINDOWS_MEDIA_ALLOWED_ORIGINS)
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const MAX_UINT64 = 0xffffffffffffffffn
const TIMEOUT_MS = 10000
// Adapter transport lease only; the server's expiration field semantics are not inferred.
const CACHE_MS = 60000
const MID = /^[a-zA-Z0-9]{14}$/
const HEADERS = Object.freeze({ 'User-Agent': WINDOWS_USER_AGENT, Accept: '*/*' })
const failureCodes = new Set(['SOURCE', 'LOGIN', 'DEVICE', 'LENGTH', 'URL', 'ORIGIN',
  'VKEY_RESPONSE', 'VKEY_RETCODE', 'VKEY_ITEMS', 'VKEY_FILENAME', 'VKEY_SONGMID', 'VKEY_EMPTY',
  'REDIRECT', 'ENCODING', 'BODY', 'TRUNCATED', 'RANGE', 'HEADER', 'IDENTITY', 'KEY',
  'CONFIG', 'QUALITY', 'QUALITY_UNAVAILABLE', 'QUALITY_IDENTITY', 'SONG', 'TIME', 'SESSION', 'CLOSED', 'CONTAINER'])
const ownedFailureCodes = new WeakMap()
const ownedCancellations = new WeakSet()

function failureMessage(code, phase) {
  if (code === 'QUALITY_UNAVAILABLE') return '当前歌曲未提供所选音质'
  if (code === 'QUALITY_IDENTITY') return '当前歌曲缺少所选音质的媒体标识'
  if (code === 'LOGIN') return '请先使用手机 QQ 扫码登录'
  if (code === 'VKEY_EMPTY') return 'QQ 音乐未返回所选音质的播放地址'
  if (Number.isSafeInteger(code)) return phase === 'http' ? `QQ 音乐音频请求失败（HTTP ${code}）`
    : phase === 'vkey' ? `QQ 音乐服务端拒绝所选音质（${code}）`
      : `QQ 音乐播放源请求失败（${code}）`
  if (['KEY', 'HEADER', 'CONTAINER'].includes(code)) return 'QQ 音乐所选音质的音频格式或解密验证失败'
  if (typeof code === 'string' && code.startsWith('VKEY_')) return 'QQ 音乐所选音质的播放地址响应无效'
  return 'QQ 音乐播放源无法验证'
}
function failure(code = 'SOURCE', phase = 'source', recoverableQuality = false, qualityOwner = null) {
  const safeCode = Number.isSafeInteger(code) || failureCodes.has(code) ? code : 'SOURCE'
  const error = new Error(failureMessage(safeCode, phase))
  error.name = 'WindowsPlaybackSourceError'
  error.code = safeCode
  ownedFailureCodes.set(error, { code: safeCode, phase, recoverableQuality, qualityOwner })
  return error
}
// Only privately created failures can authorize trying another format. Public
// error fields may be mutated or spoofed by injected transport implementations.
export function windowsPlaybackFailureDetails(error) {
  const owned = ownedFailureCodes.get(error)
  return owned ? { code: owned.code, message: failureMessage(owned.code, owned.phase),
    recoverableQuality: owned.recoverableQuality } : null
}
function aborted() {
  const error = new Error('QQ 音乐播放源请求已取消')
  error.name = 'AbortError'
  ownedCancellations.add(error)
  return error
}
function check(signal) { if (signal.aborted) throw aborted() }
function normalizedError(error, signal, phase, qualityOwner) {
  try {
    if (signal.aborted) return aborted()
    // Errors exposed by this module can be caught, mutated and rethrown by an
    // injected client. Rebuild them from the original private code only.
    if (ownedFailureCodes.has(error)) {
      const owned = ownedFailureCodes.get(error)
      return failure(owned.code, owned.phase,
        owned.recoverableQuality && owned.qualityOwner === qualityOwner, qualityOwner)
    }
    if (error?.name === 'AbortError') return aborted()
    const code = error?.code
    if (Number.isSafeInteger(code)) return failure(code, phase)
  } catch {}
  return failure('SOURCE')
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function sessionFingerprint(session) {
  if (!session || session.loginType !== 2 || typeof session.musicid !== 'string' ||
    session.musicid.length > 20 || !/^\d+$/.test(session.musicid) ||
    BigInt(session.musicid) <= 0n || BigInt(session.musicid) > MAX_UINT64) throw failure('LOGIN')
  return hash(JSON.stringify(session))
}
export { sessionFingerprint as windowsPlaybackSessionFingerprint }
function deviceGuid(device) {
  if (!device || typeof device.guid !== 'string' || !device.guid ||
    device.guid.length > 256 || device.guid.includes('\0')) throw failure('DEVICE')
  return device.guid
}
function cancelBody(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}) } catch {}
}
function wait(promise, signal, discard) {
  if (signal.aborted) {
    Promise.resolve(promise).then(discard, () => {}).catch(() => {})
    return Promise.reject(aborted())
  }
  return new Promise((resolve, reject) => {
    let finished = false
    const cancel = () => { if (!finished) { finished = true; reject(aborted()) } }
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', cancel)
      if (finished) { try { Promise.resolve(discard?.(value)).catch(() => {}) } catch {}; return }
      finished = true
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', cancel)
      if (!finished) { finished = true; reject(error) }
    })
  })
}
function unsigned(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || value.length > 20) throw failure('LENGTH')
  const number = BigInt(value)
  if (number > MAX_UINT64) throw failure('LENGTH')
  return number
}
function url(value, base, upgrade = false) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw failure('URL')
  }
  let parsed
  try { parsed = new URL(value, base) } catch { throw failure('URL') }
  if (parsed.username || parsed.password || parsed.hash || parsed.port) throw failure('ORIGIN')
  if (upgrade && parsed.protocol === 'http:') parsed.protocol = 'https:'
  if (parsed.protocol !== 'https:' || !ORIGINS.has(parsed.origin)) throw failure('ORIGIN')
  return parsed.href
}
function businessCode(value) {
  return Number.isSafeInteger(value) && value !== 0 ? value : 'VKEY_RESPONSE'
}
function sourceURL(data, filename, songmid, qualityOwner) {
  const retcode = data?.retcode
  if (!data || retcode !== 0) throw failure(Number.isSafeInteger(retcode) && retcode !== 0 ? retcode : 'VKEY_RETCODE', 'vkey', retcode === 22, qualityOwner)
  if (!Array.isArray(data.midurlinfo) || data.midurlinfo.length !== 1) throw failure('VKEY_ITEMS')
  const row = data.midurlinfo[0]
  if (!row || row.filename !== filename) throw failure('VKEY_FILENAME')
  if (row.songmid !== songmid) throw failure('VKEY_SONGMID')
  const result = row.result
  if (result !== 0) throw failure(businessCode(result), 'vkey', result === 22, qualityOwner)
  if (typeof row.purl !== 'string' || !row.purl) throw failure('VKEY_EMPTY', 'vkey', true, qualityOwner)
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(row.purl)
  // Actual Windows Vkey can issue a relative purl without sip. This fixed official
  // CDN is an adapter choice and is accepted only after HTTPS byte/header preflight.
  const base = absolute ? undefined : Array.isArray(data.sip) && data.sip.length
    ? url(data.sip[0], undefined, true) : `${WINDOWS_MEDIA_ALLOWED_ORIGINS[0]}/`
  return { url: url(row.purl, base, true), ekey: row.ekey ?? '' }
}

async function request(fetch, value, options, signal) {
  let current = value
  for (let redirects = 0; ; redirects += 1) {
    check(signal)
    const response = await wait(fetch(url(current), { ...options, redirect: 'manual', signal }), signal, cancelBody)
    try {
      if (response.url && url(response.url) !== current) throw failure('REDIRECT')
      const encoding = response.headers.get('content-encoding')
      if (encoding && encoding.toLowerCase() !== 'identity') throw failure('ENCODING')
      if (!REDIRECTS.has(response.status)) return { response, url: current }
      if (redirects >= 3) throw failure('REDIRECT')
      current = url(response.headers.get('location'), current)
    } catch (error) {
      cancelBody(response)
      throw error
    }
    cancelBody(response)
  }
}
async function body(response, count, signal) {
  if (!response.body?.getReader) throw failure('BODY')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const part = await wait(reader.read(), signal)
      if (part.done) break
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > count - size) throw failure('LENGTH')
      size += part.value.byteLength
      chunks.push(Buffer.from(part.value))
    }
    if (size !== count) throw failure('TRUNCATED')
    return Buffer.concat(chunks, size)
  } finally {
    for (const chunk of chunks) chunk.fill(0)
    try { Promise.resolve(reader.cancel()).catch(() => {}) } catch {}
    try { reader.releaseLock() } catch {}
  }
}
async function range(fetch, value, start, end, total, signal) {
  const result = await request(fetch, value, { method: 'GET',
    headers: { ...HEADERS, 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` } }, signal)
  const response = result.response
  try {
    if (response.status !== 206) throw failure(response.status, 'http')
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
    if (!match || unsigned(match[1]) !== start || unsigned(match[2]) !== end) throw failure('RANGE')
    const observedTotal = unsigned(match[3])
    if (observedTotal <= end || total !== null && observedTotal !== total) throw failure('LENGTH')
    const count = Number(end - start + 1n)
    const length = response.headers.get('content-length')
    if (length !== null && unsigned(length) !== BigInt(count)) throw failure('LENGTH')
    return { url: result.url, total: observedTotal, bytes: await body(response, count, signal) }
  } finally { cancelBody(response) }
}
async function preflight(fetch, value, encrypted, ekey, codec, signal) {
  let key = null
  let prefix
  let tail
  let decoded
  let stream
  let returned = false
  try {
    const head = await request(fetch, value, { method: 'HEAD', headers: { ...HEADERS, 'Accept-Encoding': 'identity' } }, signal)
    let total = null
    try {
      if (head.response.status === 200) {
        const length = head.response.headers.get('content-length')
        if (length !== null) total = unsigned(length)
      } else if (![405, 501].includes(head.response.status)) throw failure(head.response.status, 'http')
    } finally { cancelBody(head.response) }
    if (total !== null && total < 128n) throw failure('HEADER')
    // One bounded Range supplies total length when HEAD has no length or is unsupported.
    const first = await range(fetch, head.url, 0n, 127n, total, signal)
    total = first.total
    prefix = first.bytes
    const tailSize = total < 1027n ? total : 1027n
    const last = await range(fetch, first.url, total - tailSize, total - 1n, total, signal)
    tail = last.bytes
    if (last.url !== first.url) throw failure('IDENTITY')
    let container
    try { container = inspectWindowsMediaTail({ tail, upstreamLength: total.toString(), encrypted, serverEkey: ekey }) }
    catch { throw failure(encrypted ? 'KEY' : 'CONTAINER') }
    key = container.key
    const tailBytes = unsigned(container.tailBytes)
    const length = total - tailBytes
    if (length < 128n) throw failure('HEADER')
    decoded = Buffer.from(prefix)
    if (encrypted) {
      if (!(key instanceof Uint8Array)) throw failure('KEY')
      stream = new WindowsMediaStream(key)
      stream.transform(decoded, '0')
    }
    try { validateWindowsAudioHeader(decoded, codec) } catch { throw failure('HEADER') }
    const result = { url: first.url, upstreamLength: total.toString(), length: length.toString(),
      tailBytes: tailBytes.toString(), key, prefixHash: hash(decoded), keyDigest: key ? hash(key) : '' }
    check(signal)
    returned = true
    return result
  } finally {
    if (!returned) key?.fill(0)
    stream?.dispose()
    prefix?.fill(0)
    tail?.fill(0)
    decoded?.fill(0)
  }
}

/** Each resolve transfers a fresh key to WindowsAudioProxy. URL/key caches stay in memory. */
export function createWindowsPlaybackResolver({ client, getDevice, song, quality = 'default',
  fetch = globalThis.fetch, now = Date.now } = {}) {
  if (!client || typeof client.checkLogin !== 'function' || typeof client.getSession !== 'function' ||
    typeof client.request !== 'function' || typeof getDevice !== 'function' || typeof fetch !== 'function' ||
    typeof now !== 'function') throw failure('CONFIG')
  const selected = windowsQualityDefinition(quality)
  if (!selected) throw failure('QUALITY')
  if (!song || !MID.test(song.songmid ?? '') || !MID.test(song.mediaMid ?? '') ||
    typeof song.songid !== 'string' || !/^\d+$/.test(song.songid) || song.songid.length > 10 ||
    BigInt(song.songid) < 1n || BigInt(song.songid) > 0xffffffffn ||
    !Number.isInteger(song.songtype) || song.songtype < -0x80000000 || song.songtype > 0x7fffffff) throw failure('SONG')
  // Only an explicitly observed zero rules a format out. Missing metadata stays
  // unknown and is still verified through the authenticated issuer and bytes.
  if (song.sizes?.[selected.sizeKey] === 0) throw failure('QUALITY_UNAVAILABLE', 'source', true)
  const descriptor = { songmid: song.songmid, songid: BigInt(song.songid).toString(),
    mediaMid: song.mediaMid, songtype: song.songtype }
  let otherMediaMid = ''
  if (selected.otherMidIndex !== undefined) {
    const variant = song.qualityMedia?.[quality]
    if (!variant || typeof variant.otherMediaMid !== 'string' || variant.otherMediaMid.length !== 14 ||
      !MID.test(variant.otherMediaMid)) throw failure('QUALITY_IDENTITY', 'source', true)
    if (variant.songmid !== descriptor.songmid || variant.songid !== descriptor.songid ||
      variant.songtype !== descriptor.songtype || variant.mediaMid !== descriptor.mediaMid ||
      variant.type !== selected.type) throw failure('SONG')
    otherMediaMid = variant.otherMediaMid
  }
  const filename = buildWindowsMediaFilename({ mediaMid: descriptor.mediaMid, type: selected.type,
    sourceMode: 1, encrypted: selected.encrypted, otherMediaMid, auxiliaryFlag: false })
  let closed = false
  let cache = null
  let queue = Promise.resolve()
  const active = new Set()
  const clear = () => { cache?.key?.fill(0); cache = null }
  const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - CACHE_MS) throw failure('TIME'); return value }
  const owned = value => ({ sourceId: value.sourceId, url: value.url, headers: { ...HEADERS },
    expiresAt: value.expiresAt, contentType: selected.contentType, upstreamLength: value.upstreamLength,
    decoder: { kind: selected.encrypted ? 'mode2' : 'plain', length: value.length,
      tailBytes: value.tailBytes, ...(value.key ? { key: Buffer.from(value.key) } : {}) } })
  async function confirmCurrent(fingerprint, guid, signal) {
    const currentDevice = await wait(Promise.resolve().then(getDevice), signal)
    if (deviceGuid(currentDevice) !== guid) throw failure('DEVICE')
    if (await wait(client.checkLogin({ signal }), signal) !== true) throw failure('LOGIN')
    const currentSession = await wait(client.getSession(), signal)
    if (sessionFingerprint(currentSession) !== fingerprint) throw failure('SESSION')
    check(signal)
    if (closed) throw failure('CLOSED')
  }
  async function run(refresh, signal, callerCancelled) {
    let observed
    const previous = cache
    let preserveCanceledCache = !refresh
    let phase = 'source'
    const qualityOwner = Symbol()
    try {
      check(signal)
      if (closed) throw failure('CLOSED')
      if (await wait(client.checkLogin({ signal }), signal) !== true) { clear(); throw failure('LOGIN') }
      const session = await wait(client.getSession(), signal)
      const fingerprint = sessionFingerprint(session)
      if (previous && previous.fingerprint !== fingerprint) preserveCanceledCache = false
      const device = await wait(Promise.resolve().then(getDevice), signal)
      const guid = deviceGuid(device)
      if (previous && previous.guid !== guid) preserveCanceledCache = false
      check(signal)
      const started = time()
      if (!refresh && cache && cache.expiresAt > started && cache.fingerprint === fingerprint && cache.guid === guid) {
        await confirmCurrent(fingerprint, guid, signal)
        return owned(cache)
      }
      preserveCanceledCache = false
      // downloadfrom0 and musicfile=filename were anonymously accepted; they are caller choices.
      const call = buildWindowsVkeyCall({ songs: { filename: [filename], musicfile: [filename],
        songmid: [descriptor.songmid], songtype: [descriptor.songtype] }, guid,
        uin: session.musicid, downloadFrom: 0, encrypted: selected.encrypted })
      phase = 'vkey-request'
      const data = await wait(client.request('queryvkey', call, { signal, session }), signal)
      phase = 'vkey'
      const issued = sourceURL(data, filename, descriptor.songmid, qualityOwner)
      phase = 'media'
      observed = await preflight(fetch, issued.url, selected.encrypted, issued.ekey, selected.codec, signal)
      // RPC epoch guards end before CDN preflight. Revalidate before transferring any key.
      await confirmCurrent(fingerprint, guid, signal)
      const expiresAt = time() + CACHE_MS
      const sourceId = hash(JSON.stringify([descriptor.songmid, descriptor.songid, filename,
        observed.keyDigest, observed.upstreamLength, observed.length, observed.tailBytes, observed.prefixHash]))
      clear()
      cache = { ...observed, sourceId, fingerprint, guid, expiresAt }
      observed = null
      return owned(cache)
    } catch (error) {
      // Closing one old HTTP Range is not evidence that this lease's existing
      // transport became invalid. Preserve only our own caller cancellation,
      // before any observed invalidation; the next read still revalidates all
      // authorization and the original TTL. Timeout/dispose/refresh never qualify.
      let keep = false
      if (preserveCanceledCache && previous && cache === previous && !closed &&
        callerCancelled() && ownedCancellations.has(error)) {
        try { keep = previous.expiresAt > time() } catch {}
      }
      if (!keep) clear()
      throw normalizedError(error, signal, phase, qualityOwner)
    } finally { observed?.key?.fill(0) }
  }
  return {
    resolve({ signal, refresh = false } = {}) {
      if (closed) return Promise.reject(failure('CLOSED'))
      if (typeof refresh !== 'boolean' || signal &&
        (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
        return Promise.reject(failure('CONFIG'))
      }
      const controller = new AbortController()
      let canceledByCaller = false
      const cancel = () => {
        if (!controller.signal.aborted) { canceledByCaller = true; controller.abort() }
      }
      if (signal?.aborted) cancel()
      else signal?.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      timer.unref?.()
      active.add(controller)
      const task = queue.then(() => run(refresh, controller.signal, () => canceledByCaller)).finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        active.delete(controller)
      })
      queue = task.catch(() => {})
      return wait(task, controller.signal, value => value?.decoder?.key?.fill(0))
    },
    dispose() {
      if (closed) return
      closed = true
      for (const controller of active) controller.abort()
      clear()
    }
  }
}
