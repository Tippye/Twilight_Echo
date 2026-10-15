import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildWindowsOfficialPlaylistRecommendCall, buildWindowsLatestReleaseSongsCall,
  buildWindowsRecommendFeedCall, buildWindowsDailyDissCall,
  decodeWindowsLatestReleaseSongs, fetchWindowsLatestReleaseSongs, mapWindowsRecommendedPlaylistCandidate,
  decodeWindowsRecommendedPlaylistCandidates, fetchWindowsRecommendPlaylists,
  decodeWindowsDailyFeed, decodeWindowsDailySongs, fetchWindowsDailySongs,
  WINDOWS_LATEST_RELEASE_SONGS_REQUEST_KEY, WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY,
  WINDOWS_RECOMMEND_FEED_REQUEST_KEY, WINDOWS_DAILY_DISS_REQUEST_KEY,
  WINDOWS_EMBEDDED_HOME_PROVENANCE, WINDOWS_LATEST_RELEASE_PREVIEW_POLICY,
  WINDOWS_EMBEDDED_DAILY_PROVENANCE, WINDOWS_DAILY_FEED_POLICY } from './lib/windows/home-call.mjs'
import { WindowsRpcError } from './lib/windows/response.mjs'
import { WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY } from './lib/windows/playlist-call.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url))).publicSongs[0]
const rawSong = index => ({ ...structuredClone(fixture), id: index + 1,
  mid: String(index + 1).padStart(14, '0'), title: `Public synthetic release ${index}` })
const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'

test('two configured exact initial calls keep ownership and actual native-client compatibility provenance', () => {
  const official = buildWindowsOfficialPlaylistRecommendCall(), latest = buildWindowsLatestReleaseSongsCall()
  assert.equal(WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY, `${official.module}.${official.method}`)
  assert.equal(WINDOWS_LATEST_RELEASE_SONGS_REQUEST_KEY, `${latest.module}.${latest.method}`)
  assert.deepEqual(official.param, { cmd: 0, page: 0, daily_page: 0, size: 12 })
  assert.deepEqual(latest.param, { type: 5 })
  official.param.size = 30; latest.param.type = 0
  assert.equal(buildWindowsOfficialPlaylistRecommendCall().param.size, 12)
  assert.equal(buildWindowsLatestReleaseSongsCall().param.type, 5)
  assert.equal(WINDOWS_EMBEDDED_HOME_PROVENANCE.nativeClientTransport, 'compatibility-accepted-public-home-rpc')
  assert.ok(Object.isFrozen(WINDOWS_EMBEDDED_HOME_PROVENANCE))
})

test('latest source preview validates43 rows and returns their first20 in source order, without private extras', () => {
  const rows = Array.from({ length: 43 }, (_, index) => ({ ...rawSong(index), secret: marker }))
  const result = decodeWindowsLatestReleaseSongs({ songlist: rows, ret_msg: marker })
  assert.equal(result.length, 20)
  assert.deepEqual(result.map(track => track.id), rows.slice(0, 20).map(row => `qq:${row.mid}:${row.id}`))
  assert.equal(JSON.stringify(result).includes(marker), false)
  assert.ok(Object.isFrozen(WINDOWS_LATEST_RELEASE_PREVIEW_POLICY))
  assert.equal(WINDOWS_LATEST_RELEASE_PREVIEW_POLICY.validation, 'all-returned-rows')
})

test('malformed tail or duplicate ID/MID outside the preview rejects rather than silently accepting the first20', () => {
  for (const changed of [null, { ...rawSong(0), mid: rawSong(42).mid },
    { ...rawSong(42), mid: rawSong(0).mid }, { ...rawSong(42), file: {} }]) {
    const rows = Array.from({ length: 43 }, (_, index) => rawSong(index))
    rows[42] = changed
    assert.throws(() => decodeWindowsLatestReleaseSongs({ songlist: rows }))
  }
})

