import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { activate, deactivate } from './windows-index.mjs'
import { WindowsMediaStream } from './lib/windows/media-stream.mjs'
import { WindowsAudioProxy } from './lib/windows/audio-proxy.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
const session = { openid: 'public-openid', access_token: 'public-access', refresh_token: 'public-refresh',
  musickey: 'public-key', unionid: '', refresh_key: '', encryptUin: '', musicid: 123,
  musickeyCreateTime: 1, expired_at: Math.floor(Date.now() / 1000) + 3600, loginType: 2 }

function harness({ qrStatus = { status: 'waiting' }, onRequest, mediaFetch } = {}) {
  const storage = new Map()
  let provider
  let polls = 0
  const context = { settings: { get: async key => storage.get(key), set: async (key, value) => { storage.set(key, value) },
    delete: async key => { storage.delete(key) } }, twilight: {
    providers: { register: async value => { provider = value } }, qqAuth: {
      clear: async () => {}, getQrLogin: async () => ({ key: 'opaque-public-test-key', imageDataUrl: 'data:image/png;base64,public', expiresAt: Date.now() + 600000 }),
      checkQrLogin: async () => { polls++; await new Promise(resolve => setImmediate(resolve)); return qrStatus }
    },
    ui: { register: async () => {}, onCommand: () => () => {} }
  } }
  return { context, storage, get provider() { return provider }, get polls() { return polls },
    fetch: async (_url, options) => {
      if (!options.body && mediaFetch) return mediaFetch(_url, options)
      const request = JSON.parse(options.body.toString())
      const key = Object.keys(request).find(key => key !== 'comm')
      if (onRequest) return onRequest(request, key)
      const data = key === 'music.search.SearchCgiService'
        ? { meta: fixture.meta, body: { song: { list: fixture.publicSongs } } } : session
      return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
    }
  }
}

const qualityFields = { '128': 'size_128mp3', '320': 'size_320mp3', flac: 'size_flac',
  hires: 'size_hires', dolby: 'size_dolby', surround: 'size_dts' }
