import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { WindowsMusicClient, WINDOWS_AUTH_KEY, WINDOWS_USER_AGENT,
  WindowsHttpError } from './lib/windows/client.mjs'
import { nativeSigned64 } from './lib/windows/json-integer.mjs'
import { decryptQqTea } from './lib/windows/tea.mjs'

const device = { guid: 'public-device-guid', deviceName: 'public-device', channelId: 0,
  encodedOsVersion: 'public-encoded-os' }
const publicSession = { openid: 'public-openid', access_token: 'public-access',
  refresh_token: 'public-refresh', musickey: 'public-music-key', unionid: '',
  refresh_key: 'public-refresh-key', encryptUin: 'public-encrypted-id',
  expired_at: '1800000000', musicid: '9007199254740993', musickeyCreateTime: '1700000000', loginType: 2 }
const key = 'music.login.LoginServer.Login'
const clock = 1700000000000
const copy = (value) => value == null ? value : structuredClone(value)

function serverData(session) {
  const data = { ...session }
  for (const key of ['expired_at', 'musicid', 'musickeyCreateTime']) {
    if (Object.hasOwn(data, key)) data[key] = nativeSigned64(data[key])
  }
  return data
}

function response(requestKey, session = publicSession, code = 0) {
  return new Response(JSON.stringify({ code: 0, [requestKey]: { code, data: serverData(session) } }))
}

function harness({ stored = null, fetch, now = () => clock, settings: customSettings } = {}) {
  const values = new Map(stored ? [[WINDOWS_AUTH_KEY, copy(stored)]] : [])
  const writes = []
  const settings = customSettings ?? {
    async get(key) { return copy(values.get(key)) },
    async set(key, value) { writes.push(copy(value)); values.set(key, copy(value)) },
    async delete(key) { values.delete(key) }
  }
  const client = new WindowsMusicClient({ settings, getDevice: () => ({ ...device }),
    fetch: fetch ?? (() => response(key)), now })
  return { client, values, writes }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('QQ code login signs its owned Windows bytes and commits only a complete server session', async () => {
  const h = harness({ fetch: async (url, options) => {
    assert.equal(url, 'https://u6.y.qq.com/cgi-bin/musics.fcg')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers['User-Agent'], WINDOWS_USER_AGENT)
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
    for (const header of ['Cookie', 'Origin', 'Referer']) assert.equal(Object.hasOwn(options.headers, header), false)
    const body = JSON.parse(options.body.toString('utf8'))
    assert.equal(body.comm.ct, '19')
    assert.equal(body.comm.cv, '2271')
    assert.equal(body.comm.uin, '0')
    assert.equal(body.comm.tmeLoginType, 2)
    assert.equal(body[key].param.code, 'public-code')
    assert.equal(h.values.has(WINDOWS_AUTH_KEY), false)
    const sign = Buffer.from(options.headers.Sign, 'base64')
    const digest = createHmac('sha1', '9FF169D646A3')
      .update(options.body.toString('base64').split('').reverse().join(''), 'ascii').digest()
    assert.deepEqual(sign.subarray(12), digest)
    const maskKey = Buffer.from(options.headers.Sign.slice(0, 8) + options.headers.Sign.slice(-8))
    assert.equal(decryptQqTea(Buffer.from(options.headers.Mask, 'base64'), maskKey).toString(),
      `19&2271&&0&1700000000&${device.guid}&`)
    return response(key)
  } })
  assert.equal(await h.client.loginWithQQCode('public-code'), true)
  assert.equal(h.writes.length, 1)
  assert.deepEqual(await h.client.getSession(), publicSession)
  const detached = await h.client.getSession()
  detached.musickey = 'public-changed'
  assert.equal((await h.client.getSession()).musickey, publicSession.musickey)
  h.client.close()
})