test('latest missing paths, over-limit/sparse rows and unobserved unsupported records reject', () => {
  const special = rawSong(0); Object.assign(special, { type: 21, data_type: 0, mid: '' }); special.file.media_mid = ''
  for (const data of [null, {}, { songList: [rawSong(0)] }, { songlist: {} }, { songlist: Array(2) },
    { songlist: Array.from({ length: 1001 }, (_, index) => rawSong(index)) }, { songlist: [special] }]) {
    assert.throws(() => decodeWindowsLatestReleaseSongs(data))
  }
  assert.deepEqual(decodeWindowsLatestReleaseSongs({ songlist: [] }), [])
})

test('latest leaf forwards signal and returns one preview response without retry or fabricated paging', async () => {
  const signal = new AbortController().signal
  let calls = 0
  const client = { request: async (key, call, options) => {
    calls++
    assert.equal(key, WINDOWS_LATEST_RELEASE_SONGS_REQUEST_KEY)
    assert.deepEqual(call.param, { type: 5 })
    assert.equal(options.signal, signal)
    return { songlist: [rawSong(0)] }
  } }
  assert.equal((await fetchWindowsLatestReleaseSongs({ client, signal })).length, 1)
  assert.equal(calls, 1)
})

test('preabort and late abort cancel, while same-name/raw external errors remain generic and RPC code stays numeric', async () => {
  let calls = 0
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { calls++ } }, signal: controller.signal }),
    error => error.name === 'AbortError')
  assert.equal(calls, 0)
  const late = new AbortController()
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => {
    late.abort(); return { songlist: [rawSong(0)] }
  } }, signal: late.signal }), error => error.name === 'AbortError')
  for (const raw of [new Error(marker), Object.assign(new Error(marker), { name: 'WindowsHomeResponseError', code: 'SHAPE' })]) {
    await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw raw } } }),
      error => error.code === 'REQUEST' && !error.message.includes(marker))
  }
  const denied = new WindowsRpcError(22); denied.message = marker
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw denied } } }),
    error => error.code === 22 && !error.message.includes(marker))
  const changing = new WindowsRpcError(22); let codeReads = 0
  Object.defineProperty(changing, 'code', { get: () => ++codeReads < 5 ? 22 : marker })
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw changing } } }),
    error => error.code === 22 && !error.message.includes(marker))
  assert.equal(codeReads, 1)
  const getter = Object.defineProperty({}, 'request', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: getter }), error => error.code === 'REQUEST' && !error.message.includes(marker))
  const thrownGetter = Object.defineProperty({}, 'name', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw thrownGetter } } }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
})

test('a public decoder error reused and mutated by an external client is reconstructed from its owned validation code', async () => {
  let captured
  try { decodeWindowsDailyFeed({}) } catch (error) { captured = error }
  assert.equal(captured.code, 'STATUS')
  captured.message = marker
  Object.defineProperty(captured, 'code', { get() { throw new Error(marker) } })
  Object.defineProperty(captured, 'name', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw captured } } }),
    error => error !== captured && error.code === 'STATUS' && !error.message.includes(marker))
  const unknown = new captured.constructor(marker)
  unknown.message = marker
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw unknown } } }),
    error => error !== unknown && error.code === 'REQUEST' && !error.message.includes(marker))
  const forged = new Error(marker)
  Object.setPrototypeOf(forged, Object.getPrototypeOf(captured))
  await assert.rejects(fetchWindowsLatestReleaseSongs({ client: { request: async () => { throw forged } } }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
})

const candidate = () => ({ id: 77, type: 10014, title: 'Public synthetic grid', picurl: 'https://y.gtimg.cn/public.jpg',
  creator: { uin: '456', nick: 'Public creator' }, listeners: 123456, jmpurl: marker, secret: marker })

test('actual root-grids candidate keeps supplied source creator/tid without publishing a naive native host ref or count', () => {
  const result = mapWindowsRecommendedPlaylistCandidate(candidate())
  assert.equal(result.disstid, '77')
  assert.equal(result.sourceCreatorUin, '456')
  assert.equal(result.id, undefined)
  assert.equal(result.trackCount, undefined)
  assert.equal(JSON.stringify(result).includes(marker), false)
})

