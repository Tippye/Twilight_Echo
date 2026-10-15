import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildWindowsArtistSongListCall, buildWindowsArtistDetailCall, buildWindowsArtistAlbumListCall,
  decodeWindowsArtistSongList, decodeWindowsArtistDetail, decodeWindowsArtistAlbumPage,
  fetchWindowsArtistTopSongs, fetchWindowsArtistIntro, fetchWindowsArtistAlbums,
  WINDOWS_ARTIST_TOP_SONGS_POLICY, WINDOWS_ARTIST_ALBUM_PAGING_POLICY,
  WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY, WINDOWS_ARTIST_DETAIL_REQUEST_KEY,
  WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY, WINDOWS_EMBEDDED_ARTIST_PROVENANCE } from './lib/windows/artist-call.mjs'
import { WindowsRpcError } from './lib/windows/response.mjs'

const artist = 'qq:artist:0025NhlN2yWrP4:4558'
const singerMid = '0025NhlN2yWrP4'
const song = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url))).publicSongs[0]
const detail = () => ({ singer_list: [{ basic_info: { singer_mid: singerMid, singer_id: 4558, name: 'Public artist' },
  ex_info: { desc: 'Public synthetic description' }, wiki: '<info><desc>not a fallback</desc></info>' }] })
const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'

test('embedded provenance and exact three request shapes keep native transport compatibility explicit', () => {
  assert.equal(WINDOWS_EMBEDDED_ARTIST_PROVENANCE.kind, 'windows-configured-embedded-web')
  assert.equal(WINDOWS_EMBEDDED_ARTIST_PROVENANCE.nativeClientTransport, 'compatibility-accepted-public-artist-rpc')
  assert.ok(Object.isFrozen(WINDOWS_EMBEDDED_ARTIST_PROVENANCE))
  const songs = buildWindowsArtistSongListCall({ singerMid, begin: 0, num: 10, order: 1 })
  assert.equal(WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY, `${songs.module}.${songs.method}`)
  assert.deepEqual(songs, { module: 'music.musichallSong.SongListInter', method: 'GetSingerSongList',
    param: { singerMid, begin: 0, num: 10, order: 1 } })
  const info = buildWindowsArtistDetailCall({ singerMid })
  assert.equal(WINDOWS_ARTIST_DETAIL_REQUEST_KEY, `${info.module}.${info.method}`)
  assert.deepEqual(info.param, { singer_mids: [singerMid], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 })
  const albums = buildWindowsArtistAlbumListCall({ singerMid, begin: 0, num: 30, order: 0 })
  assert.equal(WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY, `${albums.module}.${albums.method}`)
  assert.deepEqual(albums.param, { singerMid, begin: 0, num: 30, order: 0 })
  assert.equal(Object.hasOwn(albums.param, 'types'), false)
})

test('source CD0 EP11 live1 tabs copy their optional one-element arrays', () => {
  for (const value of [0, 11, 1]) {
    const types = [value]
    const call = buildWindowsArtistAlbumListCall({ singerMid, begin: 2, num: 30, order: 1, types })
    assert.deepEqual(call.param.types, types)
    types[0] = 9
    assert.deepEqual(call.param.types, [value])
  }
  for (const types of [[], [9], [0, 11], ['0'], null, 0]) {
    assert.throws(() => buildWindowsArtistAlbumListCall({ singerMid, begin: 0, num: 30, order: 0, types }))
  }
})

test('adapter caller bounds reject unsafe identifiers and unproven ordering without defaults', () => {
  for (const value of [undefined, '', `${singerMid}\n`, 'bad', 4558, singerMid + '\0']) {
    assert.throws(() => buildWindowsArtistDetailCall({ singerMid: value }))
  }
  for (const changed of [{ begin: -1 }, { begin: 1000001 }, { begin: '0' }, { num: 0 }, { num: 101 },
    { num: 1.5 }, { order: 2 }, { order: '1' }, { order: undefined }]) {
    assert.throws(() => buildWindowsArtistSongListCall({ singerMid, begin: 0, num: 10, order: 1, ...changed }))
  }
  assert.ok(Object.isFrozen(WINDOWS_ARTIST_TOP_SONGS_POLICY))
})

