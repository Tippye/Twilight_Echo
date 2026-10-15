import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildWindowsAlbumSongListCall, mapWindowsAlbumSongList, decodeWindowsAlbumSongPage,
  fetchWindowsAlbumTracks, WINDOWS_ALBUM_PAGING_POLICY,
  WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY, WINDOWS_ALBUM_SONG_LIST_PROVENANCE } from './lib/windows/album-call.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
const request = { albumMid: '000MkMni19ClKG', albumId: 8220, begin: 0, num: 20, order: 0 }

test('native album producer preserves exact service/key and typed caller fields', () => {
  const call = buildWindowsAlbumSongListCall(request)
  assert.equal(WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.deepEqual(call, { module: 'music.musichallAlbum.AlbumSongList', method: 'GetAlbumSongList',
    param: { albumMid: request.albumMid, albumID: 8220, begin: 0, num: 20, order: 0 } })
  assert.equal(WINDOWS_ALBUM_SONG_LIST_PROVENANCE.producer, '0x10029c0f')
  assert.ok(Object.isFrozen(WINDOWS_ALBUM_SONG_LIST_PROVENANCE))
  request.num = 1
  assert.equal(call.param.num, 20)
  request.num = 20
})

test('UInt32 albumID and Int32 pagination/order remain separate numeric domains', () => {
  const call = buildWindowsAlbumSongListCall({ albumMid: '', albumId: 0xffffffff,
    begin: -0x80000000, num: 0x7fffffff, order: -1 })
  assert.deepEqual(call.param, { albumMid: '', albumID: 0xffffffff,
    begin: -0x80000000, num: 0x7fffffff, order: -1 })
  assert.equal(JSON.parse(JSON.stringify(call)).param.albumID, 4294967295)
  assert.equal(buildWindowsAlbumSongListCall({ ...request, albumId: 0 }).param.albumID, 0)
})

test('native no-request branch and invalid or absent typed inputs reject', () => {
  assert.throws(() => buildWindowsAlbumSongListCall({ ...request, albumMid: '', albumId: 0 }))
  for (const albumId of [-1, 0x100000000, 1.5, '8220', 8220n, null]) {
    assert.throws(() => buildWindowsAlbumSongListCall({ ...request, albumId }))
  }
  for (const field of ['begin', 'num', 'order']) {
    for (const value of [undefined, -0x80000001, 0x80000000, 1.5, '0', 0n]) {
      assert.throws(() => buildWindowsAlbumSongListCall({ ...request, [field]: value }))
    }
  }
  for (const albumMid of [undefined, null, 8220, 'public\0mid']) {
    assert.throws(() => buildWindowsAlbumSongListCall({ ...request, albumMid }))
  }
})

test('native songList/songInfo path reuses the public song mapper and omits raw extras', () => {
  const song = { ...fixture.publicSongs[0], creator: { uin: 'public-synthetic-private-marker' },
    file: { ...fixture.publicSongs[0].file, ekey: 'public-synthetic-private-marker' },
    purl: 'public-synthetic-private-marker' }
  const tracks = mapWindowsAlbumSongList({ songList: [{ songInfo: song, privateExtra: 'public-synthetic-private-marker' }] })
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].id, 'qq:0039MnYb0qxYhV:97773')
  assert.equal(tracks[0].title, '晴天')
  assert.equal(tracks[0].filePath, tracks[0].id)
  assert.equal(JSON.stringify(tracks).includes('public-synthetic-private-marker'), false)
})

test('malformed rows are skipped without refilling and other response paths are rejected', () => {
  assert.deepEqual(mapWindowsAlbumSongList({ songList: [] }), [])
  assert.equal(mapWindowsAlbumSongList({ songList: [null, {}, { songInfo: {} },
    { songInfo: { ...fixture.publicSongs[0], mid: 'invalid' } }, { songInfo: fixture.publicSongs[0] }] }).length, 1)
  for (const value of [null, [], {}, { data: { songList: [] } }, { songlist: [] }, { tracks: [] }, { songList: {} }]) {
    assert.throws(() => mapWindowsAlbumSongList(value), /专辑歌曲列表无效/)
  }
})