test('grid candidate rejects missing/malformed owner and canonical ID without default owner or inherited directory identity', () => {
  for (const mutate of [row => { delete row.creator.uin }, row => { row.creator.uin = '' },
    row => { row.creator.uin = 456 }, row => { row.creator.uin = '456\n' },
    row => { row.id = 0 }, row => { row.id = 9223372036854775808n }, row => { row.title = 'bad\0' }]) {
    const row = candidate(); mutate(row)
    assert.equal(mapWindowsRecommendedPlaylistCandidate(row), null)
  }
  const row = candidate(); row.creator.uin = '0'
  assert.equal(mapWindowsRecommendedPlaylistCandidate(row).sourceCreatorUin, '0')
  row.creator.uin = '18446744073709551615'; row.id = '9223372036854775807'
  assert.deepEqual({ sourceCreatorUin: mapWindowsRecommendedPlaylistCandidate(row).sourceCreatorUin,
    disstid: mapWindowsRecommendedPlaylistCandidate(row).disstid },
    { sourceCreatorUin: '18446744073709551615', disstid: '9223372036854775807' })
})

test('recommendation decoder accepts only observed root grids, bounds12, kind guard and exact unique canonical identities', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ ...candidate(), id: index + 1 }))
  assert.equal(decodeWindowsRecommendedPlaylistCandidates({ grids: rows, modules: [], ret_msg: marker }).length, 12)
  assert.deepEqual(decodeWindowsRecommendedPlaylistCandidates({ grids: [] }), [])
  for (const data of [null, {}, { modules: [{ grids: rows }] }, { grids: Array(2) },
    { grids: rows.concat(candidate()) }, { grids: [candidate(), candidate()] }]) {
    assert.throws(() => decodeWindowsRecommendedPlaylistCandidates(data))
  }
  for (const changed of [{ type: 10015 }, { type: '10014' }, { song: {} }, { song: 'present' }, { isVip: true }, { isVip: 1 }]) {
    assert.throws(() => decodeWindowsRecommendedPlaylistCandidates({ grids: [{ ...candidate(), ...changed }] }))
  }
  assert.equal(decodeWindowsRecommendedPlaylistCandidates({ grids: [{ ...candidate(), song: false, isVip: 0 }] }).length, 1)
})

const playlistDetail = (id, rows = [rawSong(0)]) => ({ code: 0, subcode: 0,
  dirinfo: { id, host_uin: '0', creator: { musicid: '0' } }, songlist: rows, total_song_num: rows.length })