test('bound songInfo mapping preserves rows and strips private-like raw DTO extras', () => {
  const raw = structuredClone(song)
  raw.secret = marker; raw.file.ekey = marker
  const tracks = decodeWindowsArtistSongList({ singerMid, songList: [{ songInfo: raw }], totalNum: 100 }, { singerMid, num: 10 })
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'qq:0039MnYb0qxYhV:97773')
  assert.equal(JSON.stringify(tracks).includes(marker), false)
  assert.deepEqual(decodeWindowsArtistSongList({ singerMid, songList: [], totalNum: 0 }, { singerMid, num: 10 }), [])
})

test('malformed song rows, unobserved containers and invalid overview totals reject without silently refilling', () => {
  for (const data of [null, {}, { tracks: [song] }, { songList: {} }, { songList: [null] }, { songList: [{}] },
    { songList: [{ songInfo: {} }] }, { songList: Array(11).fill({ songInfo: song }) },
    { songList: [{ songInfo: song }], totalNum: 0 }, { songList: [], totalNum: '1' }]) {
    assert.throws(() => decodeWindowsArtistSongList(data, { singerMid, num: 10 }))
  }
})

test('TopSongs binds actual singerMid and rejects duplicate pairs or either song identity alias', () => {
  const otherMid = { ...song, mid: '001Bbywq2gicae' }
  const otherId = { ...song, id: 102065750 }
  for (const data of [{ singerMid: '00000000000000', totalNum: 10, songList: [{ songInfo: song }] },
    ...[[song, song], [song, otherMid], [song, otherId]].map(list => ({ singerMid, totalNum: 100,
      songList: list.map(songInfo => ({ songInfo })) }))]) {
    assert.throws(() => decodeWindowsArtistSongList(data, { singerMid, num: 10 }))
  }
})

test('detail binds both canonical identities and returns only directly consumed description fields', () => {
  const data = detail()
  data.singer_list[0].secret = marker
  const result = decodeWindowsArtistDetail(data, { artist })
  assert.deepEqual(result, { id: artist, name: 'Public artist', description: 'Public synthetic description' })
  assert.equal(JSON.stringify(result).includes(marker), false)
  data.singer_list[0].basic_info.singer_id = '4558'
  assert.deepEqual(decodeWindowsArtistDetail(data, { artist }), result)
  data.singer_list[0].ex_info.desc = '<b>Public text remains literal</b>\nNext line'
  assert.equal(decodeWindowsArtistDetail(data, { artist }).description, data.singer_list[0].ex_info.desc)
})

test('detail rejects identity changes and missing description instead of guessing wiki or HTML', () => {
  for (const mutate of [data => { data.singer_list = [] }, data => { data.singer_list.push(data.singer_list[0]) },
    data => { data.singer_list[0].basic_info.singer_mid = '00000000000000' },
    data => { data.singer_list[0].basic_info.singer_id = 4559 },
    data => { delete data.singer_list[0].ex_info }, data => { data.singer_list[0].ex_info.desc = null },
    data => { data.singer_list[0].ex_info.desc = 'public\0description' }]) {
    const data = detail(); mutate(data)
    assert.throws(() => decodeWindowsArtistDetail(data, { artist }))
  }
})

const albumRow = (index = 0) => ({ albumID: 1458791 + index,
  albumMid: index === 0 ? '003RMaRI1iFoYd' : String(index).padStart(14, '0'),
  albumName: index === 0 ? '周杰伦的床边故事' : `Public synthetic album ${index}`,
  publishDate: '2016-06-24', pmid: '003RMaRI1iFoYd_1', totalNum: 10, singerName: 'Public synthetic artist' })