test('stored credentials require restoration; cache is limited to the same session and server success', async () => {
  let time = clock
  let calls = 0
  const h = harness({ stored: publicSession, now: () => time, fetch: async (_url, options) => {
    calls += 1
    const text = options.body.toString()
    const body = JSON.parse(text)
    assert.equal(body.comm.uin, publicSession.musicid)
    assert.equal(body[key].param.deviceType, 'Widnows')
    assert.ok(text.includes('"musicid":9007199254740993'))
    const maskKey = Buffer.from(options.headers.Sign.slice(0, 8) + options.headers.Sign.slice(-8))
    assert.equal(decryptQqTea(Buffer.from(options.headers.Mask, 'base64'), maskKey).toString(),
      `19&2271&&${publicSession.musicid}&${Math.floor(time / 1000)}&${device.guid}&`)
    return response(key, { ...publicSession, access_token: calls === 1 ? 'public-confirmed' : 'public-next' })
  } })
  assert.equal(await h.client.checkLogin(), true)
  assert.equal(calls, 1)
  assert.deepEqual(await Promise.all([h.client.checkLogin(), h.client.checkLogin()]), [true, true])
  assert.equal(calls, 1)
  time += 60000
  assert.equal(await h.client.checkLogin(), true)
  assert.equal(calls, 2)
  h.values.set(WINDOWS_AUTH_KEY, { ...publicSession, access_token: 'public-external-change' })
  assert.equal(await h.client.checkLogin(), true)
  assert.equal(calls, 3)
  h.client.close()
})

test('expiry runs exact token renewal and restores remotely before storing any result', async () => {
  const expired = { ...publicSession, expired_at: '1600000000' }
  const calls = []
  const h = harness({ stored: expired, fetch: async (_url, options) => {
    const body = JSON.parse(options.body.toString())
    const requestKey = Object.keys(body).find((value) => value !== 'comm')
    calls.push(requestKey)
    if (requestKey === 'QQRefreshToken') {
      assert.equal(body.QQRefreshToken.param.onlyNeedAccessToken, 1)
      assert.equal(Object.hasOwn(body.QQRefreshToken.param, 'forceRefreshToken'), false)
      assert.equal(h.writes.length, 0)
      return response(requestKey, { ...publicSession, access_token: 'public-renewed',
        refresh_token: 'public-server-refresh', musickey: '', musickeyCreateTime: '1' })
    }
    assert.equal(body[key].param.access_token, 'public-renewed')
    assert.equal(body[key].param.refresh_token, expired.refresh_token)
    assert.equal(body[key].param.musickey, expired.musickey)
    assert.equal(h.writes.length, 0)
    return response(key, { ...publicSession, access_token: 'public-final' })
  } })
  assert.equal(await h.client.checkLogin(), true)
  assert.deepEqual(calls, ['QQRefreshToken', key])
  assert.equal(h.writes.length, 1)
  assert.equal((await h.client.getSession()).access_token, 'public-final')
  h.client.close()
})

test('renewal does not invent a partial response or claim success on credential rejection', async () => {
  const expired = { ...publicSession, expired_at: '1600000000' }
  const partial = harness({ stored: expired, fetch: () => response('QQRefreshToken', {
    openid: 'public-openid', access_token: 'public-new', expired_at: '1800000000' }) })
  await assert.rejects(partial.client.checkLogin(), /无效响应/)
  assert.deepEqual(partial.values.get(WINDOWS_AUTH_KEY), expired)
  assert.equal(partial.writes.length, 0)
  partial.client.close()
  for (const code of [1000, 104401, 101010]) {
    const rejected = harness({ stored: expired, fetch: () => response('QQRefreshToken', publicSession, code) })
    assert.equal(await rejected.client.checkLogin(), false)
    assert.equal(rejected.values.has(WINDOWS_AUTH_KEY), false)
    rejected.client.close()
  }
})

test('network failures retain credentials without exposing fetch error values or creating a login cache', async () => {
  let calls = 0
  const h = harness({ stored: publicSession, fetch: () => {
    calls += 1
    throw new Error('QQ 音乐 PRIVATE_FETCH_VALUE')
  } })
  await assert.rejects(h.client.checkLogin(), (error) => !error.message.includes('PRIVATE_FETCH_VALUE'))
  await assert.rejects(h.client.checkLogin())
  assert.equal(calls, 2)
  assert.deepEqual(h.values.get(WINDOWS_AUTH_KEY), publicSession)
  assert.equal(h.writes.length, 0)
  h.client.close()
})