test('recommendation leaf makes literal initial request then binds native ref/count using verified login and forwards signal', async () => {
  const signal = new AbortController().signal
  let calls = 0
  const client = { request: async (key, call, options) => {
    calls++
    assert.equal(options.signal, signal)
    if (key === WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY) {
      assert.deepEqual(call.param, { cmd: 0, page: 0, daily_page: 0, size: 12 })
      return { grids: [candidate()] }
    }
    assert.equal(key, WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY)
    assert.equal(call.param.login_uin.rawJSON, '42')
    assert.equal(call.param.host_uin.rawJSON, '42')
    assert.equal(call.param.disstid.rawJSON, '77')
    return playlistDetail('77')
  } }
  const result = await fetchWindowsRecommendPlaylists({ client, loginUin: '42', signal })
  assert.equal(result[0].id, 'qq:playlist:0:77')
  assert.equal(result[0].trackCount, 1)
  assert.equal(result[0].creatorName, 'Public creator')
  assert.equal(calls, 2)
  await assert.rejects(fetchWindowsRecommendPlaylists({ client: { request: async () => { throw new Error(marker) } } }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
})

test('all12 recommendations are sequentially rebound to actual response host and complete count without publisher-namespace shortcuts', async () => {
  let calls = 0, active = 0, maximum = 0
  const client = { request: async (key, call) => {
    calls++
    if (key === WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY) return { grids: Array.from({ length: 12 },
      (_, index) => ({ ...candidate(), id: index + 1, creator: { uin: String(1000 + index), nick: 'Public creator' } })) }
    maximum = Math.max(maximum, ++active); await Promise.resolve(); active--
    assert.equal(call.param.host_uin.rawJSON, '42')
    const id = call.param.disstid.rawJSON
    return playlistDetail(id, Array.from({ length: Number(id) }, (_, index) => rawSong(index)))
  } }
  const result = await fetchWindowsRecommendPlaylists({ client, loginUin: '42' })
  assert.deepEqual(result.map(item => item.id), Array.from({ length: 12 }, (_, index) => `qq:playlist:0:${index + 1}`))
  assert.deepEqual(result.map(item => item.trackCount), Array.from({ length: 12 }, (_, index) => index + 1))
  assert.equal(calls, 13); assert.equal(maximum, 1)
})

test('recommendation binding failure or late abort cannot publish a partial collection or retry', async () => {
  for (const aborted of [false, true]) {
    let calls = 0
    const controller = new AbortController()
    const client = { request: async key => {
      calls++
      if (key === WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY) return { grids: [candidate(), { ...candidate(), id: 78 }] }
      if (calls === 2) return playlistDetail('77')
      if (aborted) controller.abort()
      return { ...playlistDetail('78'), dirinfo: { id: '78', host_uin: '0', creator: { musicid: '42' } } }
    } }
    await assert.rejects(fetchWindowsRecommendPlaylists({ client, loginUin: '42', signal: controller.signal }),
      error => aborted ? error.name === 'AbortError' : !error.message.includes(marker))
    assert.equal(calls, 3)
  }
})

const guid = '0123456789abcdef0123456789abcdef'
const feed = (id = '77') => ({ retcode: 0, v_shelf: [{ id: 201,
  v_niche: [{ v_card: [{ id, title: '每日30首', reqUin: marker, extra_info: { private: marker } }] }] }] })
const detail = (rows = [rawSong(0)], id = '77') => ({ code: 0, subcode: 0, hasmore: 0,
  dirinfo: { id, songnum: rows.length, host_uin: marker, encrypt_uin: marker },
  songlist: rows, total_song_num: rows.length, login_uin: marker, msg: marker })
const unsupportedSong = index => {
  const row = rawSong(index)
  Object.assign(row, { type: 21, data_type: 0, mid: '' })
  Object.assign(row.file, { media_mid: '', size_128mp3: 0, size_320mp3: 0, size_192ogg: 0, size_flac: 0 })
  return row
}

test('Daily Feed and Diss builders own arrays and encode explicit IDs losslessly within signed64', () => {
  const call = buildWindowsRecommendFeedCall()
  assert.equal(WINDOWS_RECOMMEND_FEED_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.deepEqual(call.param, { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 })
  call.param.v_cache.push(marker); call.param.v_uniq.push(marker)
  assert.deepEqual(buildWindowsRecommendFeedCall().param.v_cache, [])
  assert.deepEqual(buildWindowsRecommendFeedCall().param.v_uniq, [])
  for (const id of ['9223372036854775807', '-9223372036854775808', '0']) {
    const diss = buildWindowsDailyDissCall({ disstid: id, guid })
    assert.equal(WINDOWS_DAILY_DISS_REQUEST_KEY, `${diss.module}.${diss.method}`)
    assert.equal(JSON.stringify(diss.param), `{"disstid":${id},"userinfo":1,"tag":1,"guid":"${guid}"}`)
  }
  assert.equal(buildWindowsDailyDissCall({ disstid: '00077', guid }).param.disstid.rawJSON, '77')
  for (const disstid of [undefined, null, '', '77\n', '77\0', '9223372036854775808', '-9223372036854775809',
    Number.MAX_SAFE_INTEGER + 1, 1n, 1.5]) {
    assert.throws(() => buildWindowsDailyDissCall({ disstid, guid }))
  }
  for (const badGuid of [undefined, '', guid + '\n', guid.slice(1), 'x'.repeat(32)]) {
    assert.throws(() => buildWindowsDailyDissCall({ disstid: '77', guid: badGuid }))
  }
  assert.equal(WINDOWS_EMBEDDED_DAILY_PROVENANCE.sourceSelectorShelfId, 301)
  assert.equal(WINDOWS_EMBEDDED_DAILY_PROVENANCE.observedNativeCt19ShelfId, 201)
  assert.ok(Object.isFrozen(WINDOWS_DAILY_FEED_POLICY))
})

test('Daily Feed binds one numeric201 shelf and its first niche unique exact known title without private outputs', () => {
  const data = feed('9223372036854775807')
  data.v_shelf.push({ id: 203, v_niche: [{ v_card: [{ id: '999', title: 'Public other card' }] }] })
  assert.deepEqual(decodeWindowsDailyFeed(data), { disstid: '9223372036854775807' })
  assert.equal(JSON.stringify(decodeWindowsDailyFeed(data)).includes(marker), false)
  assert.deepEqual(decodeWindowsDailyFeed(feed('0')), { disstid: '0' })
  for (const mutate of [data => { data.v_shelf[0].id = 301 }, data => { data.v_shelf[0].id = '201' },
    data => { data.v_shelf.push(structuredClone(data.v_shelf[0])) },
    data => { data.v_shelf[0].v_niche[0].v_card.push(structuredClone(data.v_shelf[0].v_niche[0].v_card[0])) },
    data => { data.v_shelf[0].v_niche[0].v_card[0].title = '每日 30 首' },
    data => { data.v_shelf[0].v_niche.unshift({ v_card: [] }) },
    data => { data.v_shelf[0].v_niche[0].v_card[0].id = '-1' },
    data => { delete data.v_shelf[0].v_niche[0].v_card[0].id }]) {
    const changed = feed(); mutate(changed)
    assert.throws(() => decodeWindowsDailyFeed(changed))
  }
})

test('Daily Feed rejects malformed/sparse/oversized inputs and invalid/nonzero retcode without reading message', () => {
  for (const data of [null, {}, { retcode: 0, v_shelf: Array(2) },
    { retcode: 0, v_shelf: Array.from({ length: 101 }, () => ({ id: 203 })) },
    { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: Array(2) }] }] },
    { retcode: 0, v_shelf: [{ id: 201, v_niche: [{ v_card: Array.from({ length: 1001 }, () => ({ title: 'Public' })) }] }] }]) {
    assert.throws(() => decodeWindowsDailyFeed(data))
  }
  for (const retcode of [undefined, '0', false, 0x80000000]) assert.throws(() => decodeWindowsDailyFeed({ ...feed(), retcode }))
  assert.throws(() => decodeWindowsDailyFeed({ ...feed(), retcode: 22, msg: marker }),
    error => error instanceof WindowsRpcError && error.code === 22 && !error.message.includes(marker))
})