const qualityPrefixes = { M500: '128', M800: '320', F0M0: 'flac', RSM1: 'hires', D0M1: 'dolby', D0MA: 'surround' }
function terminalReason(error) {
  const match = / \[TE-ERR:provider\.playbackUnavailable:reason=([^\]]+)\]$/.exec(error.message)
  assert.ok(match, 'same-track failures must stop host re-matching after IPC')
  const reason = decodeURIComponent(match[1])
  assert.equal(/PRIVATE|https?:\/\/|vkey=|PUBLIC_RAW/.test(reason), false)
  return reason
}
function fallbackHarness({ sizes = {}, outcome = () => 'success', onAttempt } = {}) {
  const song = structuredClone(fixture.publicSongs[0])
  for (const [quality, field] of Object.entries(qualityFields)) {
    song.file[field] = Object.hasOwn(sizes, quality) ? sizes[quality] : 1000
    if (song.file[field] === undefined) delete song.file[field]
  }
  const vectorList = JSON.parse(readFileSync(new URL('./test/fixtures/windows-ekey-native-v1.json', import.meta.url))).vectors
  const v = vectorList.find(value => value.key_length > 300) ?? vectorList[0]
  const ekey = Buffer.from(v.encoded_ekey_hex, 'hex').toString('ascii')
  const plain = Object.fromEntries(Object.keys(qualityFields).map(quality => {
    const audio = Buffer.alloc(2048, 7)
    if (quality === '128' || quality === '320') { audio.write('ID3'); audio[3] = 4; audio.fill(0, 6, 10) }
    else if (quality === 'dolby') { audio.writeUInt32BE(16, 0); audio.write('ftypM4A ', 4) }
    else { audio.write('fLaC'); audio[4] = 0; audio.writeUIntBE(34, 5, 3) }
    return [quality, audio]
  }))
  const payloads = Object.fromEntries(Object.entries(plain).map(([quality, audio]) => {
    if (quality === '128' || quality === '320') return [quality, audio]
    const transform = new WindowsMediaStream(Buffer.from(v.internal_key_hex, 'hex'))
    const cipher = transform.transform(Buffer.from(audio), '0')
    transform.dispose()
    return [quality, cipher]
  }))
  const attempts = [], mediaRequests = [], writes = [], apiRequests = []
  let details = 0
  const h = harness({ onRequest: async (request, key) => {
    let data = session
    apiRequests.push(key)
    assert.notEqual(key, 'VipLogin.VipLoginInter.vip_login_base')
    if (key === 'Protocol_UpdateSongInfo') {
      details++
      assert.deepEqual(request[key].param, { ids: [97773], types: [0], ctx: 0, scene: 0 })
      data = { tracks: [song] }
    }
    if (key === 'queryvkey') {
      const call = request[key], filename = call.param.filename[0]
      const quality = qualityPrefixes[filename.slice(0, 4)]
      assert.ok(quality)
      assert.deepEqual(call.param.songmid, ['0039MnYb0qxYhV'])
      assert.equal(filename.includes('003Qui1q2u1Zho'), true)
      attempts.push(quality)
      await onAttempt?.(quality, h)
      const result = await outcome(quality)
      if (result === 'network') throw Object.assign(Error('PRIVATE_NETWORK_AND_TOKEN'), { code: 22 })
      data = { retcode: typeof result === 'number' ? result : 0, midurlinfo: [{ filename,
        songmid: song.mid, result: 0, purl: result === 'empty' ? '' : `/public-${quality}`,
        ekey: result === 'invalid-key' ? 'PRIVATE_BAD_KEY' : ekey }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async (value, options) => {
    const quality = new URL(value).pathname.slice('/public-'.length)
    mediaRequests.push(quality)
    const result = await outcome(quality)
    if (result === 'http') return new Response(null, { status: 403 })
    const audio = result === 'bad-header' ? Buffer.alloc(2048) : payloads[quality]
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(audio.length) } })
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const start = Number(match[1]), end = Number(match[2])
    return new Response(audio.subarray(start, end + 1), { status: 206, headers: {
      'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${audio.length}` } })
  } })
  const set = h.context.settings.set
  h.context.settings.set = async (key, value) => { writes.push(key); return set(key, value) }
  h.storage.set('windows-auth', session)
  return { ...h, get provider() { return h.provider }, attempts, mediaRequests, plain, writes, apiRequests, get details() { return details } }
}

test('the registered Windows provider writes only safe proxy failure records to its normal logger', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch, messages = [], h = fallbackHarness()
  let fail = false
  h.context.logger = { warn: message => messages.push(message) }
  globalThis.fetch = (url, options) => fail && !options.body
    ? Promise.resolve(new Response(null, { status: 416 })) : h.fetch(url, options)
  try {
    await activate(h.context)
    const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'flac' }, {})
    fail = true
    assert.equal((await original(result.streamUrl)).status, 502)
    assert.deepEqual(messages, ['QQ audio proxy failure: {"phase":"upstream","code":"UPSTREAM_STATUS","httpStatus":416}'])
    assert.equal(/https?:|vkey|PUBLIC|sourceId|fingerprint|session|access_token/.test(messages.join('')), false)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('retired composite selections use the same recording in ordinary128 without any effect or VIP RPC', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const retired of ['excellent', 'excellentSpatial']) {
    for (const persisted of [false, true]) {
      const h = fallbackHarness()
      if (persisted) h.storage.set('windows-playback-quality', retired)
      globalThis.fetch = h.fetch
      try {
        await activate(h.context)
        const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' },
          persisted ? {} : { quality: retired }, {})
        assert.deepEqual(h.attempts, ['128'])
        assert.equal(h.details, 1)
        assert.equal(result.providerSource.actualQuality, '128')
        assert.equal(Object.hasOwn(result.providerSource, 'effect'), false)
        assert.equal(result.providerSource.bytes, h.plain['128'].length)
        assert.equal(h.apiRequests.includes('VipLogin.VipLoginInter.vip_login_base'), false)
        if (persisted) {
          assert.equal(h.storage.get('windows-playback-quality'), '128')
          assert.equal((await h.provider.getPlaybackQuality({})).quality, '128')
          assert.equal(h.writes.filter(key => key === 'windows-playback-quality').length, 1)
        }
      } finally { await deactivate(); globalThis.fetch = original }
    }
  }
})

test('read-ahead duration hint belongs to the freshly fetched TrackInfo rather than renderer fields or quality sizes', { skip: process.platform !== 'win32' }, async () => {
  const originalFetch = globalThis.fetch, originalOpen = WindowsAudioProxy.prototype.open
  const hints = [], h = fallbackHarness({ sizes: { hires: 123456789 } })
  WindowsAudioProxy.prototype.open = function(options) {
    hints.push(options.durationSeconds)
    return originalOpen.call(this, options)
  }
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773', duration: 1, interval: 1 },
      { quality: 'hires', durationSeconds: 1 }, {})
    assert.deepEqual(hints, [fixture.publicSongs[0].interval])
    assert.equal(h.details, 1)
    assert.equal(result.providerSource.bytes, 2048)
    assert.equal(Object.hasOwn(result.providerSource, 'durationSeconds'), false)
  } finally { await deactivate(); globalThis.fetch = originalFetch; WindowsAudioProxy.prototype.open = originalOpen }
})

test('same-track spatial fallback tries each candidate once, preserves preference, and binds one real loopback source', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = fallbackHarness({ outcome: quality => quality === 'dolby' ? 22 : quality === 'hires' ? 'empty' : 'success' })
  h.storage.set('windows-playback-quality', 'dolby')
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, {}, {})
    assert.deepEqual(h.attempts, ['dolby', 'hires', 'flac'])
    assert.equal(h.details, 1)
    assert.equal(result.providerSource.actualQuality, 'flac')
    assert.equal(result.providerSource.bytes, h.plain.flac.length)
    assert.equal(h.storage.get('windows-playback-quality'), 'dolby')
    assert.equal(h.writes.includes('windows-playback-quality'), false)
    const response = await original(result.streamUrl)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), h.plain.flac)
    assert.deepEqual(h.attempts, ['dolby', 'hires', 'flac'])
    assert.equal(h.mediaRequests.every(quality => quality === 'flac'), true)
    await h.provider.logout({})
    assert.equal((await original(result.streamUrl)).status, 404)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('zero-size quality flags cause no issuer attempts while unknown metadata can verify and play', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const [sizes, expected] of [[{ dolby: 0, hires: 0, flac: undefined }, ['flac']],
    [{ dolby: 0, hires: 0, flac: 0, '320': 0, '128': 0 }, []]]) {
    const h = fallbackHarness({ sizes })
    globalThis.fetch = h.fetch
    try {
      await activate(h.context)
      const pending = h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'dolby' }, {})
      if (expected.length) assert.equal((await pending).providerSource.actualQuality, 'flac')
      else await assert.rejects(pending, error => terminalReason(error) === '当前歌曲没有可用的播放音质')
      assert.deepEqual(h.attempts, expected)
      assert.equal(h.details, 1)
    } finally { await deactivate(); globalThis.fetch = original }
  }
})