const album = 'qq:album:000MkMni19ClKG:8220'
// Public identity pairs are taken from Root's actual two-page receipt; titles in
// these constructed DTOs are synthetic. No complete actual media/lyric is stored.
const publicPageIds = [
  ['003BkwkH0iS8Ko', 97781], ['000P0AxP15jei5', 97780],
  ['0037FWzg2csDmh', 97779], ['001FSVRg08JLpi', 97778]
]
const rawSong = (mid, id) => ({ songInfo: { ...fixture.publicSongs[0], id, mid,
  title: `public synthetic ${id}` } })
const rows = publicPageIds.map(([mid, id]) => rawSong(mid, id))
function page({ begin = 0, total = 4, list = rows.slice(begin, begin + 2), ...extra } = {}) {
  return { albumMid: request.albumMid, totalNum: total, curBegin: begin, songList: list, ...extra }
}

test('actual page identity/cursor shape is bound and prior identity sets remain immutable', () => {
  const priorIds = new Set(['42']), priorMids = new Set(['00000000000000'])
  const result = decodeWindowsAlbumSongPage(page(), { albumMid: request.albumMid, begin: 0, num: 2,
    seenIds: priorIds, seenMids: priorMids })
  assert.deepEqual(result.songIds, ['97781', '97780'])
  assert.deepEqual(result.songMids, publicPageIds.slice(0, 2).map(row => row[0]))
  assert.equal(result.nextOffset, 2)
  assert.equal(result.total, 4)
  assert.equal(result.hasMore, true)
  assert.deepEqual([...priorIds], ['42'])
  assert.deepEqual([...priorMids], ['00000000000000'])
})

test('response album identity, cursor/count range, overrun and no-progress errors reject', () => {
  const expected = { albumMid: request.albumMid, begin: 0, num: 2 }
  for (const changed of [{ albumMid: '00000000000000' }, { curBegin: 2 }, { curBegin: '0' },
    { totalNum: '4' }, { totalNum: -1 }, { totalNum: 1.5 }, { totalNum: 0x80000000 },
    { totalNum: Number.MAX_SAFE_INTEGER + 1 }, { curBegin: -1 }, { curBegin: 0x80000000 },
    { songList: rows }, { totalNum: 1 }, { songList: [] }]) {
    assert.throws(() => decodeWindowsAlbumSongPage(page({ ...changed }), expected),
      error => error.name === 'WindowsAlbumResponseError')
  }
  for (const changed of [{ num: 0 }, { num: 101 }, { begin: -1 }, { begin: '0' },
    { albumMid: `${request.albumMid}\n` }, { seenIds: [] }]) {
    assert.throws(() => decodeWindowsAlbumSongPage(page(), { ...expected, ...changed }))
  }
  const afterEnd = decodeWindowsAlbumSongPage(page({ begin: 8, total: 4, list: [] }),
    { albumMid: request.albumMid, begin: 8, num: 2 })
  assert.equal(afterEnd.hasMore, false)
  assert.equal(afterEnd.nextOffset, 8)
  assert.throws(() => decodeWindowsAlbumSongPage(page({ begin: 8, total: 4, list: [rows[0]] }),
    { albumMid: request.albumMid, begin: 8, num: 2 }))
})