const albumPage = ({ begin = 0, total = 4, list = [albumRow(begin), albumRow(begin + 1)], ...extra } = {}) =>
  ({ singerMid, total, albumList: list, ...extra })

test('real albumID keys map to existing dual-ID summaries/date owner without fabricated covers or raw extras', () => {
  const result = decodeWindowsArtistAlbumPage(albumPage({ total: 1, list: [{ ...albumRow(), secret: marker }] }),
    { singerMid, begin: 0, num: 30 })
  assert.equal(result.albums[0].id, 'qq:album:003RMaRI1iFoYd:1458791')
  assert.equal(result.albums[0].name, '周杰伦的床边故事')
  assert.equal(result.albums[0].trackCount, 10)
  assert.equal(result.albums[0].cover, null)
  assert.equal(result.albums[0].publishTime, Date.UTC(2016, 5, 24))
  assert.equal(result.hasMore, false)
  assert.equal(JSON.stringify(result).includes(marker), false)
  const invalidDate = decodeWindowsArtistAlbumPage(albumPage({ total: 1,
    list: [{ ...albumRow(), publishDate: '2016-02-31' }] }), { singerMid, begin: 0, num: 30 })
  assert.equal(invalidDate.albums[0].publishTime, undefined)
})

test('album pages bind singer, totals and raw count without inventing a response cursor', () => {
  const expected = { singerMid, begin: 0, num: 2 }
  for (const data of [null, {}, albumPage({ singerMid: '00000000000000' }), albumPage({ total: '4' }),
    albumPage({ total: -1 }), albumPage({ total: 1 }), albumPage({ list: [] }), albumPage({ list: [albumRow(), {}] }),
    albumPage({ list: [albumRow(), albumRow(1), albumRow(2)] }),
    albumPage({ list: [{ ...albumRow(), albumID: 4294967296 }, albumRow(1)] })]) {
    assert.throws(() => decodeWindowsArtistAlbumPage(data, expected))
  }
  const priorIds = new Set(['42']), priorMids = new Set(['00000000000000'])
  const result = decodeWindowsArtistAlbumPage(albumPage(), { ...expected, seenIds: priorIds, seenMids: priorMids })
  assert.equal(result.nextOffset, 2)
  assert.equal(result.total, 4)
  assert.equal(result.hasMore, true)
  assert.deepEqual([...priorIds], ['42']); assert.deepEqual([...priorMids], ['00000000000000'])
  assert.deepEqual(decodeWindowsArtistAlbumPage(albumPage({ total: 0, list: [] }), expected).albums, [])
})

test('album pair and independent ID/MID aliases reject on a page and across previous pages', () => {
  const expected = { singerMid, begin: 0, num: 2 }
  for (const list of [[albumRow(), albumRow()], [albumRow(), { ...albumRow(1), albumID: albumRow().albumID }],
    [albumRow(), { ...albumRow(1), albumMid: albumRow().albumMid }]]) {
    assert.throws(() => decodeWindowsArtistAlbumPage(albumPage({ list }), expected))
  }
  assert.throws(() => decodeWindowsArtistAlbumPage(albumPage(), { ...expected, seenIds: new Set(['1458791']) }))
  assert.throws(() => decodeWindowsArtistAlbumPage(albumPage(), { ...expected, seenMids: new Set(['003RMaRI1iFoYd']) }))
})

test('all-albums leaf progresses by returned rows using explicit source order0 and stable actual total', async () => {
  const calls = []
  const input = { id: artist }
  const client = { request: async (key, call, options) => {
    calls.push({ key, call, options })
    input.id = 'qq:artist:00000000000000:42'
    return albumPage({ begin: call.param.begin, total: 5,
      list: Array.from({ length: Math.min(2, 5 - call.param.begin) }, (_, index) => albumRow(call.param.begin + index)) })
  } }
  const signal = new AbortController().signal
  const albums = await fetchWindowsArtistAlbums({ client, artist: input, pageSize: 2, signal })
  assert.equal(albums.length, 5)
  assert.deepEqual(calls.map(({ call }) => call.param), [0, 2, 4].map(begin => ({ singerMid, begin, num: 2, order: 0 })))
  assert.ok(calls.every(call => call.key === WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY && call.options.signal === signal))
  assert.ok(Object.isFrozen(WINDOWS_ARTIST_ALBUM_PAGING_POLICY))
})