test('Daily detail binds exact ID and complete counts and preserves supported/unsupported raw slots without private fields', () => {
  const rows = Array.from({ length: 30 }, (_, index) => index === 7 ? unsupportedSong(index) : rawSong(index))
  const result = decodeWindowsDailySongs(detail(rows), { disstid: '77' })
  assert.equal(result.length, 30)
  assert.equal(result[7].id, 'qq:native:21:8')
  assert.equal(result[7].playbackStatus, 'unsupported')
  assert.equal(result[8].id, `qq:${rows[8].mid}:9`)
  assert.equal(JSON.stringify(result).includes(marker), false)
  assert.equal(decodeWindowsDailySongs(detail([], 0), { disstid: '0' }).length, 0)
})

test('Daily detail rejects partial/mismatched or malformed counts/identities and nonzero or untyped status', () => {
  for (const mutate of [data => { data.dirinfo.id = '78' }, data => { delete data.dirinfo.id },
    data => { data.dirinfo.songnum = 2 }, data => { data.total_song_num = 2 },
    data => { data.total_song_num = '1' }, data => { data.dirinfo.songnum = 1.5 },
    data => { data.songlist = Array(1) }, data => { data.songlist[0].file = {} },
    data => { data.hasmore = 1 }, data => { data.hasmore = false }, data => { delete data.hasmore },
    data => { data.code = '0' }, data => { data.subcode = undefined }]) {
    const data = detail(); mutate(data)
    assert.throws(() => decodeWindowsDailySongs(data, { disstid: '77' }))
  }
  for (const field of ['code', 'subcode']) assert.throws(() => decodeWindowsDailySongs({ ...detail(), [field]: 22 }, { disstid: '77' }),
    error => error instanceof WindowsRpcError && error.code === 22 && !error.message.includes(marker))
  for (const rows of [[rawSong(0), { ...rawSong(1), id: 1 }], [rawSong(0), { ...rawSong(1), mid: rawSong(0).mid }],
    [rawSong(0), unsupportedSong(0)], [unsupportedSong(0), unsupportedSong(0)],
    Array.from({ length: 1001 }, (_, index) => rawSong(index))]) {
    assert.throws(() => decodeWindowsDailySongs(detail(rows), { disstid: '77' }))
  }
})