test('strict collection pages reject malformed tracks, duplicate pairs and either identity alias', () => {
  const expected = { albumMid: request.albumMid, begin: 0, num: 2 }
  for (const list of [[rows[0], rows[0]], [rows[0], rawSong(publicPageIds[1][0], 97781)],
    [rows[0], rawSong(publicPageIds[0][0], 42)], [rows[0], { songInfo: {} }],
    [rawSong(publicPageIds[0][0], 0x100000000)]]) {
    assert.throws(() => decodeWindowsAlbumSongPage(page({ list }), expected))
  }
  const priorIds = new Set(['97781']), priorMids = new Set()
  assert.throws(() => decodeWindowsAlbumSongPage(page(), { ...expected, seenIds: priorIds, seenMids: priorMids }))
  assert.deepEqual([...priorIds], ['97781'])
  assert.equal(priorMids.size, 0)
})

test('SDK album read advances by raw rows with explicit order0 and finishes only at stable total', async () => {
  const calls = []
  const client = { request: async (key, call, options) => {
    calls.push({ key, call, options })
    return page({ begin: call.param.begin })
  } }
  const tracks = await fetchWindowsAlbumTracks({ client, album, pageSize: 2 })
  assert.deepEqual(tracks.map(track => track.id), publicPageIds.map(([mid, id]) => `qq:${mid}:${id}`))
  assert.deepEqual(calls.map(({ call }) => call.param), [
    { albumMid: request.albumMid, albumID: 8220, begin: 0, num: 2, order: 0 },
    { albumMid: request.albumMid, albumID: 8220, begin: 2, num: 2, order: 0 }
  ])
  assert.ok(calls.every(call => call.key === WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY))
  assert.equal(WINDOWS_ALBUM_PAGING_POLICY.order, 0)
  assert.ok(Object.isFrozen(WINDOWS_ALBUM_PAGING_POLICY))
})

test('short positive pages keep progressing from actual rows rather than imply completion', async () => {
  const offsets = []
  const client = { request: async (_key, call) => {
    offsets.push(call.param.begin)
    return page({ begin: call.param.begin, total: 3, list: rows.slice(call.param.begin, call.param.begin + 1) })
  } }
  assert.equal((await fetchWindowsAlbumTracks({ client, album, pageSize: 2 })).length, 3)
  assert.deepEqual(offsets, [0, 1, 2])
})

test('changed totals, cross-page aliases and changed album/cursor never return a partial album', async () => {
  for (const second of [page({ begin: 2, total: 5 }), page({ begin: 2, list: [rows[0], rows[2]] }),
    page({ begin: 2, list: [rawSong(publicPageIds[0][0], 42), rows[3]] }),
    page({ begin: 2, albumMid: '00000000000000' }), page({ begin: 2, curBegin: 0 })]) {
    let calls = 0
    const client = { request: async () => ++calls === 1 ? page() : second }
    await assert.rejects(fetchWindowsAlbumTracks({ client, album, pageSize: 2 }))
    assert.equal(calls, 2)
  }
})

test('whole-album limits bound100pages/10000raw rows without retry or returning partial results', async () => {
  let calls = 0
  const excessive = { request: async () => { calls++; return page({ total: 10001 }) } }
  await assert.rejects(fetchWindowsAlbumTracks({ client: excessive, album, pageSize: 2 }), error => error.code === 'LIMIT')
  assert.equal(calls, 1)
  calls = 0
  const sparse = { request: async (_key, call) => {
    calls++
    const id = call.param.begin + 1, mid = String(id).padStart(14, '0')
    return page({ total: 101, begin: call.param.begin, list: [rawSong(mid, id)] })
  } }
  await assert.rejects(fetchWindowsAlbumTracks({ client: sparse, album, pageSize: 1 }), error => error.code === 'LIMIT')
  assert.equal(calls, 100)
})