test('short positive album pages continue until total; no-progress/changedtotal/alias cases never return partial albums', async () => {
  const offsets = []
  const short = { request: async (_key, call) => {
    offsets.push(call.param.begin)
    return albumPage({ begin: call.param.begin, total: 3, list: [albumRow(call.param.begin)] })
  } }
  assert.equal((await fetchWindowsArtistAlbums({ client: short, artist, pageSize: 2 })).length, 3)
  assert.deepEqual(offsets, [0, 1, 2])
  for (const second of [albumPage({ begin: 2, total: 5 }), albumPage({ begin: 2, list: [] }),
    albumPage({ begin: 2, singerMid: '00000000000000' }), albumPage({ begin: 2, list: [albumRow(), albumRow(2)] })]) {
    let calls = 0
    await assert.rejects(fetchWindowsArtistAlbums({ client: { request: async () => ++calls === 1 ? albumPage() : second },
      artist, pageSize: 2 }))
    assert.equal(calls, 2)
  }
})

test('all-albums resource limits bound requests and rejection never exports private messages', async () => {
  let calls = 0
  await assert.rejects(fetchWindowsArtistAlbums({ client: { request: async () => { calls++; return albumPage({ total: 10001 }) } },
    artist, pageSize: 2 }), error => error.code === 'LIMIT')
  assert.equal(calls, 1)
  calls = 0
  const sparse = { request: async (_key, call) => {
    calls++; return albumPage({ begin: call.param.begin, total: 101, list: [albumRow(call.param.begin)] })
  } }
  await assert.rejects(fetchWindowsArtistAlbums({ client: sparse, artist, pageSize: 1 }), error => error.code === 'LIMIT')
  assert.equal(calls, 100)
  await assert.rejects(fetchWindowsArtistAlbums({ client: { request: async () => { throw new Error(marker) } }, artist }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
  const controller = new AbortController(); controller.abort()
  calls = 0
  await assert.rejects(fetchWindowsArtistAlbums({ client: { request: async () => { calls++ } }, artist, signal: controller.signal }),
    error => error.name === 'AbortError')
  assert.equal(calls, 0)
})

test('SDK top songs leaf uses one canonical Top10 hottest request and passes the invocation signal', async () => {
  const signal = new AbortController().signal
  const calls = []
  const client = { request: async (key, call, options) => { calls.push({ key, call, options }); return { singerMid, totalNum: 100, songList: [{ songInfo: song }] } } }
  const tracks = await fetchWindowsArtistTopSongs({ client, artist, signal })
  assert.equal(tracks.length, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].key, WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY)
  assert.deepEqual(calls[0].call.param, { singerMid, begin: 0, num: 10, order: 1 })
  assert.equal(calls[0].options.signal, signal)
})

test('SDK intro leaf returns bounded source text without querying wiki or guessed services', async () => {
  let calls = 0
  const client = { request: async (key, call) => {
    calls++
    assert.equal(key, WINDOWS_ARTIST_DETAIL_REQUEST_KEY)
    assert.deepEqual(call.param.singer_mids, [singerMid])
    return detail()
  } }
  assert.equal(await fetchWindowsArtistIntro({ client, artist }), 'Public synthetic description')
  assert.equal(calls, 1)
})

test('intro retains the requested canonical identity when caller DTO changes during the request', async () => {
  const input = { id: artist }
  const client = { request: async (_key, call) => {
    assert.deepEqual(call.param.singer_mids, [singerMid])
    input.id = 'qq:artist:00000000000000:42'
    return detail()
  } }
  assert.equal(await fetchWindowsArtistIntro({ client, artist: input }), 'Public synthetic description')
})

test('abort and invalid canonical input stop before a request; late abort discards returned data', async () => {
  let calls = 0
  const client = { request: async () => { calls++; return { singerMid, totalNum: 0, songList: [] } } }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fetchWindowsArtistTopSongs({ client, artist, signal: controller.signal }), error => error.name === 'AbortError')
  for (const value of ['4558', singerMid, `qq:artist:${singerMid}:04558`, `qq:artist:${singerMid}:4294967296`, null]) {
    await assert.rejects(fetchWindowsArtistTopSongs({ client, artist: value }))
  }
  assert.equal(calls, 0)
  const late = new AbortController()
  await assert.rejects(fetchWindowsArtistTopSongs({ client: { request: async () => { late.abort(); return { singerMid, totalNum: 0, songList: [] } } },
    artist, signal: late.signal }), error => error.name === 'AbortError')
})

