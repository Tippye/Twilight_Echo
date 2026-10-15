import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  WINDOWS_CATALOG_SEARCH_TYPES, mapWindowsArtist, mapWindowsAlbum, mapWindowsPlaylist,
  windowsArtistReference, windowsAlbumReference, windowsPlaylistReference,
  windowsCatalogSearchPage, searchWindowsCatalog
} from './lib/windows/search-catalog.mjs'
import { WINDOWS_DESKTOP_SEARCH_REQUEST_KEY } from './lib/windows/search-call.mjs'
import { buildWindowsPlaylistDetailCall } from './lib/windows/playlist-call.mjs'
import { WindowsRpcError } from './lib/windows/response.mjs'

// Display values come from the existing anonymous public song fixture. The
// catalog field names/types come from native parsing and deidentified real shapes.
const song = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url))).publicSongs[0]
const singer = song.singer[0]
const artist = { singerID: singer.id, singerMID: singer.mid, singerName: singer.name,
  singerName_hilight: 'unused highlight', singerPic: 'https://y.gtimg.cn/public-artist.jpg', docid: '123' }
const album = { albumID: song.album.id, albumMID: song.album.mid, albumName: song.album.title,
  albumPic: 'https://y.gtimg.cn/public-album.jpg', singerName: singer.name,
  singer_list: [{ id: singer.id, mid: singer.mid, name: singer.name }], publicTime: '2003-07-31', song_count: 11 }
const playlist = { dissid: '123456789', dissname: '公开测试歌单', imgurl: 'https://y.gtimg.cn/public-playlist.jpg',
  song_count: 7, creator: { creator_uin: '10000', name: '公开测试创作者', encrypt_uin: 'excluded', avatarUrl: 'excluded' },
  introduction: 'excluded', feedbackURL: 'excluded' }
const searchId = '0123456789ABCDEF0123456789ABCDEF00000'
const page = (kind, list, total) => ({ code: 0, meta: { sum: total }, body: { [kind]: { list } } })

test('native catalog semantics map exact observed fields to canonical SDK summaries', () => {
  assert.deepEqual(WINDOWS_CATALOG_SEARCH_TYPES, { artist: 1, album: 2, playlist: 3 })
  assert.deepEqual(mapWindowsArtist(artist), { id: `qq:artist:${singer.mid}:${singer.id}`, name: singer.name, cover: artist.singerPic })
  assert.deepEqual(windowsArtistReference(mapWindowsArtist(artist)), { singerMid: singer.mid, singerId: String(singer.id) })
  assert.deepEqual(mapWindowsAlbum(album), { id: `qq:album:${song.album.mid}:${song.album.id}`, name: song.album.title,
    artist: singer.name, cover: album.albumPic, trackCount: 11, publishTime: Date.UTC(2003, 6, 31) })
  assert.deepEqual(windowsAlbumReference(mapWindowsAlbum(album)), { albumMid: song.album.mid, albumId: String(song.album.id) })
})

test('observed artist songNum and albumNum distinguish real zero from missing catalogue counts', () => {
  const mapped = mapWindowsArtist({ ...artist, songNum: 120, albumNum: 0 })
  assert.equal(mapped.musicSize, 120)
  assert.equal(mapped.albumSize, 0)
  const unknown = mapWindowsArtist({ ...artist, songNum: '120', albumNum: -1 })
  assert.equal(Object.hasOwn(unknown, 'musicSize'), false)
  assert.equal(Object.hasOwn(unknown, 'albumSize'), false)
})

test('public playlists retain native host and signed64 dissid without exporting creator account fields', () => {
  const mapped = mapWindowsPlaylist(playlist)
  assert.deepEqual(mapped, { id: 'qq:playlist:10000:123456789', name: playlist.dissname,
    cover: playlist.imgurl, trackCount: 7, creatorName: playlist.creator.name })
  const reference = windowsPlaylistReference(mapped)
  assert.deepEqual(reference, { hostUin: '10000', disstid: '123456789' })
  const call = buildWindowsPlaylistDetailCall({ loginUin: '99', ...reference })
  assert.deepEqual(JSON.parse(JSON.stringify(call.param)), { login_uin: 99, host_uin: 10000, disstid: 123456789 })
  assert.equal(Object.hasOwn(mapped, 'owned'), false)
  assert.equal(Object.hasOwn(mapped, 'creator_uin'), false)
  assert.equal(Object.hasOwn(mapped, 'encrypt_uin'), false)
  assert.equal(mapWindowsPlaylist({ ...playlist, creator: { creator_uin: '0' } }).id, 'qq:playlist:0:123456789')
})

test('lossless IDs preserve native range boundaries and require real identifiers', () => {
  const result = mapWindowsPlaylist({ ...playlist, dissid: '9223372036854775807', creator: { creator_uin: '18446744073709551615' } })
  assert.deepEqual(windowsPlaylistReference(result), { hostUin: '18446744073709551615', disstid: '9223372036854775807' })
  for (const id of [0, -1, '0', '9223372036854775808', '1\n', ' 1', '1\0', 9007199254740992]) {
    assert.equal(mapWindowsPlaylist({ ...playlist, dissid: id }), null)
  }
  assert.equal(mapWindowsPlaylist({ ...playlist, creator: {} }), null)
  assert.equal(mapWindowsArtist({ ...artist, singerID: '4294967296' }), null)
  assert.equal(mapWindowsArtist({ ...artist, singerID: '4294967295' }).id, `qq:artist:${singer.mid}:4294967295`)
})

