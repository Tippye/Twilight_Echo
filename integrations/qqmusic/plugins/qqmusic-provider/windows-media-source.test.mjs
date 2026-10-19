import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { createWindowsPlaybackResolver, windowsPlaybackFailureDetails, WINDOWS_MEDIA_ALLOWED_ORIGINS } from './lib/windows/media-source.mjs'
import { WindowsMediaStream } from './lib/windows/media-stream.mjs'
import { WindowsAudioProxy } from './lib/windows/audio-proxy.mjs'
import { windowsSongMedia } from './lib/windows/tracks.mjs'

// Immutable original-DLL vectors are public synthetic seeds, never account Ekeys.
const vectors = JSON.parse(readFileSync(new URL('./test/fixtures/windows-ekey-native-v1.json', import.meta.url))).vectors
const vector = vectors.find(value => value.key_length > 300) ?? vectors[0]
const internalKey = Buffer.from(vector.internal_key_hex, 'hex')
const encoded = Buffer.from(vector.encoded_ekey_hex, 'hex').toString('ascii')
const origin = WINDOWS_MEDIA_ALLOWED_ORIGINS[0]
const song = { songmid: '0039MnYb0qxYhV', songid: '97773', mediaMid: '003Qui1q2u1Zho', songtype: 0 }
const device = { guid: '0123456789abcdef0123456789abcdef' }
const session = { musicid: '42', loginType: 2, access_token: 'public-synthetic-token' }
function premiumSong() {
  const vs = Array(30).fill('')
  vs[3] = '003xkcSf3NBRlX'
  vs[29] = '004astzo2Y5HDU'
  return windowsSongMedia({ mid: song.songmid, id: Number(song.songid), type: song.songtype,
    file: { media_mid: song.mediaMid, size_new: Array(16).fill(4096) }, vs })
}
function mp3() { const bytes = Buffer.alloc(2048, 19); bytes.write('ID3'); bytes[3] = 4; bytes.fill(0, 6, 10); return bytes }
function flac() { const bytes = Buffer.alloc(2048, 19); bytes.write('fLaC'); bytes[4] = 0; bytes.writeUIntBE(34, 5, 3); return bytes }
function mp4() { const bytes = Buffer.alloc(2048, 19); bytes.writeUInt32BE(16, 0); bytes.write('ftypM4A ', 4); return bytes }
function encrypted(plain, footer = 'none') {
  const stream = new WindowsMediaStream(internalKey)
  const cipher = stream.transform(Buffer.from(plain), '0')
  stream.dispose()
  if (footer === 'none') return cipher
  if (footer === 'length') {
    const tail = Buffer.concat([Buffer.from(encoded), Buffer.alloc(4)])
    tail.writeUInt32LE(encoded.length, tail.length - 4)
    return Buffer.concat([cipher, tail])
  }
  const tail = Buffer.alloc(192)
  tail.write('public.mflac\0', 0x48, 'utf16le')
  tail.writeUInt32LE(192, 176); tail.writeUInt32LE(1, 180); tail.write('musicex\0', 184, 'ascii')
  return Buffer.concat([cipher, tail])
}
function serving(payload, requests, modify = value => value) {
  return async (url, options) => {
    requests.push({ url, ...options })
    if (options.method === 'HEAD') return modify(new Response(null, { status: 200,
      headers: { 'Content-Length': String(payload.length) } }), options)
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const start = Number(match[1]); const end = Number(match[2])
    return modify(new Response(payload.subarray(start, end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${payload.length}`, 'Content-Length': String(end - start + 1) } }), options)
  }
}
function harness(t, options = {}) {
  const events = []
  const requests = []
  const calls = []
  const client = {
    checkLogin: async () => { events.push('check'); return true },
    getSession: async () => { events.push('session'); return { ...session } },
    request: async (key, call, context) => {
      events.push('vkey'); calls.push({ key, call, context })
      return { retcode: 0, sip: [origin], midurlinfo: [{ filename: call.param.filename[0],
        songmid: song.songmid, result: 0, purl: '/public-media?vkey=public-synthetic-value', ekey: encoded }] }
    }, ...options.client
  }
  const resolver = createWindowsPlaybackResolver({ client, getDevice: () => ({ ...device }), song,
    quality: 'default', now: () => 1000, fetch: serving(mp3(), requests), ...options, client })
  t.after(() => resolver.dispose())
  return { resolver, client, calls, requests, events }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function safeError(error, code) {
  assert.equal(error.name, 'WindowsPlaybackSourceError')
  assert.equal(typeof error.message, 'string')
  assert.match(error.message, /^(?:QQ 音乐|当前歌曲|请先使用手机 QQ)/)
  assert.equal(/PRIVATE|PUBLIC_RAW_PROVIDER_MESSAGE|https?:\/\//.test(error.message), false)
  if (code !== undefined) assert.equal(error.code, code)
  return true
}

test('only current trusted quality failures authorize fallback; spoofed, replayed, and transport errors do not', async t => {
  let trusted
  const issuer = harness(t, { client: { request: async () => ({ retcode: 22 }) } })
  await assert.rejects(issuer.resolver.resolve(), error => {
    trusted = error
    assert.deepEqual(windowsPlaybackFailureDetails(error), {
      code: 22, message: 'QQ 音乐服务端拒绝所选音质（22）', recoverableQuality: true })
    return true
  })
  trusted.code = 403
  trusted.message = 'PRIVATE_ACCOUNT_AND_TOKEN'
  assert.equal(windowsPlaybackFailureDetails(trusted).recoverableQuality, true)
  assert.equal(windowsPlaybackFailureDetails(trusted).message.includes('PRIVATE'), false)
  const absent = (() => { try { createWindowsPlaybackResolver({ client: issuer.client, getDevice: () => device,
    song: { ...song, sizes: { dolby: 0 } }, quality: 'dolby' }) } catch (error) { return error } })()
  assert.equal(windowsPlaybackFailureDetails(absent).recoverableQuality, true)
  const spoofed = Object.assign(Error('PRIVATE'), { name: 'WindowsPlaybackSourceError', code: 22, recoverableQuality: true })
  assert.equal(windowsPlaybackFailureDetails(spoofed), null)
  for (const raw of [spoofed, trusted, absent, Object.assign(Error('PRIVATE'), { code: 22 })]) {
    for (const phase of ['request', 'fetch', 'response-getter']) {
      const h = harness(t, phase === 'request' ? { client: { request: async () => { throw raw } } }
        : phase === 'fetch' ? { fetch: async () => { throw raw } }
          : { client: { request: async () => Object.defineProperty({}, 'retcode', { get() { throw raw } }) } })
      await assert.rejects(h.resolver.resolve(), error => windowsPlaybackFailureDetails(error)?.recoverableQuality === false)
    }
  }
  const returned = windowsPlaybackFailureDetails(trusted)
  returned.recoverableQuality = false
  assert.equal(windowsPlaybackFailureDetails(trusted).recoverableQuality, true)
  for (const code of [23, 403, '22']) {
    const h = harness(t, { client: { request: async () => ({ retcode: code }) } })
    await assert.rejects(h.resolver.resolve(), error => windowsPlaybackFailureDetails(error)?.recoverableQuality === false)
  }
  const empty = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, midurlinfo: [{
    filename: call.param.filename[0], songmid: song.songmid, result: 0, purl: '' }] }) } })
  await assert.rejects(empty.resolver.resolve(), error => windowsPlaybackFailureDetails(error)?.recoverableQuality === true)
})

test('playback rejection privately owns codes and rebuilds mutable/spoofed errors without leaking unsafe getters', async t => {
  const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'
  let owned
  try { createWindowsPlaybackResolver({}) } catch (error) { owned = error }
  owned.message = marker
  Object.defineProperty(owned, 'name', { get() { throw new Error(marker) } })
  Object.defineProperty(owned, 'code', { get() { throw new Error(marker) } })
  const spoofed = Object.assign(new Error(marker), { name: 'WindowsPlaybackSourceError', code: marker })
  const unsafeName = Object.defineProperty({}, 'name', { get() { throw new Error(marker) } })
  for (const [raw, expected] of [[owned, 'CONFIG'], [spoofed, 'SOURCE'], [unsafeName, 'SOURCE']]) {
    const h = harness(t, { client: { request: async () => { throw raw } } })
    await assert.rejects(h.resolver.resolve(), error => error !== raw && safeError(error, expected))
    assert.equal(h.requests.length, 0)
  }
  const changing = new Error(marker); let codeReads = 0
  Object.defineProperty(changing, 'code', { get: () => ++codeReads === 1 ? 22 : marker })
  const h = harness(t, { client: { request: async () => { throw changing } } })
  await assert.rejects(h.resolver.resolve(), error => safeError(error, 22))
  assert.equal(codeReads, 1); assert.equal(h.requests.length, 0)
  const abort = harness(t, { client: { request: async () => { throw Object.assign(new Error(marker), { name: 'AbortError' }) } } })
  await assert.rejects(abort.resolver.resolve(), error => error.name === 'AbortError' && !error.message.includes(marker))
  assert.equal(abort.requests.length, 0)
})

test('Vkey retcode/result are each snapshotted once before numeric business error reconstruction and never start CDN fetch', async t => {
  const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'
  for (const field of ['retcode', 'result']) {
    let reads = 0
    const h = harness(t, { client: { request: async (_key, call) => {
      if (field === 'retcode') return Object.defineProperty({}, 'retcode', { get: () => ++reads <= 3 ? 22 : marker })
      const row = { filename: call.param.filename[0], songmid: song.songmid }
      Object.defineProperty(row, 'result', { get: () => ++reads === 1 ? 22 : marker })
      return { retcode: 0, midurlinfo: [row] }
    } } })
    await assert.rejects(h.resolver.resolve(), error => safeError(error, 22))
    assert.equal(reads, 1); assert.equal(h.requests.length, 0)
  }
})

test('plain MP3 uses verified session, native call, real length and bounded CDN ranges', async t => {
  const h = harness(t)
  const source = await h.resolver.resolve()
  assert.deepEqual(h.events, ['check', 'session', 'vkey', 'check', 'session'])
  assert.equal(h.calls[0].key, 'queryvkey')
  assert.equal(h.calls[0].call.module, 'music.vkey.GetVkey')
  assert.equal(h.calls[0].call.method, 'UrlGetVkey')
  assert.deepEqual(h.calls[0].call.param.filename, ['M500003Qui1q2u1Zho.mp3'])
  assert.deepEqual(h.calls[0].call.param.musicfile, h.calls[0].call.param.filename)
  assert.deepEqual(h.calls[0].call.param.songmid, [song.songmid])
  assert.deepEqual(h.calls[0].call.param.songtype, [0])
  assert.equal(h.calls[0].call.param.uin, '42')
  assert.equal(h.calls[0].call.param.downloadfrom, 0)
  assert.equal(h.calls[0].context.session.musicid, '42')
  assert.deepEqual(source.decoder, { kind: 'plain', length: '2048', tailBytes: '0' })
  assert.equal(source.upstreamLength, '2048')
  assert.equal(source.contentType, 'audio/mpeg')
  assert.equal(source.expiresAt, 61000)
  assert.match(source.sourceId, /^[a-f0-9]{64}$/)
  assert.deepEqual(h.requests.map(request => request.headers.Range ?? 'HEAD'), ['HEAD', 'bytes=0-127', 'bytes=1021-2047'])
  for (const request of h.requests) {
    assert.equal(request.redirect, 'manual')
    assert.equal(request.headers['Accept-Encoding'], 'identity')
    assert.equal(Object.hasOwn(request.headers, 'Cookie'), false)
  }
})

test('explicit quality mappings preserve their native filename and encrypted service', async t => {
  for (const [quality, prefix, mode] of [['128', 'M500', 'plain'], ['high', 'M800', 'plain'], ['320', 'M800', 'plain'],
    ['flac', 'F0M0', 'mode2'], ['lossless', 'F0M0', 'mode2'], ['surround', 'D0MA', 'mode2'],
    ['hires', 'RSM1', 'mode2'], ['dolby', 'D0M1', 'mode2'],
    ['master', 'AIM0', 'mode2'], ['galaxy', 'Q0M0', 'mode2']]) {
    const requests = []
    const h = harness(t, { quality, song: premiumSong(),
      fetch: serving(mode === 'plain' ? mp3() : encrypted(quality === 'dolby' ? mp4() : flac()), requests) })
    const source = await h.resolver.resolve()
    assert.ok(h.calls[0].call.param.filename[0].startsWith(prefix))
    assert.equal(h.calls[0].call.module, mode === 'plain' ? 'music.vkey.GetVkey' : 'music.vkey.GetEVkey')
    assert.equal(source.decoder.kind, mode)
    source.decoder.key?.fill(0)
  }
  for (const quality of ['unverified-ai', 'auto', 'custom', '', null, 960]) {
    assert.throws(() => harness(t, { quality }), error => safeError(error, 'QUALITY'))
  }
})

test('premium native OtherMID replaces the filename identity while Vkey still binds the canonical song MID', async t => {
  for (const [quality, expected] of [['master', 'AIM0003xkcSf3NBRlX.mflac'],
    ['galaxy', 'Q0M0004astzo2Y5HDU.mflac']]) {
    const descriptor = premiumSong()
    const h = harness(t, { quality, song: descriptor, fetch: serving(encrypted(flac()), []) })
    // Neither nested DTO mutation nor a transport refresh can change the
    // resolver's selected filename identity after construction.
    descriptor.qualityMedia[quality].otherMediaMid = '00000000000001'
    descriptor.qualityMedia[quality].songmid = '00000000000002'
    descriptor.mediaMid = '00000000000003'
    const first = await h.resolver.resolve()
    const refresh = await h.resolver.resolve({ refresh: true })
    assert.deepEqual(h.calls.map(call => call.call.param.filename), [[expected], [expected]])
    for (const { call } of h.calls) {
      assert.deepEqual(call.param.musicfile, [expected])
      assert.deepEqual(call.param.songmid, [song.songmid])
      assert.deepEqual(call.param.songtype, [song.songtype])
      assert.equal(call.module, 'music.vkey.GetEVkey')
    }
    assert.equal(first.sourceId, refresh.sourceId)
    first.decoder.key.fill(0); refresh.decoder.key.fill(0)
  }
})

test('premium identities must belong to this exact TrackInfo; missing identities never fall back to the base MID', async t => {
  const requests = []
  const setup = harness(t, { fetch: serving(encrypted(flac()), requests) })
  for (const quality of ['master', 'galaxy']) {
    for (const bad of [undefined, null, {}, { otherMediaMid: '' }, { otherMediaMid: '003xkcSf3NBRlX\n' }]) {
      const descriptor = premiumSong()
      descriptor.qualityMedia[quality] = bad
      assert.throws(() => createWindowsPlaybackResolver({ client: setup.client, getDevice: () => device,
        song: descriptor, quality }), error => safeError(error, 'QUALITY_IDENTITY') &&
          windowsPlaybackFailureDetails(error).recoverableQuality === true)
    }
    for (const change of [{ songmid: '00000000000001' }, { songid: '97800' }, { songtype: 1 },
      { mediaMid: '00000000000002' }, { type: 16 }]) {
      const descriptor = premiumSong()
      Object.assign(descriptor.qualityMedia[quality], change)
      assert.throws(() => createWindowsPlaybackResolver({ client: setup.client, getDevice: () => device,
        song: descriptor, quality }), error => safeError(error, 'SONG') &&
          windowsPlaybackFailureDetails(error).recoverableQuality === false)
    }
    for (const size of [undefined, null]) {
      const descriptor = premiumSong()
      descriptor.sizes[quality] = size
      const h = harness(t, { quality, song: descriptor, fetch: serving(encrypted(flac()), []) })
      const source = await h.resolver.resolve()
      assert.equal(h.calls.length, 1)
      source.decoder.key.fill(0)
    }
    const descriptor = premiumSong()
    descriptor.sizes[quality] = 0
    assert.throws(() => createWindowsPlaybackResolver({ client: setup.client, getDevice: () => device,
      song: descriptor, quality }), error => safeError(error, 'QUALITY_UNAVAILABLE'))
  }
  assert.equal(setup.calls.length, 0)
  assert.equal(requests.length, 0)
})

test('explicit absent formats fail before issuer or media requests while unknown metadata remains testable', async t => {
  const blocked = harness(t)
  assert.throws(() => createWindowsPlaybackResolver({ client: blocked.client, getDevice: () => device,
    song: { ...song, sizes: { dolby: 0 } }, quality: 'dolby' }), error =>
    safeError(error, 'QUALITY_UNAVAILABLE') && error.message === '当前歌曲未提供所选音质')
  assert.equal(blocked.calls.length, 0)
  assert.equal(blocked.requests.length, 0)
  for (const sizes of [undefined, {}, { dolby: null }]) {
    const h = harness(t, { song: { ...song, sizes }, quality: 'dolby', fetch: serving(encrypted(mp4()), []) })
    const source = await h.resolver.resolve()
    assert.equal(source.decoder.length, '2048')
    assert.equal(h.calls.length, 1)
    source.decoder.key.fill(0)
  }
})

test('unavailable, empty issuer, service refusal, HTTP and content failures have distinct safe explanations', async t => {
  const rejected = harness(t, { client: { request: async () => ({ retcode: 22, msg: 'PRIVATE_ACCOUNT_AND_TOKEN' }) } })
  await assert.rejects(rejected.resolver.resolve(), error => safeError(error, 22) &&
    error.message === 'QQ 音乐服务端拒绝所选音质（22）' && !/VIP|权限不足|未提供/.test(error.message))
  const empty = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, midurlinfo: [{
    filename: call.param.filename[0], songmid: song.songmid, result: 0, purl: '' }] }) } })
  await assert.rejects(empty.resolver.resolve(), error => safeError(error, 'VKEY_EMPTY') && /未返回.*播放地址/.test(error.message))
  const http = harness(t, { fetch: async () => new Response(null, { status: 403 }) })
  await assert.rejects(http.resolver.resolve(), error => safeError(error, 403) && error.message.includes('HTTP 403'))
  const transport = harness(t, { fetch: async () => { throw Object.assign(Error('PRIVATE_URL_AND_TOKEN'), { code: 22 }) } })
  await assert.rejects(transport.resolver.resolve(), error => safeError(error, 22) &&
    error.message === 'QQ 音乐播放源请求失败（22）' && !/HTTP|服务端拒绝/.test(error.message))
  const header = harness(t, { fetch: serving(Buffer.alloc(2048), []) })
  await assert.rejects(header.resolver.resolve(), error => safeError(error, 'HEADER') && /格式或解密/.test(error.message))
  const key = harness(t, { quality: 'flac', fetch: serving(encrypted(flac()), []),
    client: { request: async (_key, call) => ({ retcode: 0, midurlinfo: [{ filename: call.param.filename[0],
      songmid: song.songmid, result: 0, purl: '/public-media', ekey: 'PRIVATE_BAD_KEY' }] }) } })
  await assert.rejects(key.resolver.resolve(), error => safeError(error, 'KEY') && /格式或解密/.test(error.message))
})

test('modern key validates the decoded FLAC header and verified footer trim', async t => {
  for (const footer of ['none', 'musicex', 'length']) {
    const payload = encrypted(flac(), footer)
    const h = harness(t, { quality: 'lossless', fetch: serving(payload, []) })
    const source = await h.resolver.resolve()
    assert.equal(source.contentType, 'audio/flac')
    assert.equal(source.upstreamLength, String(payload.length))
    assert.equal(source.decoder.length, '2048')
    assert.equal(source.decoder.tailBytes, String(payload.length - 2048))
    assert.deepEqual(source.decoder.key, internalKey)
    source.decoder.key.fill(0)
  }
})

test('each resolve transfers an independent key while cache still rechecks login', async t => {
  const h = harness(t, { quality: 'lossless', fetch: serving(encrypted(flac()), []) })
  const first = await h.resolver.resolve()
  first.decoder.key.fill(0)
  const second = await h.resolver.resolve()
  assert.deepEqual(second.decoder.key, internalKey)
  assert.notEqual(first.decoder.key, second.decoder.key)
  assert.equal(first.sourceId, second.sourceId)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.events, ['check', 'session', 'vkey', 'check', 'session',
    'check', 'session', 'check', 'session'])
  second.decoder.key.fill(0)
})

test('pure caller cancellation retains a warm source for fresh validation without repeating Vkey or preflight', async t => {
  for (const phase of ['preaborted', 'cached-confirm']) {
    const requests = [], h = harness(t, { quality: 'lossless', fetch: serving(encrypted(flac()), requests) })
    const first = await h.resolver.resolve()
    first.decoder.key.fill(0)
    const controller = new AbortController(), entered = deferred(), release = deferred()
    let checks = 0
    h.client.checkLogin = async () => {
      if (++checks === 2) { entered.resolve(); await release.promise }
      return true
    }
    if (phase === 'preaborted') controller.abort()
    const pending = h.resolver.resolve({ signal: controller.signal })
    if (phase === 'cached-confirm') { await entered.promise; controller.abort(); release.resolve() }
    await assert.rejects(pending, { name: 'AbortError' })
    h.client.checkLogin = async () => true
    const next = await h.resolver.resolve()
    assert.equal(next.sourceId, first.sourceId)
    assert.deepEqual(next.decoder.key, internalKey)
    next.decoder.key.fill(0)
    assert.equal(h.calls.length, 1, phase)
    assert.equal(requests.length, 3, phase)
  }
})

test('caller cancellation never preserves forced refresh, expired or observed changed authorization', async t => {
  for (const variant of ['refresh', 'expired', 'session', 'device', 'unknown-abort']) {
    let clock = 1000, token = session.access_token, guid = device.guid
    const entered = deferred(), release = deferred()
    let holdDevice = false, holdIssuer = false
    const h = harness(t, { now: () => clock,
      getDevice: async () => { if (holdDevice) { entered.resolve(); await release.promise }; return { guid } },
      client: { getSession: async () => ({ ...session, access_token: token }) } })
    await h.resolver.resolve()
    const controller = new AbortController()
    if (variant === 'refresh' || variant === 'expired') {
      if (variant === 'expired') clock = 61000
      controller.abort()
    }
    if (variant === 'session') { token = 'public-replaced'; holdDevice = true }
    if (variant === 'device') {
      guid = 'public-replaced-guid'; holdIssuer = true
      const issue = h.client.request
      h.client.request = async (...args) => { if (holdIssuer) { entered.resolve(); await release.promise }; return issue(...args) }
    }
    if (variant === 'unknown-abort') h.client.checkLogin = async () => { throw Object.assign(Error('PRIVATE'), { name: 'AbortError' }) }
    const pending = h.resolver.resolve({ signal: controller.signal, refresh: variant === 'refresh' })
    if (variant === 'session' || variant === 'device') { await entered.promise; controller.abort(); release.resolve() }
    await assert.rejects(pending, { name: 'AbortError' })
    holdDevice = false; holdIssuer = false; token = session.access_token; guid = device.guid; clock = 1000
    h.client.checkLogin = async () => true
    const before = h.calls.length
    await h.resolver.resolve()
    assert.equal(h.calls.length, before + 1, variant)
  }
})

test('internal resolver timeout wins over a later caller abort and still clears cached authorization', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const h = harness(t), entered = deferred(), release = deferred()
  await h.resolver.resolve()
  h.client.checkLogin = async () => { entered.resolve(); await release.promise; return true }
  const controller = new AbortController(), pending = h.resolver.resolve({ signal: controller.signal })
  await entered.promise
  t.mock.timers.tick(10000)
  controller.abort()
  release.resolve()
  await assert.rejects(pending, { name: 'AbortError' })
  h.client.checkLogin = async () => true
  await h.resolver.resolve()
  assert.equal(h.calls.length, 2)
})

test('an observed unknown or owned failure still invalidates cache when caller abort follows its rejection', async t => {
  for (const variant of ['unknown', 'owned-login']) {
    const h = harness(t), entered = deferred()
    let rejectCheck
    const pendingCheck = new Promise((_, reject) => { rejectCheck = reject })
    let error = Error('PRIVATE_UNKNOWN')
    if (variant === 'owned-login') {
      h.client.checkLogin = async () => false
      try { await h.resolver.resolve() } catch (failure) { error = failure }
      h.client.checkLogin = async () => true
    }
    await h.resolver.resolve()
    h.client.checkLogin = () => { entered.resolve(); return pendingCheck }
    const controller = new AbortController(), pending = h.resolver.resolve({ signal: controller.signal })
    await entered.promise
    rejectCheck(error)
    queueMicrotask(() => controller.abort())
    await assert.rejects(pending)
    h.client.checkLogin = async () => true
    await h.resolver.resolve()
    assert.equal(h.calls.length, 2, variant)
  }
})

test('refresh revalidates CDN identity; TTL and session changes invalidate transport cache', async t => {
  let clock = 1000
  let token = 'public-one'
  let payload = mp3()
  const requests = []
  const h = harness(t, { now: () => clock, client: { getSession: async () => ({ ...session, access_token: token }) },
    fetch: (url, options) => serving(payload, requests)(url, options) })
  const first = await h.resolver.resolve()
  assert.equal((await h.resolver.resolve({ refresh: true })).sourceId, first.sourceId)
  assert.equal(h.calls.length, 2)
  clock = 61000
  await h.resolver.resolve()
  assert.equal(h.calls.length, 3)
  token = 'public-two'
  await h.resolver.resolve()
  assert.equal(h.calls.length, 4)
  payload = mp3(); payload[3] = 3
  const changed = await h.resolver.resolve({ refresh: true })
  assert.notEqual(changed.sourceId, first.sourceId)
})

test('HEAD unsupported takes only one prefix Range and one bounded tail Range', async t => {
  const requests = []
  const h = harness(t, { fetch: serving(mp3(), requests, (response, options) => options.method === 'HEAD'
    ? new Response(null, { status: 405 }) : response) })
  assert.equal((await h.resolver.resolve()).upstreamLength, '2048')
  assert.equal(requests.length, 3)
  assert.equal(requests[1].headers.Range, 'bytes=0-127')
})

test('HTTP native issuer can upgrade only to the same official HTTPS host after preflight', async t => {
  const h = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, sip: ['http://dl.stream.qqmusic.qq.com/'],
    midurlinfo: [{ filename: call.param.filename[0], songmid: song.songmid, result: 0, purl: 'public-media?value=synthetic' }] }) } })
  const source = await h.resolver.resolve()
  assert.equal(new URL(source.url).origin, origin)
  assert.ok(h.requests.every(request => new URL(request.url).protocol === 'https:'))
})

test('rights errors preserve only numeric code and skip all media fetches', async t => {
  for (const field of ['retcode', 'result']) {
    const h = harness(t, { client: { request: async (_key, call) => ({ retcode: field === 'retcode' ? 22 : 0,
      msg: 'PRIVATE_MESSAGE', sip: [origin], midurlinfo: [{ filename: call.param.filename[0], songmid: song.songmid,
        result: field === 'result' ? 22 : 0, purl: '/PRIVATE_VALUE', ekey: 'PRIVATE_KEY' }] }) } })
    await assert.rejects(h.resolver.resolve(), error => safeError(error, 22))
    assert.equal(h.requests.length, 0)
  }
})

test('mismatched filename/MID, malformed result and empty purl never create a source', async t => {
  for (const [change, code] of [[{ filename: 'OTHER_FILE' }, 'VKEY_FILENAME'],
    [{ songmid: 'OTHER_MID' }, 'VKEY_SONGMID'], [{ result: '0' }, 'VKEY_RESPONSE'], [{ purl: '' }, 'VKEY_EMPTY']]) {
    const h = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, sip: [origin], midurlinfo: [{
      filename: call.param.filename[0], songmid: song.songmid, result: 0, purl: '/public-media', ...change }] }) } })
    await assert.rejects(h.resolver.resolve(), error => safeError(error, code))
    assert.equal(h.requests.length, 0)
  }
})

test('relative Vkey without sip uses the explicit official compatibility base and validates bytes', async t => {
  for (const sip of [undefined, []]) {
    const h = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, sip,
      midurlinfo: [{ filename: call.param.filename[0], songmid: song.songmid,
        result: 0, purl: 'public-media' }] }) } })
    const source = await h.resolver.resolve()
    assert.equal(source.url, `${origin}/public-media`)
    assert.equal(source.decoder.kind, 'plain')
    assert.deepEqual(h.requests.map(request => request.headers.Range ?? 'HEAD'),
      ['HEAD', 'bytes=0-127', 'bytes=1021-2047'])
    assert.ok(h.requests.every(request => new URL(request.url).origin === origin))
  }
})

test('origin, userinfo, fragment, ports and redirect destinations have a closed issuer set', async t => {
  for (const value of ['https://dl.stream.qqmusic.qq.com.evil.example/media', 'https://evil.example/media',
    'https://user:secret@dl.stream.qqmusic.qq.com/media', `${origin}/media#secret`, `${origin}:444/media`]) {
    const h = harness(t, { client: { request: async (_key, call) => ({ retcode: 0, midurlinfo: [{ filename: call.param.filename[0],
      songmid: song.songmid, result: 0, purl: value }] }) } })
    await assert.rejects(h.resolver.resolve(), error => safeError(error, 'ORIGIN'))
    assert.equal(h.requests.length, 0)
  }
  const h = harness(t, { fetch: async (_url, options) => {
    h.requests.push(options)
    return new Response(null, { status: 302, headers: { Location: 'https://evil.example/PRIVATE_VALUE' } })
  } })
  await assert.rejects(h.resolver.resolve(), error => safeError(error, 'ORIGIN'))
  assert.equal(h.requests.length, 1)
})

test('range total mismatch, compressed bytes, ignored ranges and damaged headers reject', async t => {
  for (const variant of ['length', 'encoding', 'range', 'header']) {
    const requests = []
    const payload = variant === 'header' ? Buffer.alloc(2048) : mp3()
    const h = harness(t, { fetch: serving(payload, requests, (response, options) => {
      if (variant === 'length' && options.method === 'HEAD') response.headers.set('Content-Length', '2049')
      if (variant === 'encoding') response.headers.set('Content-Encoding', 'gzip')
      if (variant === 'range' && options.method === 'GET') return new Response(payload, { status: 200,
        headers: { 'Content-Length': '2048' } })
      return response
    }) })
    await assert.rejects(h.resolver.resolve(), error => safeError(error))
  }
})

test('actual received Range byte cap cancels an oversized body without reading media', async t => {
  let canceled = 0
  const h = harness(t, { fetch: async (_url, options) => options.method === 'HEAD'
    ? new Response(null, { headers: { 'Content-Length': '2048' } })
    : new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(129)) },
      cancel() { canceled += 1 } }), { status: 206, headers: { 'Content-Range': 'bytes 0-127/2048', 'Content-Length': '128' } }) })
  await assert.rejects(h.resolver.resolve(), error => safeError(error, 'LENGTH'))
  assert.equal(canceled, 1)
})