test('ordinary fallback does not upgrade and spatial fallback never tries the other spatial preference', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const [quality, expected] of [['128', ['128']], ['320', ['320', '128']],
    ['flac', ['flac', '320', '128']], ['hires', ['hires', 'flac', '320', '128']],
    ['dolby', ['dolby', 'hires', 'flac', '320', '128']], ['surround', ['surround', 'hires', 'flac', '320', '128']]]) {
    const h = fallbackHarness({ outcome: () => 22 })
    globalThis.fetch = h.fetch
    try {
      await activate(h.context)
      await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality }, {}), error =>
        terminalReason(error) === 'QQ 音乐服务端拒绝所选音质（22）')
      assert.deepEqual(h.attempts, expected)
      assert.equal(h.details, 1)
      assert.equal(h.mediaRequests.length, 0)
      assert.equal(h.writes.includes('windows-playback-quality'), false)
    } finally { await deactivate(); globalThis.fetch = original }
  }
})

test('HTTP, transport, unknown issuer codes and invalid bytes or keys terminate without quality retries', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const failure of ['http', 'network', 23, 'invalid-key', 'bad-header']) {
    const h = fallbackHarness({ outcome: () => failure })
    globalThis.fetch = h.fetch
    try {
      await activate(h.context)
      await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'flac' }, {}), error => {
        assert.ok(terminalReason(error))
        return true
      })
      assert.deepEqual(h.attempts, ['flac'])
    } finally { await deactivate(); globalThis.fetch = original }
  }
})

test('abort, logout, deactivation or account change during a failed attempt cannot continue the fallback chain', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const action of ['abort', 'logout', 'deactivate', 'account-change']) {
    let announce, release
    const started = new Promise(resolve => { announce = resolve })
    const held = new Promise(resolve => { release = resolve })
    const h = fallbackHarness({ outcome: () => 22, onAttempt: async () => { announce(); await held } })
    const controller = new AbortController()
    globalThis.fetch = h.fetch
    try {
      await activate(h.context)
      const pending = h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'dolby' }, { signal: controller.signal })
      const rejected = assert.rejects(pending, error => { assert.ok(terminalReason(error)); return true })
      await started
      if (action === 'abort') controller.abort()
      else if (action === 'logout') await h.provider.logout({})
      else if (action === 'deactivate') await deactivate()
      else h.storage.set('windows-auth', { ...session, musicid: 456 })
      release()
      await rejected
      assert.deepEqual(h.attempts, ['dolby'])
      assert.equal(h.mediaRequests.length, 0)
    } finally { release(); await deactivate(); globalThis.fetch = original }
  }
})

test('login, cancellation, closed provider and invalid arguments all carry the terminal playback contract', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = fallbackHarness()
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const track = { id: 'qq:0039MnYb0qxYhV:97773' }
    const aborted = new AbortController(); aborted.abort()
    await assert.rejects(h.provider.getPlaybackUrl(track, {}, { signal: aborted.signal }), error => {
      assert.equal(error.name, 'AbortError'); return terminalReason(error) === 'QQ 音乐播放已取消'
    })
    await assert.rejects(h.provider.getPlaybackUrl(track, [], {}), error => terminalReason(error) === 'QQ 音乐音质参数无效')
    await assert.rejects(h.provider.getPlaybackUrl(track, { quality: 'auto' }, {}), error => terminalReason(error) === 'QQ 音乐音质参数无效')
    await h.provider.logout({})
    await assert.rejects(h.provider.getPlaybackUrl(track, {}, {}), error => terminalReason(error) === '请先使用手机 QQ 扫码登录')
    const provider = h.provider
    await deactivate()
    await assert.rejects(provider.getPlaybackUrl(track, {}, {}), error => {
      assert.equal(error.name, 'AbortError'); return terminalReason(error) === 'QQ 音乐音源已停用'
    })
  } finally { await deactivate(); globalThis.fetch = original }
})

test('a lease created before late cancellation or account replacement is revoked without publishing or retrying', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const open = WindowsAudioProxy.prototype.open
  for (const action of ['abort', 'account-change']) {
    const h = fallbackHarness()
    const controller = new AbortController()
    let leaseUrl
    WindowsAudioProxy.prototype.open = async function (options) {
      const lease = await open.call(this, options)
      leaseUrl = lease.url
      if (action === 'abort') controller.abort()
      else h.storage.set('windows-auth', { ...session, musicid: 456 })
      return lease
    }
    globalThis.fetch = h.fetch
    try {
      await activate(h.context)
      await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' },
        { quality: 'dolby' }, { signal: controller.signal }), error => { assert.ok(terminalReason(error)); return true })
      assert.ok(leaseUrl)
      assert.equal((await original(leaseUrl)).status, 404)
      assert.deepEqual(h.attempts, ['dolby'])
    } finally {
      WindowsAudioProxy.prototype.open = open
      await deactivate()
      globalThis.fetch = original
    }
  }
})