test('canonical album and artist IDs reject alternate or incomplete references', () => {
  for (const value of [`qq:artist:${singer.mid}:0${singer.id}`, `qq:album:${song.album.mid}:0`,
    `qq:artist:${singer.mid}:1\n`, 'qq:artist:bad:1', 'qq:playlist:1:2', null]) {
    assert.throws(() => windowsArtistReference(value))
  }
  assert.throws(() => windowsAlbumReference(`qq:album:${song.album.mid}:${song.album.id}:extra`))
  assert.equal(mapWindowsAlbum({ ...album, albumName: '\0secret' }), null)
  assert.equal(mapWindowsArtist({ ...artist, singerMID: `${singer.mid}\n` }), null)
})

test('optional display fields omit invalid dates/counts and unsafe artwork', () => {
  const mapped = mapWindowsAlbum({ ...album, publicTime: '2023-02-30', song_count: -1,
    albumPic: 'https://user:secret@example.test/private', singer_list: [{ name: 'A' }, { name: 'B' }] })
  assert.equal(mapped.publishTime, undefined)
  assert.equal(mapped.trackCount, undefined)
  assert.equal(mapped.cover, null)
  assert.equal(mapped.artist, 'A / B')
  assert.equal(mapWindowsArtist({ ...artist, singerPic: 'javascript:alert(1)' }).cover, null)
})

test('catalog containers and real server totals are required; verification errors stay numeric', () => {
  assert.deepEqual(windowsCatalogSearchPage(page('album', [album], 1), 'album'), { records: [album], total: 1 })
  for (const data of [{ body: { album: { list: [] } } }, page('singer', [], 1), page('album', [], -1)]) {
    assert.throws(() => windowsCatalogSearchPage(data, 'album'))
  }
  assert.throws(() => windowsCatalogSearchPage({ code: 2001, feedbackURL: 'must-never-appear' }, 'artist'),
    error => error instanceof WindowsRpcError && error.code === 2001 && !error.message.includes('must-never-appear'))
})

test('offset across two pages skips raw slots once and uses the single desktop call builder', async () => {
  const requests = []
  const records = Array.from({ length: 30 }, (_, i) => ({ ...artist, singerID: i + 1, singerName: `公开歌手${i}` }))
  const signal = new AbortController().signal
  const client = { request: async (key, call, options) => {
    requests.push(call)
    assert.equal(key, WINDOWS_DESKTOP_SEARCH_REQUEST_KEY)
    assert.equal(call.method, 'DoSearchForQQMusicDesktop')
    assert.equal(options.signal, signal)
    assert.equal(call.param.search_type, 1)
    assert.equal(call.param.remoteplace, 'pc.button.search.song')
    assert.equal(call.param.grp, 1)
    assert.equal(call.param.searchid, searchId)
    return page('singer', records.slice((call.param.page_num - 1) * 10, call.param.page_num * 10), 30)
  } }
  const result = await searchWindowsCatalog({ client, kind: 'artist', query: ' 公开 ', limit: 10, offset: 15, searchId, signal })
  assert.deepEqual(requests.map(c => c.param.page_num), [2, 3])
  assert.deepEqual(result.items.map(item => item.name), records.slice(15, 25).map(item => item.singerName))
  assert.equal(result.total, 30)
})

test('invalid rows consume their original offset slots without unbounded refill', async () => {
  let calls = 0
  const result = await searchWindowsCatalog({ client: { request: async (_key, call) => {
    calls++
    const list = Array.from({ length: 10 }, (_, i) => ({ ...artist, singerID: (call.param.page_num - 1) * 10 + i + 1 }))
    if (call.param.page_num === 1) list[5] = { singerName: 'invalid' }
    return page('singer', list, 1000)
  } }, kind: 'artist', query: '公开', limit: 10, offset: 5, searchId })
  assert.equal(calls, 2)
  assert.equal(result.items.length, 9)
  assert.equal(windowsArtistReference(result.items.at(-1)).singerId, '15')
})

test('short page and total exhaustion stop paging independently of invalid-row count', async () => {
  let calls = 0
  const client = { request: async () => { calls++; return page('songlist', [playlist], 1) } }
  const result = await searchWindowsCatalog({ client, kind: 'playlist', query: '公开', limit: 100, offset: 0, searchId })
  assert.equal(calls, 1)
  assert.equal(result.items.length, 1)
})

test('abort and invalid inputs stop before request, and late abort rejects the returned page', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const client = { request: async () => { calls++; return page('album', [album], 1) } }
  await assert.rejects(searchWindowsCatalog({ client, kind: 'album', query: '公开', signal: controller.signal, searchId }), { name: 'AbortError' })
  for (const override of [{ kind: 'mv' }, { query: '\0private' }, { limit: 0 }, { offset: -1 }, { searchId: undefined }]) {
    await assert.rejects(searchWindowsCatalog({ client, kind: 'album', query: '公开', searchId, ...override }))
  }
  assert.equal(calls, 0)
  const late = new AbortController()
  await assert.rejects(searchWindowsCatalog({ client: { request: async () => {
    late.abort(); return page('album', [album], 1)
  } }, kind: 'album', query: '公开', searchId, signal: late.signal }), { name: 'AbortError' })
})

test('RPC or network failures propagate without retries or fallback categories', async () => {
  let calls = 0
  const failure = new WindowsRpcError(2001)
  await assert.rejects(searchWindowsCatalog({ client: { request: async () => { calls++; throw failure } },
    kind: 'album', query: '公开', searchId }), error => error === failure)
  assert.equal(calls, 1)
})