test('invalid SDK inputs, abort and request failures are bounded and errors contain no raw private message', async () => {
  let calls = 0
  const client = { request: async () => { calls++; return page() } }
  for (const changed of [{ album: '8220' }, { album: 'qq:album:000MkMni19ClKG:0008220' },
    { pageSize: 101 }, { pageSize: 0 }, { pageSize: '2' }]) {
    await assert.rejects(fetchWindowsAlbumTracks({ client, album, ...changed }))
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(fetchWindowsAlbumTracks({ client, album, signal: controller.signal }), error => error.name === 'AbortError')
  assert.equal(calls, 0)
  const late = new AbortController()
  const lateClient = { request: async () => { late.abort(); return page() } }
  await assert.rejects(fetchWindowsAlbumTracks({ client: lateClient, album, signal: late.signal }), error => error.name === 'AbortError')
  const denied = { request: async () => { throw Object.assign(new Error('public-synthetic-private-marker'), { code: 22 }) } }
  await assert.rejects(fetchWindowsAlbumTracks({ client: denied, album }),
    error => error.name === 'WindowsRpcError' && error.code === 22 && !error.message.includes('private-marker'))
  const failed = { request: async () => { throw new Error('public-synthetic-private-marker') } }
  await assert.rejects(fetchWindowsAlbumTracks({ client: failed, album }), error => error.code === 'REQUEST' && !error.message.includes('private-marker'))
})

test('an external error cannot spoof the internal album validation name to export its raw message', async () => {
  const client = { request: async () => {
    throw Object.assign(new Error('PUBLIC_RAW_PROVIDER_MESSAGE'), {
      name: 'WindowsAlbumResponseError', code: 'ALBUM'
    })
  } }
  await assert.rejects(fetchWindowsAlbumTracks({ client, album }), error =>
    error.name === 'WindowsAlbumResponseError' && error.code === 'REQUEST' &&
    error.message === 'QQ 音乐专辑歌曲列表无法验证' && !error.message.includes('PUBLIC_RAW_PROVIDER_MESSAGE'))
  const invalid = { request: async () => page({ albumMid: '00000000000000' }) }
  await assert.rejects(fetchWindowsAlbumTracks({ client: invalid, album }), error =>
    error.name === 'WindowsAlbumResponseError' && error.code === 'ALBUM')
})

test('album rejection rebuilds reused owned errors and snapshots external code once without evaluating unsafe name/code getters', async () => {
  const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'
  let captured
  try { decodeWindowsAlbumSongPage(null, { albumMid: request.albumMid, begin: 0, num: 1 }) }
  catch (error) { captured = error }
  assert.equal(captured.code, 'SHAPE')
  captured.message = marker
  Object.defineProperty(captured, 'name', { get() { throw new Error(marker) } })
  Object.defineProperty(captured, 'code', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsAlbumTracks({ client: { request: async () => { throw captured } }, album }),
    error => error !== captured && error.code === 'SHAPE' && !error.message.includes(marker))
  const unknown = new captured.constructor(marker)
  unknown.message = marker
  await assert.rejects(fetchWindowsAlbumTracks({ client: { request: async () => { throw unknown } }, album }),
    error => error !== unknown && error.code === 'REQUEST' && !error.message.includes(marker))
  const changing = new Error(marker); let reads = 0
  Object.defineProperty(changing, 'code', { get: () => ++reads <= 4 ? 22 : marker })
  await assert.rejects(fetchWindowsAlbumTracks({ client: { request: async () => { throw changing } }, album }),
    error => error.code === 22 && !error.message.includes(marker))
  assert.equal(reads, 1)
  const unsafeName = Object.defineProperty({}, 'name', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsAlbumTracks({ client: { request: async () => { throw unsafeName } }, album }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
  const unsafeClient = Object.defineProperty({}, 'request', { get() { throw new Error(marker) } })
  await assert.rejects(fetchWindowsAlbumTracks({ client: unsafeClient, album }),
    error => error.code === 'REQUEST' && !error.message.includes(marker))
  await assert.rejects(fetchWindowsAlbumTracks({ client: { request: async () => {
    throw Object.assign(new Error(marker), { name: 'AbortError' })
  } }, album }), error => error.name === 'AbortError' && !error.message.includes(marker))
})