test('failed remote login, network errors and missing keys cannot use cached authorization', async t => {
  let verified = true
  const h = harness(t, { client: { checkLogin: async () => verified } })
  await h.resolver.resolve()
  verified = false
  await assert.rejects(h.resolver.resolve(), error => safeError(error, 'LOGIN'))
  assert.equal(h.calls.length, 1)
  const invalid = harness(t, { client: { checkLogin: async () => ({ loggedIn: false }) } })
  await assert.rejects(invalid.resolver.resolve(), error => safeError(error, 'LOGIN'))
  assert.equal(invalid.calls.length, 0)
  const network = harness(t, { fetch: async () => { throw new Error('PRIVATE_TRANSPORT_URL_AND_TOKEN') } })
  await assert.rejects(network.resolver.resolve(), error => safeError(error, 'SOURCE'))
  const missing = harness(t, { quality: 'lossless', fetch: serving(encrypted(flac()), []),
    client: { request: async (_key, call) => ({ retcode: 0, sip: [origin], midurlinfo: [{ filename: call.param.filename[0],
      songmid: song.songmid, result: 0, purl: '/public-media' }] }) } })
  await assert.rejects(missing.resolver.resolve(), error => safeError(error, 'KEY'))
})

test('abort/dispose cancel pending preflight and release a late body; disposed resolver stays closed', async t => {
  const pending = deferred()
  const started = deferred()
  let canceled = 0
  const h = harness(t, { fetch: () => { started.resolve(); return pending.promise } })
  const task = h.resolver.resolve()
  await started.promise
  h.resolver.dispose()
  await assert.rejects(task, { name: 'AbortError' })
  pending.resolve(new Response(new ReadableStream({ cancel() { canceled += 1 } })))
  await tick()
  assert.equal(canceled, 1)
  await assert.rejects(h.resolver.resolve(), error => safeError(error, 'CLOSED'))
  const controller = new AbortController(); controller.abort()
  const clean = harness(t)
  await assert.rejects(clean.resolver.resolve({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(clean.calls.length, 0)
})

test('bounded resolver timeout aborts an unresponsive fetch and cancels its late body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => t.mock.timers.reset())
  const started = deferred()
  const pending = deferred()
  let canceled = 0
  let fetchSignal
  const h = harness(t, { fetch: (_url, options) => {
    fetchSignal = options.signal
    started.resolve()
    return pending.promise
  } })
  const task = h.resolver.resolve()
  await started.promise
  t.mock.timers.tick(10000)
  await assert.rejects(task, { name: 'AbortError' })
  assert.equal(fetchSignal.aborted, true)
  pending.resolve(new Response(new ReadableStream({ cancel() { canceled += 1 } })))
  await tick()
  assert.equal(canceled, 1)
})

test('a delayed encrypted preflight cannot publish a revoked or changed session/device', async t => {
  for (const variant of ['revoked', 'token', 'device']) {
    const started = deferred()
    const release = deferred()
    let currentSession = { ...session }
    let currentGuid = device.guid
    const payload = encrypted(flac())
    const h = harness(t, { quality: 'lossless', getDevice: () => ({ guid: currentGuid }),
      client: { checkLogin: async () => currentSession !== null,
        getSession: async () => currentSession && { ...currentSession } },
      fetch: async (url, options) => {
        if (options.method === 'HEAD') { started.resolve(); await release.promise }
        return serving(payload, [])(url, options)
      } })
    const pending = h.resolver.resolve().then(source => { source.decoder.key?.fill(0); return source })
    await started.promise
    if (variant === 'revoked') currentSession = null
    if (variant === 'token') currentSession = { ...session, access_token: 'public-replaced-token' }
    if (variant === 'device') currentGuid = 'public-new-device-guid'
    release.resolve()
    await assert.rejects(pending, error => safeError(error,
      variant === 'revoked' ? 'LOGIN' : variant === 'token' ? 'SESSION' : 'DEVICE'))
  }
})

test('a cache hit straddling session revocation cannot transfer its key or authorization', async t => {
  const started = deferred()
  const release = deferred()
  let currentSession = { ...session }
  let holdLookup = false
  const h = harness(t, { quality: 'lossless', fetch: serving(encrypted(flac()), []),
    client: { checkLogin: async () => currentSession !== null,
      getSession: async () => currentSession && { ...currentSession } },
    getDevice: async () => {
      if (holdLookup) { holdLookup = false; started.resolve(); await release.promise }
      return { ...device }
    } })
  const first = await h.resolver.resolve()
  first.decoder.key.fill(0)
  holdLookup = true
  const pending = h.resolver.resolve().then(source => { source.decoder.key?.fill(0); return source })
  await started.promise
  currentSession = null
  release.resolve()
  await assert.rejects(pending, error => safeError(error, 'LOGIN'))
  assert.equal(h.calls.length, 1)
})

test('uint64 preflight lengths and suffix offsets remain exact beyond JavaScript safe integer', async t => {
  const total = 18446744073709551615n
  const calls = []
  const h = harness(t, { fetch: async (_url, options) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': total.toString() } })
    calls.push(options.headers.Range)
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const count = Number(BigInt(b) - BigInt(a) + 1n)
    return new Response(a === '0' ? mp3().subarray(0, count) : Buffer.alloc(count), { status: 206,
      headers: { 'Content-Range': `bytes ${a}-${b}/${total}`, 'Content-Length': String(count) } })
  } })
  const source = await h.resolver.resolve()
  assert.equal(source.decoder.length, total.toString())
  assert.deepEqual(calls, ['bytes=0-127', `bytes=${total - 1027n}-${total - 1n}`])
})

test('resolver integrates with the real loopback proxy and excludes encrypted footer bytes', async t => {
  const plain = flac()
  const payload = encrypted(plain, 'musicex')
  const fetch = serving(payload, [])
  const h = harness(t, { quality: 'lossless', fetch })
  const proxy = new WindowsAudioProxy({ allowedOrigins: WINDOWS_MEDIA_ALLOWED_ORIGINS, fetch, now: () => 1000 })
  t.after(() => proxy.close())
  const lease = await proxy.open({ resolve: h.resolver.resolve })
  assert.match(lease.url, /^http:\/\/127\.0\.0\.1:\d+\/audio\/[a-f0-9]{48}$/)
  assert.equal(lease.bytes, plain.length)
  assert.notEqual(lease.bytes, payload.length)
  const response = await new Promise((resolve, reject) => {
    const req = request(lease.url, { headers: { Range: 'bytes=0-41' } }, res => {
      const chunks = []
      res.on('data', bytes => chunks.push(bytes))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(response.status, 206)
  assert.equal(response.headers['content-range'], 'bytes 0-41/2048')
  assert.deepEqual(response.bytes, plain.subarray(0, 42))
  assert.equal(h.calls.length, 1)
  await lease.release()
})