test('same-account token replacement after a trusted quality refusal stops before the next candidate', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = fallbackHarness({ outcome: quality => quality === 'dolby' ? 22 : 'success',
    onAttempt: async (_quality, internal) => internal.storage.set('windows-auth', { ...session, access_token: 'public-replacement-token' }) })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'dolby' }, {}),
      error => { assert.equal(error.name, 'AbortError'); return terminalReason(error) === 'QQ 音乐会话已变化，播放已取消' })
    assert.deepEqual(h.attempts, ['dolby'])
    assert.equal(h.mediaRequests.length, 0)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('same-account token replacement after lease creation revokes the lease instead of publishing it', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const open = WindowsAudioProxy.prototype.open
  const h = fallbackHarness()
  let leaseUrl
  WindowsAudioProxy.prototype.open = async function (options) {
    const lease = await open.call(this, options)
    leaseUrl = lease.url
    h.storage.set('windows-auth', { ...session, access_token: 'public-replacement-token' })
    return lease
  }
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'dolby' }, {}),
      error => { assert.equal(error.name, 'AbortError'); return terminalReason(error) === 'QQ 音乐会话已变化，播放已取消' })
    assert.ok(leaseUrl)
    assert.equal((await original(leaseUrl)).status, 404)
    assert.deepEqual(h.attempts, ['dolby'])
  } finally { WindowsAudioProxy.prototype.open = open; await deactivate(); globalThis.fetch = original }
})