test('Daily leaf is exactly Feed then device then bound Diss, forwarding one signal without another session owner', async () => {
  const events = [], signal = new AbortController().signal
  const client = { request: async (key, call, options) => {
    events.push(key); assert.equal(options.signal, signal)
    if (key === WINDOWS_RECOMMEND_FEED_REQUEST_KEY) {
      assert.deepEqual(call.param, { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 })
      return feed('9223372036854775807')
    }
    assert.equal(key, WINDOWS_DAILY_DISS_REQUEST_KEY)
    assert.equal(call.param.disstid.rawJSON, '9223372036854775807')
    assert.equal(call.param.guid, guid)
    assert.equal(Object.hasOwn(call.param, 'enc_host_uin'), false)
    return detail([rawSong(0)], '9223372036854775807')
  }, checkLogin: () => { throw new Error('unexpected duplicate session owner') } }
  const result = await fetchWindowsDailySongs({ client, signal, getDevice: async () => { events.push('device'); return { guid } } })
  assert.equal(result.length, 1)
  assert.deepEqual(events, [WINDOWS_RECOMMEND_FEED_REQUEST_KEY, 'device', WINDOWS_DAILY_DISS_REQUEST_KEY])
})

test('Daily Feed failure stops before device/Diss and signal cancellation between phases cannot dispatch Diss', async () => {
  let calls = 0, devices = 0
  await assert.rejects(fetchWindowsDailySongs({ client: { request: async () => { calls++; return { ...feed(), retcode: 22 } } },
    getDevice: () => { devices++; return { guid } } }), error => error.code === 22)
  assert.equal(calls, 1); assert.equal(devices, 0)
  const controller = new AbortController()
  calls = 0
  await assert.rejects(fetchWindowsDailySongs({ client: { request: async () => { calls++; return feed() } }, signal: controller.signal,
    getDevice: async () => { controller.abort(); return { guid } } }), error => error.name === 'AbortError')
  assert.equal(calls, 1)
})

test('Daily abort while device lookup is pending settles promptly and never starts Diss', async () => {
  let calls = 0, begin, finish
  const started = new Promise(resolve => { begin = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const controller = new AbortController()
  const result = fetchWindowsDailySongs({ client: { request: async () => { calls++; return feed() } }, signal: controller.signal,
    getDevice: () => { begin(); return pending } })
  await started; controller.abort()
  await assert.rejects(result, error => error.name === 'AbortError')
  finish({ guid }); await Promise.resolve()
  assert.equal(calls, 1)
})

test('Daily second-response late cancellation and device/external spoof errors never reveal raw values', async () => {
  const controller = new AbortController(); let calls = 0
  await assert.rejects(fetchWindowsDailySongs({ client: { request: async () => {
    calls++; if (calls === 1) return feed()
    controller.abort(); return detail()
  } }, getDevice: () => ({ guid }), signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(calls, 2)
  for (const at of ['device', 'diss']) {
    const raw = Object.assign(new Error(marker), { name: 'WindowsHomeResponseError', code: 'DISS' })
    let count = 0
    await assert.rejects(fetchWindowsDailySongs({ client: { request: async () => {
      if (++count === 1) return feed()
      if (at === 'diss') throw raw
      return detail()
    } }, getDevice: () => { if (at === 'device') throw raw; return { guid } } }),
      error => error.code === 'REQUEST' && !error.message.includes(marker))
    assert.equal(count, at === 'device' ? 1 : 2)
  }
})