test('request failures stay generic including same-name spoof while actual RPC errors retain numeric code only', async () => {
  for (const error of [new Error(marker), Object.assign(new Error(marker), { name: 'WindowsArtistResponseError', code: 'TRACK' })]) {
    await assert.rejects(fetchWindowsArtistTopSongs({ client: { request: async () => { throw error } }, artist }), value =>
      value.code === 'REQUEST' && !value.message.includes(marker))
  }
  const denied = new WindowsRpcError(22); denied.message = marker
  await assert.rejects(fetchWindowsArtistIntro({ client: { request: async () => { throw denied } }, artist }), value =>
    value instanceof WindowsRpcError && value.code === 22 && !value.message.includes(marker))
  const unavailable = Object.defineProperty({}, 'request', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsArtistTopSongs({ client: unavailable, artist }), value =>
    value.code === 'REQUEST' && !value.message.includes(marker))
  let calls = 0
  await assert.rejects(fetchWindowsArtistTopSongs({ client: { request: async () => { calls++; return { singerMid, totalNum: 1, songList: [{}] } } }, artist }),
    value => value.code === 'TRACK')
  assert.equal(calls, 1)
})

test('artist rejection rebuilds reused owned errors and snapshots genuine RPC code once with safe getter and Abort boundaries', async () => {
  let captured
  try { decodeWindowsArtistDetail(null, { artist }) } catch (error) { captured = error }
  assert.equal(captured.code, 'SHAPE')
  captured.message = marker
  Object.defineProperty(captured, 'name', { get() { throw new Error(marker) } })
  Object.defineProperty(captured, 'code', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsArtistTopSongs({ client: { request: async () => { throw captured } }, artist }),
    error => error !== captured && error.code === 'SHAPE' && !error.message.includes(marker))
  const unknown = new captured.constructor(marker)
  unknown.message = marker
  await assert.rejects(fetchWindowsArtistIntro({ client: { request: async () => { throw unknown } }, artist }),
    error => error !== unknown && error.code === 'REQUEST' && !error.message.includes(marker))
  const changing = new WindowsRpcError(22); let reads = 0
  Object.defineProperty(changing, 'code', { get: () => ++reads <= 4 ? 22 : marker })
  await assert.rejects(fetchWindowsArtistAlbums({ client: { request: async () => { throw changing } }, artist }),
    error => error.code === 22 && !error.message.includes(marker))
  assert.equal(reads, 1)
  const unsafeName = Object.defineProperty({}, 'name', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsArtistTopSongs({ client: { request: async () => { throw unsafeName } }, artist }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
  await assert.rejects(fetchWindowsArtistIntro({ client: { request: async () => {
    throw Object.assign(new Error(marker), { name: 'AbortError' })
  } }, artist }), error => error.name === 'AbortError' && !error.message.includes(marker))
})