test('Windows entry registers observed search and remotely verified login methods', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = harness()
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    assert.ok(h.provider.capabilities.includes('search'))
    assert.equal(h.provider.capabilities.includes('playbackUrl'), true)
    const result = await h.provider.searchSongs('晴天', 2, 0, { signal: new AbortController().signal })
    assert.equal(result.items[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal(result.total, 997)
    assert.match(h.storage.get('windows-device').guid, /^[a-f0-9]{32}$/)
    assert.deepEqual(await h.provider.checkLogin({}), { loggedIn: false, profile: null })
    await assert.rejects(h.provider.getPlaybackUrl(result.items[0], {}, {}), /扫码登录/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('registered artist methods use the current Windows session and shared canonical album identities', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const artist = 'qq:artist:0025NhlN2yWrP4:4558'
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    requests.push(request[key])
    let data = session
    if (key.endsWith('.GetSingerSongList')) data = { singerMid: '0025NhlN2yWrP4', totalNum: 1, songList: [{ songInfo: fixture.publicSongs[0] }] }
    if (key.endsWith('.GetSingerDetail')) data = { singer_list: [{ basic_info: { singer_mid: '0025NhlN2yWrP4', singer_id: 4558, name: '周杰伦' }, ex_info: { desc: 'public artist description' } }] }
    if (key.endsWith('.GetAlbumList')) data = { singerMid: '0025NhlN2yWrP4', total: 1, albumList: [{ albumID: 1458791, albumMid: '003RMaRI1iFoYd', albumName: '周杰伦的床边故事', totalNum: 10, publishDate: '2016-06-24', singerName: '周杰伦' }] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.equal((await h.provider.fetchArtistTopSongs(artist, {}))[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal(await h.provider.fetchArtistIntro(artist, {}), 'public artist description')
    const albums = await h.provider.fetchArtistAlbums(artist, {})
    assert.equal(albums[0].id, 'qq:album:003RMaRI1iFoYd:1458791')
    assert.equal(albums[0].trackCount, 10)
    assert.deepEqual(requests.find(call => call.method === 'GetSingerSongList').param,
      { singerMid: '0025NhlN2yWrP4', begin: 0, num: 10, order: 1 })
  } finally { await deactivate(); globalThis.fetch = original }
})

test('logout during a public artist request cannot commit an earlier account response', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    let data = session
    if (key.endsWith('.GetSingerSongList')) {
      announce(); await held
      data = { singerMid: '0025NhlN2yWrP4', totalNum: 1, songList: [{ songInfo: fixture.publicSongs[0] }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.fetchArtistTopSongs('qq:artist:0025NhlN2yWrP4:4558', {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('Home sections dispatch distinct current-session Daily and latest reads and real-supplied playlist references', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.method === 'get_recommend_feed') data = { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: [{ id: '42', title: '每日30首' }] }] }] }
    if (call.module === 'music.srfDissInfo.aiDissInfo') data = { code: 0, subcode: 0, dirinfo: { id: 42, songnum: 1 }, total_song_num: 1, hasmore: 0, songlist: [fixture.publicSongs[0]] }
    if (call.method === 'get_new_song_info') data = { songlist: fixture.publicSongs }
    if (call.method === 'get_new_hot_recommend') data = { grids: [{ id: 42, type: 10014, title: 'public synthetic recommendation', picurl: '', creator: { uin: '987', nick: 'public' } }] }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') {
      assert.equal(call.param.login_uin, session.musicid)
      assert.equal(call.param.host_uin, session.musicid)
      assert.equal(Object.hasOwn(call.param, 'dirid'), false)
      data = { code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
        total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.deepEqual(h.provider.ui.streamingSections.map(s => s.args), [['daily'], ['latest']])
    assert.equal((await h.provider.fetchRecommendSongs('daily', {}))[0].id, 'qq:0039MnYb0qxYhV:97773')
    assert.equal((await h.provider.fetchRecommendSongs('latest', {})).length, fixture.publicSongs.length)
    assert.equal((await h.provider.fetchRecommendPlaylists({}))[0].id, 'qq:playlist:0:42')
    const daily = requests.find(call => call.module === 'music.srfDissInfo.aiDissInfo')
    assert.equal(daily.param.disstid, 42)
    assert.match(daily.param.guid, /^[a-f0-9]{32}$/)
    assert.equal(requests.filter(call => call.method === 'get_recommend_feed').length, 1)
    await assert.rejects(h.provider.fetchRecommendSongs('soaring', {}), /分区无效/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('public playlist search binds the actual native owner instead of its source creator', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.module === 'music.search.SearchCgiService') data = { meta: { sum: 300 }, body: { songlist: { list: [
      { dissid: 42, dissname: 'Public synthetic playlist', imgurl: '', song_count: 99, creator: { creator_uin: '987', name: 'Public creator' } }
    ] } } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') data = {
      code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
      total_song_num: 1, songlist: [fixture.publicSongs[0]]
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const result = await h.provider.searchPlaylists('public', 1, 0, {})
    assert.equal(result.total, 300)
    assert.equal(result.items[0].id, 'qq:playlist:0:42')
    assert.equal(result.items[0].trackCount, 1)
    const detail = requests.find(call => call.module === 'music.srfDissInfo.DissInfoForPc')
    assert.equal(detail.param.login_uin, session.musicid)
    assert.equal(detail.param.host_uin, session.musicid)
    assert.equal(Object.hasOwn(detail.param, 'dirid'), false)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('logout during a public search playlist binding cannot publish earlier account references', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    const call = request[key]
    let data = session
    if (call.module === 'music.search.SearchCgiService') data = { meta: { sum: 1 }, body: { songlist: { list: [
      { dissid: 42, dissname: 'Public synthetic playlist', imgurl: '', creator: { creator_uin: '987', name: 'Public creator' } }
    ] } } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') {
      announce(); await held
      data = { code: 0, subcode: 0, dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } },
        total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.searchPlaylists('public', 1, 0, {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('logout while the bound Daily detail is pending cannot publish its earlier account tracks', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let release, announce
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { announce = resolve })
  const h = harness({ onRequest: async (request, key) => {
    let data = session
    if (request[key].method === 'get_recommend_feed') data = { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: [{ id: '42', title: '每日30首' }] }] }] }
    if (request[key].module === 'music.srfDissInfo.aiDissInfo') {
      announce(); await held
      data = { code: 0, subcode: 0, dirinfo: { id: 42, songnum: 1 }, total_song_num: 1, hasmore: 0, songlist: [fixture.publicSongs[0]] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const loading = h.provider.fetchRecommendSongs('daily', {})
    const rejected = assert.rejects(loading, /取消|登录|会话/)
    await started
    await h.provider.logout({})
    release()
    await rejected
  } finally { release(); await deactivate(); globalThis.fetch = original }
})

test('registered discovery uses source taxonomy, unknown feed totals and the shared native playlist identity binder', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const basic = { tid: 42, title: 'Public synthetic playlist', creator: { uin: '', nick: 'Public creator' },
    cover: { medium_url: '' }, song_cnt: 99 }
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    requests.push(call)
    let data = session
    if (call.method === 'GetAllTag') data = { v_group: [{ group_id: 6, group_name: '语种',
      v_item: [{ id: 5, name: '日语', source: 0 }, { id: 9527, name: 'AI歌单', source: 1 }] }] }
    if (call.method === 'GetRecommendWhole') data = { FeedRsp: { FromLimit: 400, HasMore: false,
      List: [{ Playlist: { basic } }] } }
    if (call.method === 'get_category_content') data = { retcode: 0, content: { total_cnt: 1, v_item: [{ basic }] } }
    if (call.module === 'music.srfDissInfo.DissInfoForPc') data = { code: 0, subcode: 0,
      dirinfo: { id: 42, host_uin: 0, creator: { musicid: 0 } }, total_song_num: 1, songlist: [fixture.publicSongs[0]] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    assert.equal(h.provider.ui.streamingDiscovery.supportsSort, false)
    const catalogue = await h.provider.fetchPlaylistCategories({})
    assert.equal(catalogue.groups[0].tags.length, 1)
    assert.equal(catalogue.groups[0].tags[0].name, '日语')
    const feed = await h.provider.fetchDiscoveryPlaylists('全部', 'hot', 30, 0, {})
    assert.equal(feed.items[0].id, 'qq:playlist:0:42')
    assert.equal(feed.items[0].trackCount, 1)
    assert.equal(feed.total, 0)
    assert.equal(feed.hasMore, false)
    const category = await h.provider.fetchDiscoveryPlaylists('日语', 'hot', 30, 0, {})
    assert.equal(category.total, 1)
    assert.equal(category.items[0].id, 'qq:playlist:0:42')
    const content = requests.find(call => call.method === 'get_category_content')
    assert.equal(content.param.caller, String(session.musicid))
    assert.equal(content.param.category_id, 5)
    assert.equal(content.param.page, 0)
    assert.equal(content.param.size, 30)
    assert.equal(requests.find(call => call.method === 'GetAllTag').param.qq, '')
    await assert.rejects(h.provider.fetchDiscoveryPlaylists('日语', 'new', 30, 0, {}), /发现数据无法验证/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('persisted dual IDs resolve native scene0 details and play through a revocable loopback URL', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const audio = Buffer.alloc(2048, 7)
  audio.write('ID3'); audio[3] = 4; audio.fill(0, 6, 10)
  let details = 0
  const h = harness({ onRequest: (request, key) => {
    const call = request[key]
    let data = session
    if (key === 'Protocol_UpdateSongInfo') {
      details++
      assert.deepEqual(call.param, { ids: [97773], types: [0], ctx: 0, scene: 0 })
      data = { tracks: [fixture.publicSongs[0]] }
    }
    if (key === 'queryvkey') {
      assert.equal(call.module, 'music.vkey.GetVkey')
      const filename = call.param.filename[0]
      data = { retcode: 0, sip: ['https://dl.stream.qqmusic.qq.com/'],
        midurlinfo: [{ result: 0, songmid: '0039MnYb0qxYhV', filename, purl: `${filename}?vkey=public`, ekey: '' }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async (_url, options) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(audio.length) } })
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const first = Number(match[1]), last = Number(match[2])
    return new Response(audio.subarray(first, last + 1), { status: 206,
      headers: { 'Content-Length': String(last - first + 1), 'Content-Range': `bytes ${first}-${last}/${audio.length}` } })
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: '128' }, {})
    const url = result.streamUrl
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/audio\/[a-f0-9]{48}$/)
    assert.equal(result.providerSource.bytes, audio.length)
    assert.equal(Number.isSafeInteger(result.providerSource.expiresAt), true)
    assert.deepEqual(Object.keys(result.providerSource).sort(), ['actualQuality', 'bytes', 'expiresAt'])
    assert.equal(result.providerSource.actualQuality, '128')
    assert.equal(JSON.stringify(result).includes('vkey'), false)
    assert.equal(details, 1)
    const response = await original(url)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio)
    await h.provider.logout({})
    assert.equal((await original(url)).status, 404)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('per-track qualities use fresh exact scene0 details and do not alter the global preference', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let details = 0
  const h = harness({ onRequest: (request, key) => {
    let data = session
    if (key === 'music.search.SearchCgiService') data = { meta: fixture.meta, body: { song: { list: fixture.publicSongs } } }
    if (key === 'Protocol_UpdateSongInfo') {
      assert.deepEqual(request[key].param, { ids: [97773], types: [0], ctx: 0, scene: 0 })
      const song = structuredClone(fixture.publicSongs[0])
      Object.assign(song.file, { size_dolby: ++details * 1000, size_hires: 0 })
      delete song.file.size_dts
      data = { tracks: [{ ...song, id: 123 }, { ...song, mid: '004Fs2FP1EvZYc' }, song] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  h.storage.set('windows-playback-quality', 'surround')
  try {
    await activate(h.context)
    const { items } = await h.provider.searchSongs('晴天', 2, 0, {})
    for (const bytes of [1000, 2000]) {
      const result = await h.provider.getTrackPlaybackQualities(items[0], {})
      assert.equal(result.trackId, items[0].id)
      assert.equal(result.options.find(option => option.value === 'dolby').metadataSize, bytes)
      assert.equal(result.options.find(option => option.value === 'hires').availability, 'unavailable')
      assert.equal(result.options.find(option => option.value === 'surround').availability, 'unknown')
      assert.equal(h.storage.get('windows-playback-quality'), 'surround')
    }
    assert.equal(details, 2)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('per-track quality queries reject canceled or revoked account responses without publishing stale options', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  for (const action of ['abort', 'logout', 'deactivate']) {
    let release, announce
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { announce = resolve })
    const h = harness({ onRequest: async (_request, key) => {
      if (key === 'Protocol_UpdateSongInfo') {
        announce()
        await held
        return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: { tracks: fixture.publicSongs } } }))
      }
      return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: session } }))
    } })
    globalThis.fetch = h.fetch
    h.storage.set('windows-auth', session)
    try {
      await activate(h.context)
      const controller = new AbortController()
      const pending = h.provider.getTrackPlaybackQualities({ id: 'qq:0039MnYb0qxYhV:97773' }, { signal: controller.signal })
      const rejected = assert.rejects(pending, /取消|停用|登录/)
      await started
      if (action === 'abort') controller.abort()
      else if (action === 'logout') await h.provider.logout({})
      else await deactivate()
      release()
      await rejected
    } finally { release(); await deactivate(); globalThis.fetch = original }
  }
})

test('per-track qualities reject an unrelated detail and explicit absent media never reaches Vkey', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let invalid = true
  let issuers = 0
  const h = harness({ onRequest: (_request, key) => {
    let data = session
    if (key === 'Protocol_UpdateSongInfo') {
      const song = structuredClone(fixture.publicSongs[0])
      Object.assign(song.file, { size_dolby: 0, size_hires: 0, size_flac: 0, size_320mp3: 0, size_128mp3: 0 })
      data = { tracks: invalid ? [{ ...song, id: 123 }, { ...song, mid: '004Fs2FP1EvZYc' }] : [song] }
    }
    if (key === 'queryvkey') { issuers++; throw Error('PRIVATE_ISSUER_SHOULD_NOT_RUN') }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const track = { id: 'qq:0039MnYb0qxYhV:97773' }
    await assert.rejects(h.provider.getTrackPlaybackQualities(track, {}), /歌曲详情无效/)
    invalid = false
    await assert.rejects(h.provider.getPlaybackUrl(track, { quality: 'dolby' }, {}), /当前歌曲没有可用的播放音质.*TE-ERR:provider.playbackUnavailable/)
    assert.equal(issuers, 0)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('normal encrypted playback envelope reports decrypted bytes after footer removal without leaking upstream identity', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const vectors = JSON.parse(readFileSync(new URL('./test/fixtures/windows-ekey-native-v1.json', import.meta.url))).vectors
  const vector = vectors.find(value => value.key_length > 300) ?? vectors[0]
  const encoded = Buffer.from(vector.encoded_ekey_hex, 'hex').toString('ascii')
  const audio = Buffer.alloc(2048, 7)
  audio.write('fLaC'); audio[4] = 0; audio.writeUIntBE(34, 5, 3)
  const transformer = new WindowsMediaStream(Buffer.from(vector.internal_key_hex, 'hex'))
  const cipher = transformer.transform(Buffer.from(audio), '0')
  transformer.dispose()
  const footer = Buffer.concat([Buffer.from(encoded), Buffer.alloc(4)])
  footer.writeUInt32LE(encoded.length, footer.length - 4)
  const upstream = Buffer.concat([cipher, footer])
  const h = harness({ onRequest: (request, key) => {
    let data = session
    if (key === 'Protocol_UpdateSongInfo') data = { tracks: fixture.publicSongs }
    if (key === 'queryvkey') {
      assert.equal(request[key].module, 'music.vkey.GetEVkey')
      data = { retcode: 0, midurlinfo: [{ result: 0, songmid: fixture.publicSongs[0].mid,
        filename: request[key].param.filename[0], purl: '/public-cipher?vkey=PUBLIC_SYNTHETIC_KEY', ekey: encoded }] }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async (_url, options) => {
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(upstream.length) } })
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const first = Number(match[1]), last = Number(match[2])
    return new Response(upstream.subarray(first, last + 1), { status: 206,
      headers: { 'Content-Length': String(last - first + 1), 'Content-Range': `bytes ${first}-${last}/${upstream.length}` } })
  } })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    const result = await h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, { quality: 'flac' }, {})
    assert.equal(result.providerSource.bytes, audio.length)
    assert.notEqual(result.providerSource.bytes, upstream.length)
    assert.deepEqual(Object.keys(result.providerSource).sort(), ['actualQuality', 'bytes', 'expiresAt'])
    assert.equal(result.providerSource.actualQuality, 'flac')
    assert.equal(/PUBLIC_SYNTHETIC_KEY|stream.qqmusic|ekey|originSource/.test(JSON.stringify(result)), false)
    const response = await original(result.streamUrl)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('concurrent authorized polls exchange the official one-shot code once', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let exchanges = 0
  const h = harness({ qrStatus: { status: 'authorized', code: 'public-test-code' }, onRequest: (request, key) => {
    assert.equal(request[key].param.code, 'public-test-code')
    exchanges++
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: session } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const qr = await h.provider.getQrLogin({})
    const result = await Promise.all([h.provider.checkQrLogin(qr.key, {}), h.provider.checkQrLogin(qr.key, {})])
    assert.ok(result.every(item => item.code === 0 && item.profile.id === '123'))
    assert.equal(h.polls, 1)
    assert.equal(exchanges, 1)
    assert.equal(h.storage.get('windows-auth').musickey, 'public-key')
    await h.provider.logout({})
    assert.equal(h.storage.has('windows-auth'), false)
    assert.equal((await h.provider.checkQrLogin(qr.key, {})).code, 65)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('partial-page offset is applied once and invalid DTOs cannot cause unlimited pagination', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const pages = []
  const h = harness({ onRequest: (request, key) => {
    pages.push(request[key].param.page_num)
    const songs = [fixture.publicSongs[0], fixture.publicSongs[1]]
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0,
      data: { meta: { sum: 999999 }, body: { song: { list: songs } } } } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const result = await h.provider.searchSongs('晴天', 2, 1, {})
    assert.deepEqual(pages, [1, 2])
    assert.deepEqual(result.items.map(item => item.id), ['qq:004Fs2FP1EvZYc:244115385', 'qq:0039MnYb0qxYhV:97773'])
    await assert.rejects(h.provider.searchSongs('晴天', 2, -1, {}))
  } finally { await deactivate(); globalThis.fetch = original }
})

test('persisted track lyrics use native scene0 context and the verified plaintext Windows call', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const requests = []
  const text = '[00:01.00]public synthetic lyric'
  const h = harness({ onRequest: (request, key) => {
    requests.push({ key, call: request[key] })
    const data = key === 'Protocol_UpdateSongInfo' ? { tracks: [fixture.publicSongs[0]] }
      : { crypt: 0, qrc: 0, lyric: Buffer.from(text).toString('base64'), trans: '', roma: '' }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    assert.ok(h.provider.capabilities.includes('lyrics'))
    const result = await h.provider.getLyrics({ id: 'qq:0039MnYb0qxYhV:97773' }, {})
    assert.deepEqual(result, { lyrics: text, translatedLyrics: null, wordLyrics: null })
    assert.equal(requests[0].key, 'Protocol_UpdateSongInfo')
    assert.equal(requests[1].key, 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo')
    const p = requests[1].call.param
    assert.equal(p.songID, 97773)
    assert.equal(p.type, fixture.publicSongs[0].type)
    assert.equal(Buffer.from(p.songName, 'base64').toString(), fixture.publicSongs[0].name)
    assert.deepEqual([p.qrc, p.crypt, p.trans, p.roma], [0, 0, 0, 0])
  } finally { await deactivate(); globalThis.fetch = original }
})

test('a CDN status is reported as source validation failure without inventing account rights', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const h = harness({ onRequest: (request, key) => {
    const filename = request[key].param.filename?.[0]
    const data = key === 'Protocol_UpdateSongInfo' ? { tracks: [fixture.publicSongs[0]] }
      : key === 'queryvkey' ? { retcode: 0, midurlinfo: [{ result: 0, songmid: '0039MnYb0qxYhV',
        filename, purl: 'public-media' }] } : session
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  }, mediaFetch: async () => new Response(null, { status: 404 }) })
  globalThis.fetch = h.fetch
  h.storage.set('windows-auth', session)
  try {
    await activate(h.context)
    await assert.rejects(h.provider.getPlaybackUrl({ id: 'qq:0039MnYb0qxYhV:97773' }, {}, {}),
      error => error.message.startsWith('QQ 音乐音频请求失败（HTTP 404） [TE-ERR:provider.playbackUnavailable:reason='))
  } finally { await deactivate(); globalThis.fetch = original }
})

test('library and complete native playlist retain an unsupported record without losing the rest', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const special = structuredClone(fixture.publicSongs[0])
  Object.assign(special, { id: 97888, type: 21, data_type: 0, mid: '', title: 'Public synthetic special record' })
  special.file.media_mid = ''
  const h = harness({ onRequest: (request, key) => {
    let data = session
    if (key === 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin') data = {
      total: 1, bFinish: true, v_delTid: [], v_playlist: [{ uin: '123', tid: 99, dirId: 201,
        dirName: 'Public synthetic directory', songNum: 2, bigpicUrl: '', picUrl: '', nick: '' }] }
    if (key === 'music.musicasset.PlaylistFavRead') data = {
      number: 1, total: 1, hasmore: 0, hide: false, v_delTids: [77], v_failTids: [],
      v_list: [{ uin: '456', tid: 77, name: 'Public synthetic favorite', logo: '', songnum: 3, nickname: '', dirShow: 1 }] }
    if (key === 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo') {
      assert.equal(request[key].param.dirid, 201)
      data = { code: 0, subcode: 0, dirinfo: { id: 99, host_uin: 0, dirid: 201 },
        songlist: [fixture.publicSongs[0], special], total_song_num: 2 }
    }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  h.storage.set('windows-auth', session)
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const library = await h.provider.fetchUserLibrary(false, {})
    assert.equal(library.likedPlaylist.id, 'qq:playlist:123:99:201')
    // No speculative deletion rule is applied to an unproved favorite delta.
    assert.equal(library.playlists.length, 2)
    const tracks = await h.provider.fetchPlaylistTracks(library.likedPlaylist.id, false, {})
    assert.equal(tracks.length, 2)
    assert.equal(tracks[1].id, 'qq:native:21:97888')
    assert.equal(tracks[1].playbackStatus, 'unsupported')
    assert.equal(h.provider.fetchPlaylistTracksPage, undefined)
    await assert.rejects(h.provider.getPlaybackUrl(tracks[1], {}, {}), /QQ 音乐当前歌曲无法播放.*TE-ERR:provider.playbackUnavailable/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('incomplete library snapshots and an account change cannot commit a partial library', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  let changeAccount = false
  let h
  h = harness({ onRequest: (_request, key) => {
    let data = session
    if (key === 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin') {
      data = { total: 1, bFinish: false, v_delTid: [], v_playlist: [] }
      if (changeAccount) h.storage.set('windows-auth', { ...session, musicid: 456 })
    }
    if (key === 'music.musicasset.PlaylistFavRead') data = {
      number: 0, total: 0, hasmore: 0, hide: false, v_list: [], v_delTids: [], v_failTids: [] }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  h.storage.set('windows-auth', session)
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    await assert.rejects(h.provider.fetchUserLibrary(false, {}), /尚未返回完整/)
    changeAccount = true
    await assert.rejects(h.provider.fetchUserLibrary(false, {}), /请求已取消/)
  } finally { await deactivate(); globalThis.fetch = original }
})

test('displayable search metadata without a media MID reaches the existing native detail lookup', { skip: process.platform !== 'win32' }, async () => {
  const original = globalThis.fetch
  const partial = structuredClone(fixture.publicSongs[0])
  partial.file.media_mid = ''
  let details = 0
  const lyric = '[00:01.00]public synthetic lyric'
  const h = harness({ onRequest: (_request, key) => {
    let data = session
    if (key === 'music.search.SearchCgiService') data = { meta: { sum: 1 }, body: { song: { list: [partial] } } }
    if (key === 'Protocol_UpdateSongInfo') { details++; data = { tracks: [fixture.publicSongs[0]] } }
    if (key === 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo') data = {
      crypt: 0, qrc: 0, lyric: Buffer.from(lyric).toString('base64'), trans: '', roma: '' }
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data } }))
  } })
  globalThis.fetch = h.fetch
  try {
    await activate(h.context)
    const page = await h.provider.searchSongs('Public', 1, 0, {})
    assert.equal(page.items.length, 1)
    assert.equal((await h.provider.getLyrics(page.items[0], {})).lyrics, lyric)
    assert.equal(details, 1)
    await h.provider.getLyrics(page.items[0], {})
    assert.equal(details, 1)
  } finally { await deactivate(); globalThis.fetch = original }
})