test('login rejection cannot store a session; restoration rejection clears only recognized invalid credentials', async () => {
  const login = harness({ fetch: () => response(key, publicSession, 1000) })
  await assert.rejects(login.client.loginWithQQCode('public-code'), (error) => error.code === 1000)
  assert.equal(login.values.has(WINDOWS_AUTH_KEY), false)
  assert.equal(login.writes.length, 0)
  login.client.close()
  const rejected = harness({ stored: publicSession, fetch: () => response(key, publicSession, 1000) })
  assert.equal(await rejected.client.checkLogin(), false)
  assert.equal(rejected.values.has(WINDOWS_AUTH_KEY), false)
  rejected.client.close()
  const transient = harness({ stored: publicSession, fetch: () => response(key, publicSession, 5000) })
  assert.equal(await transient.client.checkLogin(), false)
  assert.deepEqual(transient.values.get(WINDOWS_AUTH_KEY), publicSession)
  assert.equal(transient.writes.length, 0)
  transient.client.close()
})

test('music-key renewal uses its exact key, fields and zero flags and clears verification cache', async () => {
  const calls = []
  const h = harness({ stored: publicSession, fetch: (_url, options) => {
    const body = JSON.parse(options.body.toString())
    const requestKey = Object.keys(body).find((value) => value !== 'comm')
    calls.push(requestKey)
    if (requestKey === 'QQRefreshKey') {
      assert.equal(body.QQRefreshKey.module, 'music.login.LoginServer')
      assert.equal(body.QQRefreshKey.method, 'Login')
      assert.equal(body.QQRefreshKey.param.onlyNeedAccessToken, 0)
      assert.equal(body.QQRefreshKey.param.forceRefreshToken, 0)
      return response(requestKey, { ...publicSession, musickey: 'public-fresh-key' })
    }
    return response(key, { ...publicSession, musickey: 'public-fresh-key' })
  } })
  assert.equal(await h.client.refreshMusicKey(), true)
  assert.equal((await h.client.getSession()).musickey, 'public-fresh-key')
  assert.equal(await h.client.checkLogin(), true)
  assert.deepEqual(calls, ['QQRefreshKey', key])
  h.client.close()
})

test('logout aborts a late login response and serialized settings writes cannot resurrect credentials', async () => {
  const pending = deferred()
  const entered = deferred()
  const h = harness({ fetch: () => { entered.resolve(); return pending.promise } })
  const login = h.client.loginWithQQCode('public-code')
  const failed = assert.rejects(login, { name: 'AbortError' })
  await entered.promise
  await h.client.logout()
  pending.resolve(response(key))
  await failed
  assert.equal(h.values.has(WINDOWS_AUTH_KEY), false)
  assert.equal(h.writes.length, 0)
  h.client.close()
  const writeStarted = deferred()
  const writeFinish = deferred()
  const values = new Map()
  const settings = { async get(key) { return copy(values.get(key)) },
    async set(key, value) { writeStarted.resolve(); await writeFinish.promise; values.set(key, copy(value)) },
    async delete(key) { values.delete(key) } }
  const saving = harness({ settings })
  const savingLogin = saving.client.loginWithQQCode('public-code')
  const savingFailure = assert.rejects(savingLogin, { name: 'AbortError' })
  await writeStarted.promise
  const logout = saving.client.logout()
  writeFinish.resolve()
  await Promise.all([logout, savingFailure])
  assert.equal(values.has(WINDOWS_AUTH_KEY), false)
  saving.client.close()
})

test('external abort and deactivation cancel pending requests and never store a session', async () => {
  for (const kind of ['abort', 'deactivate']) {
    const pending = deferred()
    const entered = deferred()
    const h = harness({ fetch: () => { entered.resolve(); return pending.promise } })
    const controller = new AbortController()
    const login = h.client.loginWithQQCode('public-code', { signal: controller.signal })
    const failed = assert.rejects(login, { name: 'AbortError' })
    await entered.promise
    if (kind === 'abort') controller.abort()
    else h.client.deactivate()
    pending.resolve(response(key))
    await failed
    assert.equal(h.values.has(WINDOWS_AUTH_KEY), false)
    h.client.close()
  }
})

test('response bytes are bounded before JSON parsing and HTTP errors expose only status', async () => {
  let cancelled = false
  const oversized = harness({ fetch: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true }
  })) })
  await assert.rejects(oversized.client.request('public', { module: 'public', method: 'public', param: {} }), /无效响应/)
  assert.equal(cancelled, true)
  oversized.client.close()
  const failed = harness({ fetch: () => new Response('PRIVATE_HTTP_BODY', { status: 503 }) })
  await assert.rejects(failed.client.request('public', { module: 'public', method: 'public', param: {} }),
    (error) => error instanceof WindowsHttpError && error.status === 503 && !error.message.includes('PRIVATE_HTTP_BODY'))
  failed.client.close()
})

test('redirects remain HTTPS on the fixed issuer and preserve the signed POST body', async () => {
  let calls = 0
  let body
  const allowed = harness({ fetch: (url, options) => {
    calls += 1
    if (calls === 1) { body = options.body; return new Response(null, { status: 302, headers: { location: '/public-redirect' } }) }
    assert.equal(url, 'https://u6.y.qq.com/public-redirect')
    assert.equal(options.body, body)
    return response('public', { publicValue: 1 })
  } })
  assert.deepEqual(await allowed.client.request('public', { module: 'public', method: 'public', param: {} }), { publicValue: 1 })
  allowed.client.close()
  for (const location of ['https://untrusted.example/public', 'http://u6.y.qq.com/public']) {
    let calls = 0
    const blocked = harness({ fetch: () => { calls += 1; return new Response(null, { status: 302, headers: { location } }) } })
    await assert.rejects(blocked.client.request('public', { module: 'public', method: 'public', param: {} }), WindowsHttpError)
    assert.equal(calls, 1)
    blocked.client.close()
  }
})

test('session changes and unsupported login modes cannot be committed by a stale restore', async () => {
  const pending = deferred()
  const entered = deferred()
  const h = harness({ stored: publicSession, fetch: () => { entered.resolve(); return pending.promise } })
  const check = h.client.checkLogin()
  const failed = assert.rejects(check, { name: 'AbortError' })
  await entered.promise
  h.values.set(WINDOWS_AUTH_KEY, { ...publicSession, musickey: 'public-new-owner' })
  pending.resolve(response(key))
  await failed
  assert.equal(h.values.get(WINDOWS_AUTH_KEY).musickey, 'public-new-owner')
  assert.equal(h.writes.length, 0)
  h.client.close()
  const unsupported = harness({ stored: { ...publicSession, loginType: 6 }, fetch: () => { throw new Error('must not request') } })
  assert.equal(await unsupported.client.checkLogin(), false)
  assert.equal(await unsupported.client.refreshMusicKey(), false)
  unsupported.client.close()
})

test('replacing authorization cancels an already-started storage write and restores its predecessor', async () => {
  for (const previous of [undefined, publicSession]) {
    const entered = deferred()
    const release = deferred()
    const values = new Map(previous ? [[WINDOWS_AUTH_KEY, copy(previous)]] : [])
    let sets = 0
    const h = harness({ fetch: () => response(key, { ...publicSession, musickey: 'public-obsolete-key' }), settings: {
      async get(name) { return copy(values.get(name)) },
      async set(name, value) {
        if (++sets === 1) { entered.resolve(); await release.promise }
        values.set(name, copy(value))
      },
      async delete(name) { values.delete(name) }
    } })
    const login = h.client.loginWithQQCode('public-old-code')
    const rejected = assert.rejects(login, { name: 'AbortError' })
    await entered.promise
    const cancelled = h.client.cancelPending()
    release.resolve()
    await Promise.all([cancelled, rejected])
    assert.deepEqual(values.get(WINDOWS_AUTH_KEY), previous)
    h.client.close()
  }
})
