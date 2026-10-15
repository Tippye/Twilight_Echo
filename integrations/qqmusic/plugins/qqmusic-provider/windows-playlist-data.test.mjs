import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWindowsPlaylistReference, windowsPlaylistReference,
  mapCreatedWindowsPlaylist, decodeWindowsCreatedPlaylists, mapFavoriteWindowsPlaylist,
  decodeWindowsFavoritePlaylists, decodeWindowsPlaylistDetail } from './lib/windows/playlist-data.mjs'
import { buildWindowsPlaylistDetailCall } from './lib/windows/playlist-call.mjs'
import { parseWindowsJson } from './lib/windows/response.mjs'

// Every value is artificial/public. No real playlist names, IDs or account values.
const sessionUin = '123'
const directory = () => ({ uin: sessionUin, dirId: 3, tid: 456, dirName: '公开测试目录',
  songNum: 2, picUrl: 'https://y.gtimg.cn/public-small.jpg', bigpicUrl: '', nick: '测试作者' })
const response = () => ({ total: 1, v_playlist: [directory()], v_delTid: [], bFinish: true })

test('observed created-directory fields map to the SDK summary without private DTO extras', () => {
  const dto = { ...directory(), desc: 'must not be copied', avatar: 'must not be copied', ext1: 'must not be copied' }
  assert.deepEqual(mapCreatedWindowsPlaylist(dto, { sessionUin }), {
    id: 'qq:playlist:123:456:3', name: '公开测试目录', cover: 'https://y.gtimg.cn/public-small.jpg',
    trackCount: 2, creatorName: '测试作者', owned: true
  })
  const mapped = decodeWindowsCreatedPlaylists(response(), { sessionUin })
  assert.equal(mapped.total, 1)
  assert.equal(mapped.finished, true)
  assert.equal(mapped.playlists.length, 1)
})

test('directory ID survives a JSON-only restart and reconstructs all native detail parameters', () => {
  const restored = JSON.parse(JSON.stringify(mapCreatedWindowsPlaylist(directory(), { sessionUin })))
  const reference = windowsPlaylistReference(restored)
  assert.deepEqual(reference, { hostUin: '123', disstid: '456', dirid: '3' })
  assert.equal(JSON.stringify(buildWindowsPlaylistDetailCall({ loginUin: sessionUin, ...reference })),
    '{"module":"music.srfDissInfo.DissInfoForPc","method":"uniform_get_Dissinfo","param":{"login_uin":123,"dirid":3,"host_uin":123,"disstid":456}}')
})

test('public references and UInt64/signed64 extremes remain exact without Number conversion', () => {
  assert.deepEqual(windowsPlaylistReference(createWindowsPlaylistReference({ hostUin: '18446744073709551615',
    disstid: '-9223372036854775808' })), { hostUin: '18446744073709551615', disstid: '-9223372036854775808' })
  const dto = parseWindowsJson('{"uin":"18446744073709551615","dirId":18446744073709551615,"tid":9223372036854775807,"dirName":"public","songNum":0,"picUrl":"","bigpicUrl":"","nick":""}')
  const mapped = mapCreatedWindowsPlaylist(dto, { sessionUin: dto.uin })
  assert.equal(mapped.id, 'qq:playlist:18446744073709551615:9223372036854775807:18446744073709551615')
  assert.deepEqual(windowsPlaylistReference(mapped), { hostUin: '18446744073709551615',
    disstid: '9223372036854775807', dirid: '18446744073709551615' })
})

test('partial responses retain finished=false and never invent liked folders or status semantics', () => {
  const data = { ...response(), total: 4, bFinish: false }
  const result = decodeWindowsCreatedPlaylists(data, { sessionUin })
  assert.equal(result.finished, false)
  assert.equal(result.total, 4)
  assert.equal(Object.hasOwn(result, 'likedPlaylist'), false)
  assert.deepEqual(Object.keys(result), ['playlists', 'total', 'finished'])
})

test('strict canonical parser rejects aliases, foreign providers and malformed native IDs', () => {
  for (const id of [undefined, null, 456, {}, 'qq:123:456', 'ncm:playlist:123:456', 'qq:playlist:123:456:',
    'qq:playlist:123:456:3:4', 'qq:playlist:00123:456', 'qq:playlist:123:-0', 'qq:playlist:123:456:03',
    'qq:playlist:-1:456', 'qq:playlist:123:9223372036854775808', 'qq:playlist:123:456:18446744073709551616',
    'qq:playlist:123:456\n']) assert.throws(() => windowsPlaylistReference(id))
  assert.equal(createWindowsPlaylistReference({ hostUin: '00123', disstid: '-0', dirid: 0 }), 'qq:playlist:123:0:0')
})

test('shared reference generator rejects whitespace/delimiters in every numeric component', () => {
  const valid = { hostUin: '123', disstid: '456', dirid: '3' }
  for (const field of Object.keys(valid)) {
    for (const value of ['1\n', '1\r', '1\r\n', ' 1', '1 ', '1\t', '1:2', '1\0', '+1', '',
      Number.MAX_SAFE_INTEGER + 1, 1.5, Infinity, [], {}]) {
      assert.throws(() => createWindowsPlaylistReference({ ...valid, [field]: value }))
    }
  }
})

test('malformed/unsafe identity, incomplete DTO and foreign-owner records reject with generic errors', () => {
  const secret = 'a-private-playlist-value'
  const cases = [null, [], {}, { ...directory(), uin: 123 }, { ...directory(), uin: '124' },
    { ...directory(), dirId: undefined }, { ...directory(), dirId: Number.MAX_SAFE_INTEGER + 1 },
    { ...directory(), dirId: -1 }, { ...directory(), tid: '9223372036854775808' },
    { ...directory(), tid: '-9223372036854775809' }, { ...directory(), dirName: '   ' },
    { ...directory(), dirName: '\0' }, { ...directory(), dirName: '\ud800' },
    { ...directory(), dirName: 'x'.repeat(4097) }, { ...directory(), nick: secret + '\0' },
    { ...directory(), songNum: -1 }, { ...directory(), songNum: '2' }, { ...directory(), songNum: Infinity }]
  for (const value of cases) assert.throws(() => mapCreatedWindowsPlaylist(value, { sessionUin }),
    error => error.message === 'QQ 音乐歌单数据无效' && !error.message.includes(secret))
  assert.throws(() => mapCreatedWindowsPlaylist(directory()))
})

test('cover selection accepts bounded credential-free HTTP URLs and rejects unsafe schemes/credentials', () => {
  assert.equal(mapCreatedWindowsPlaylist({ ...directory(), bigpicUrl: 'https://y.gtimg.cn/public-large.jpg' },
    { sessionUin }).cover, 'https://y.gtimg.cn/public-large.jpg')
  assert.equal(mapCreatedWindowsPlaylist({ ...directory(), picUrl: '', bigpicUrl: '' }, { sessionUin }).cover, null)
  assert.equal(mapCreatedWindowsPlaylist({ ...directory(), picUrl: 'http://y.gtimg.cn/public.jpg' }, { sessionUin }).cover,
    'http://y.gtimg.cn/public.jpg')
  for (const value of [undefined, null, 'javascript:alert(1)', 'file:///C:/private', '//y.gtimg.cn/public.jpg',
    'https://user:password@y.gtimg.cn/public.jpg', 'not a URL']) {
    assert.throws(() => mapCreatedWindowsPlaylist({ ...directory(), picUrl: value }, { sessionUin }))
  }
})

test('initial snapshot decoder rejects deltas, duplicates and malformed/inconsistent containers', () => {
  for (const data of [null, [], {}, { ...response(), v_playlist: {} }, { ...response(), v_playlist: new Array(1) },
    { ...response(), v_delTid: [1] }, { ...response(), v_delTid: null }, { ...response(), bFinish: 1 },
    { ...response(), total: 0 }, { ...response(), total: '1' }, { ...response(), total: -1 },
    { ...response(), total: 2, v_playlist: [directory(), directory()] },
    { ...response(), v_playlist: new Array(10001), total: 10001 }]) {
    assert.throws(() => decodeWindowsCreatedPlaylists(data, { sessionUin }))
  }
  assert.deepEqual(decodeWindowsCreatedPlaylists({ total: 0, v_playlist: [], v_delTid: [], bFinish: true },
    { sessionUin }), { playlists: [], total: 0, finished: true })
  const data = response()
  const result = decodeWindowsCreatedPlaylists(data, { sessionUin })
  data.v_playlist[0].dirName = 'changed'
  data.v_playlist.length = 0
  assert.equal(result.playlists[0].name, '公开测试目录')
})

const favorite = () => ({ uin: '124', tid: 789, dirId: 9, name: '公开测试收藏', songnum: 1,
  logo: '', nickname: '公开测试创建者' })
const favorites = () => ({ number: 1, hasmore: 0, v_list: [favorite()], v_failTids: [],
  v_delTids: [999], total: 1, hide: false })

test('favorite DTO preserves creator identity without selecting the caller directory branch', () => {
  assert.deepEqual(mapFavoriteWindowsPlaylist(favorite(), { sessionUin }), {
    id: 'qq:playlist:124:789', name: '公开测试收藏', cover: null,
    trackCount: 1, creatorName: '公开测试创建者', owned: false
  })
  assert.equal(mapFavoriteWindowsPlaylist({ ...favorite(), uin: '123' }, { sessionUin }).owned, true)
  const decoded = decodeWindowsFavoritePlaylists(favorites(), { sessionUin })
  assert.deepEqual({ ...decoded, playlists: decoded.playlists.map(playlist => playlist.id) }, {
    playlists: ['qq:playlist:124:789'], total: 1, reportedCount: 1,
    hasMore: false, hidden: false, deletedTids: ['999']
  })
})

test('favorite tombstones and paging remain explicit without deleting records or inventing cursors', () => {
  const data = { ...favorites(), hasmore: 1, total: 10, number: 3, hide: true, v_delTids: [789] }
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin })
  assert.equal(result.hasMore, true)
  assert.equal(result.hidden, true)
  assert.equal(result.playlists.length, 1)
  assert.deepEqual(result.deletedTids, ['789'])
  assert.equal(Object.hasOwn(result, 'nextOffset'), false)
  assert.equal(Object.hasOwn(result, 'likedPlaylist'), false)
  assert.equal(result.reportedCount, 3)
})

test('favorite lossless IDs/tombstones stay signed64 and mutable DTO input is not retained', () => {
  const data = parseWindowsJson('{"number":1,"hasmore":0,"v_list":[{"uin":"18446744073709551615","tid":9223372036854775807,"name":"public","songnum":0,"logo":"","nickname":""}],"v_failTids":[],"v_delTids":[-9223372036854775808],"total":1,"hide":false}')
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin })
  assert.equal(result.playlists[0].id, 'qq:playlist:18446744073709551615:9223372036854775807')
  assert.deepEqual(result.deletedTids, ['-9223372036854775808'])
  data.v_list[0].name = 'changed'
  data.v_delTids[0] = 1
  assert.equal(result.playlists[0].name, 'public')
  assert.deepEqual(result.deletedTids, ['-9223372036854775808'])
})

test('malformed favorites and unobserved failure-list entries reject rather than silently disappearing', () => {
  for (const data of [null, {}, { ...favorites(), v_list: new Array(1) }, { ...favorites(), v_list: {} },
    { ...favorites(), v_list: [favorite(), favorite()] }, { ...favorites(), v_failTids: [1] },
    { ...favorites(), v_delTids: [1, '01'] }, { ...favorites(), v_delTids: new Array(1) },
    { ...favorites(), v_delTids: ['9223372036854775808'] }, { ...favorites(), hasmore: true },
    { ...favorites(), hasmore: 2 }, { ...favorites(), hide: 0 }, { ...favorites(), number: '1' },
    { ...favorites(), total: -1 }, { ...favorites(), v_list: [{ ...favorite(), uin: 124 }] },
    { ...favorites(), v_list: [{ ...favorite(), name: '' }] },
    { ...favorites(), v_list: [{ ...favorite(), logo: 'https://user:secret@y.gtimg.cn/pic.jpg' }] }]) {
    assert.throws(() => decodeWindowsFavoritePlaylists(data, { sessionUin }))
  }
})

const displayFavorites = () => ({ ...favorites(), number: 2, total: 2,
  v_list: [{ ...favorite(), dirShow: 1 }, { ...favorite(), tid: 999, uin: '', logo: '', nickname: '',
    dirShow: 0, status: 0, opType: 5, dirType: 0 }], v_delTids: [999] })

test('explicit server-visible adapter policy filters only display0 and never invents a blank owner', () => {
  const data = displayFavorites()
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly: true })
  assert.deepEqual(result.playlists.map(playlist => playlist.id), ['qq:playlist:124:789'])
  assert.equal(result.hiddenCount, 1)
  assert.equal(result.total, 2)
  assert.equal(result.reportedCount, 2)
  assert.equal(result.hidden, false)
  assert.deepEqual(result.deletedTids, ['999'])
  assert.equal(JSON.stringify(result).includes('qq:playlist:0:999'), false)
  assert.throws(() => decodeWindowsFavoritePlaylists(data, { sessionUin }))
  assert.throws(() => decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly: false }))
})

test('visible1 remains visible even with status0/opType5 and matching native deletion ID', () => {
  const data = { ...favorites(), v_list: [{ ...favorite(), dirShow: 1, status: 0, opType: 5 }],
    v_delTids: [789] }
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly: true })
  assert.equal(result.playlists.length, 1)
  assert.equal(result.hiddenCount, 0)
  assert.deepEqual(result.deletedTids, ['789'])
  assert.equal(result.playlists[0].owned, false)
  data.v_list[0].uin = sessionUin
  assert.equal(decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly: true }).playlists[0].owned, true)
})

test('whole-favorites hide is a separate adapter policy and reports the native total as hidden', () => {
  const data = { ...displayFavorites(), hide: true, total: 4, hasmore: 1 }
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly: true })
  assert.deepEqual(result.playlists, [])
  assert.equal(result.hiddenCount, 4)
  assert.equal(result.total, 4)
  assert.equal(result.reportedCount, 2)
  assert.equal(result.hasMore, true)
  assert.equal(result.hidden, true)
  assert.deepEqual(result.deletedTids, ['999'])
  assert.throws(() => decodeWindowsFavoritePlaylists({ ...data, v_list: [{ ...favorite(), dirShow: 1, uin: '' }] },
    { sessionUin, visibleOnly: true }))
  assert.throws(() => decodeWindowsFavoritePlaylists({ ...data, v_delTids: ['bad'] },
    { sessionUin, visibleOnly: true }))
})

test('server-visible preflight validates hidden rows and exact display enums before filtering', () => {
  const data = displayFavorites()
  for (const dirShow of [undefined, null, false, true, '0', '1', -1, 2, NaN]) {
    const hidden = { ...data.v_list[1], dirShow }
    assert.throws(() => decodeWindowsFavoritePlaylists({ ...data, v_list: [data.v_list[0], hidden] },
      { sessionUin, visibleOnly: true }))
  }
  for (const mutation of [{ uin: ' ' }, { uin: '\0' }, { uin: 0 }, { uin: '18446744073709551616' },
    { tid: '9223372036854775808' }, { tid: Number.MAX_SAFE_INTEGER + 1 }, { songnum: -1 },
    { songnum: '1' }, { name: '' }, { name: '\ud800' }, { name: 'x'.repeat(4097) },
    { nickname: undefined }, { logo: undefined }, { logo: 'https://user:secret@y.gtimg.cn/pic.jpg' }]) {
    assert.throws(() => decodeWindowsFavoritePlaylists({ ...data,
      v_list: [data.v_list[0], { ...data.v_list[1], ...mutation }] }, { sessionUin, visibleOnly: true }),
      { message: 'QQ 音乐歌单数据无效' })
  }
  assert.throws(() => decodeWindowsFavoritePlaylists({ ...data,
    v_list: [{ ...favorite(), dirShow: 1, uin: '' }] }, { sessionUin, visibleOnly: true }))
  for (const visibleOnly of [null, 0, 1, 'true']) {
    assert.throws(() => decodeWindowsFavoritePlaylists(favorites(), { sessionUin, visibleOnly }))
  }
  // Filtering must not hide exact duplicate records, with or without a known owner.
  for (const record of data.v_list) {
    assert.throws(() => decodeWindowsFavoritePlaylists({ ...data, v_list: [record, record] },
      { sessionUin, visibleOnly: true }))
  }
})

test('default decoder keeps the forward contract and does not apply display or whole-hide policy', () => {
  const data = { ...favorites(), hide: true, v_list: [{ ...favorite(), dirShow: 0 }] }
  const result = decodeWindowsFavoritePlaylists(data, { sessionUin })
  assert.equal(result.playlists.length, 1)
  assert.equal(result.hidden, true)
  assert.equal(Object.hasOwn(result, 'hiddenCount'), false)
})

const song = () => ({ id: 1, mid: 'publicSong0001', title: '公开测试歌曲', name: '公开测试歌曲', type: 0,
  interval: 60, singer: [{ id: 2, mid: 'publicArts0001', name: '公开测试歌手' }],
  album: { mid: 'publicAlbm0001', title: '公开测试专辑', name: '公开测试专辑' },
  file: { media_mid: 'publicFile0001', size_128mp3: 100, size_320mp3: 0, size_192ogg: 0, size_flac: 0 } })
const detailId = 'qq:playlist:123:456:3'
const nativeDetail = () => ({ code: 0, subcode: 0, msg: 'not copied',
  dirinfo: { id: 456, host_uin: 123, dirid: 3, songnum: 1 }, songlist: [song()], total_song_num: 1 })

test('native detail binds the requested reference and maps standard songs plus playback metadata', () => {
  const data = nativeDetail()
  const result = decodeWindowsPlaylistDetail(data, { playlistId: detailId, sessionUin })
  assert.equal(result.total, 1)
  assert.equal(result.complete, true)
  assert.equal(result.tracks[0].id, 'qq:publicSong0001:1')
  assert.equal(result.tracks[0].title, '公开测试歌曲')
  assert.equal(result.media[0].songid, '1')
  assert.equal(result.media[0].mediaMid, 'publicFile0001')
  assert.equal(Object.hasOwn(result, 'msg'), false)
  assert.equal(result.unsupportedCount, 0)
  assert.deepEqual(Object.keys(result), ['tracks', 'media', 'total', 'complete', 'unsupportedCount'])
  data.songlist[0].title = 'changed'
  data.songlist[0].file.media_mid = 'changed'
  assert.equal(result.tracks[0].title, '公开测试歌曲')
  assert.equal(result.media[0].mediaMid, 'publicFile0001')
})

test('detail preserves order/duplicates and larger native totals remain explicitly incomplete', () => {
  const result = decodeWindowsPlaylistDetail({ ...nativeDetail(), songlist: [song(), song()], total_song_num: 3 },
    { playlistId: detailId, sessionUin })
  assert.equal(result.tracks.length, 2)
  assert.equal(result.total, 3)
  assert.equal(result.complete, false)
  assert.equal(result.tracks[0].id, result.tracks[1].id)
})

test('detail identity comparison preserves unsafe numeric IDs and public references omit directory matching', () => {
  const data = parseWindowsJson('{"code":0,"subcode":0,"dirinfo":{"id":9223372036854775807,"host_uin":18446744073709551615,"dirid":3},"songlist":[],"total_song_num":0}')
  assert.equal(decodeWindowsPlaylistDetail(data,
    { playlistId: 'qq:playlist:18446744073709551615:9223372036854775807' }).complete, true)
  for (const dirinfo of [{ ...nativeDetail().dirinfo, id: 457 }, { ...nativeDetail().dirinfo, host_uin: 124 },
    { ...nativeDetail().dirinfo, dirid: 4 }]) {
    assert.throws(() => decodeWindowsPlaylistDetail({ ...nativeDetail(), dirinfo }, { playlistId: detailId, sessionUin }))
  }
})

test('detail business failures never propagate server messages or other private fields', () => {
  const secret = 'DO_NOT_PROPAGATE_PRIVATE_SERVER_MESSAGE'
  for (const status of [{ code: 1, subcode: 0 }, { code: 0, subcode: -1 }]) {
    assert.throws(() => decodeWindowsPlaylistDetail({ ...nativeDetail(), ...status, msg: secret },
      { playlistId: detailId, sessionUin }), error => error.message === 'QQ 音乐歌单详情请求失败' && !error.message.includes(secret))
  }
  for (const status of [{ code: '0', subcode: 0 }, { code: 0, subcode: undefined },
    { code: 0, subcode: 1.5 }]) {
    assert.throws(() => decodeWindowsPlaylistDetail({ ...nativeDetail(), ...status, msg: secret },
      { playlistId: detailId, sessionUin }), error => !error.message.includes(secret))
  }
})

test('detail malformed containers/song/media reject without reducing native cursor counts', () => {
  for (const data of [null, {}, { ...nativeDetail(), dirinfo: [] }, { ...nativeDetail(), songlist: {} },
    { ...nativeDetail(), songlist: new Array(1) }, { ...nativeDetail(), total_song_num: 0 },
    { ...nativeDetail(), total_song_num: '1' }, { ...nativeDetail(), songlist: [{ ...song(), mid: 'bad' }] },
    { ...nativeDetail(), songlist: [{ ...song(), id: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...nativeDetail(), songlist: [{ ...song(), title: '' }] },
    { ...nativeDetail(), songlist: [{ ...song(), interval: '60' }] },
    { ...nativeDetail(), songlist: [{ ...song(), file: { ...song().file, media_mid: 'bad' } }] },
    { ...nativeDetail(), songlist: [{ ...song(), file: { ...song().file, size_flac: -1 } }] },
    { ...nativeDetail(), songlist: [{ ...song(), singer: new Array(1) }] }]) {
    assert.throws(() => decodeWindowsPlaylistDetail(data, { playlistId: detailId, sessionUin }))
  }
})

test('only observed current-session directory201 accepts a zero response host placeholder', () => {
  const data = { ...nativeDetail(), dirinfo: { ...nativeDetail().dirinfo, dirid: 201, host_uin: 0 } }
  const playlistId = 'qq:playlist:123:456:201'
  assert.equal(decodeWindowsPlaylistDetail(data, { playlistId, sessionUin }).complete, true)
  assert.throws(() => decodeWindowsPlaylistDetail(data, { playlistId }))
  assert.throws(() => decodeWindowsPlaylistDetail(data, { playlistId, sessionUin: '124' }))
  assert.throws(() => decodeWindowsPlaylistDetail(data, { playlistId: 'qq:playlist:123:456', sessionUin }))
  assert.throws(() => decodeWindowsPlaylistDetail({ ...data, dirinfo: { ...data.dirinfo, host_uin: 124 } },
    { playlistId, sessionUin }))
  assert.throws(() => decodeWindowsPlaylistDetail({ ...data, dirinfo: { ...data.dirinfo, id: 457 } },
    { playlistId, sessionUin }))
  assert.throws(() => decodeWindowsPlaylistDetail({ ...data, dirinfo: { ...data.dirinfo, dirid: 202 } },
    { playlistId, sessionUin }))
  assert.throws(() => decodeWindowsPlaylistDetail({ ...data, subcode: 1 }, { playlistId, sessionUin }))
  for (const dirid of ['0', '3', '202']) {
    assert.throws(() => decodeWindowsPlaylistDetail({ ...data, dirinfo: { ...data.dirinfo, dirid: Number(dirid) } },
      { playlistId: `qq:playlist:123:456:${dirid}`, sessionUin }))
  }
})

test('all directory detail decodes require a matching verified-session input even with exact response ownership', () => {
  assert.throws(() => decodeWindowsPlaylistDetail(nativeDetail(), { playlistId: detailId }))
  assert.throws(() => decodeWindowsPlaylistDetail(nativeDetail(), { playlistId: detailId, sessionUin: '124' }))
  assert.throws(() => decodeWindowsPlaylistDetail({ ...nativeDetail(), dirinfo: { id: 456, host_uin: 0, dirid: 201 } },
    { playlistId: 'qq:playlist:0:456:201', sessionUin: '0' }))
})

const unsupportedSong = id => ({ ...song(), id, mid: '', type: 21, data_type: 0,
  file: { ...song().file, media_mid: '' } })

test('mixed native detail preserves unsupported records, source order and same-index media gaps', () => {
  const data = { ...nativeDetail(), songlist: [song(), unsupportedSong(2), { ...song(), id: 3 }],
    total_song_num: 3 }
  const result = decodeWindowsPlaylistDetail(data, { playlistId: detailId, sessionUin })
  assert.deepEqual(result.tracks.map(track => track.id),
    ['qq:publicSong0001:1', 'qq:native:21:2', 'qq:publicSong0001:3'])
  assert.deepEqual(result.media.map(media => media?.songid ?? null), ['1', null, '3'])
  assert.equal(result.tracks[1].title, '公开测试歌曲')
  assert.equal(result.tracks[1].playbackStatus, 'unsupported')
  assert.equal(Object.hasOwn(result.tracks[0], 'playbackStatus'), false)
  assert.equal(result.unsupportedCount, 1)
  assert.equal(result.total, 3)
  assert.equal(result.complete, true)
  assert.equal(result.tracks.length, data.songlist.length)
  assert.equal(result.media.length, data.songlist.length)
  const restored = JSON.parse(JSON.stringify(result.tracks[1]))
  assert.equal(restored.id, 'qq:native:21:2')
  assert.equal(restored.playbackStatus, 'unsupported')
})

test('artificial 544-record directory keeps all records and counts three unsupported identities', () => {
  const positions = new Set([0, 271, 543])
  const songlist = Array.from({ length: 544 }, (_, index) => positions.has(index)
    ? unsupportedSong(index + 1) : { ...song(), id: index + 1 })
  const data = { ...nativeDetail(), songlist, total_song_num: 544 }
  const result = decodeWindowsPlaylistDetail(data, { playlistId: detailId, sessionUin })
  assert.equal(result.tracks.length, 544)
  assert.equal(result.media.length, 544)
  assert.equal(result.media.filter(Boolean).length, 541)
  assert.equal(result.unsupportedCount, 3)
  assert.equal(result.total, 544)
  assert.equal(result.complete, true)
  for (const index of positions) {
    assert.equal(result.tracks[index].id, `qq:native:21:${index + 1}`)
    assert.equal(result.media[index], null)
  }
  data.total_song_num = 545
  assert.equal(decodeWindowsPlaylistDetail(data, { playlistId: detailId, sessionUin }).complete, false)
})

test('unsupported record policy does not excuse other malformed or unobserved record shapes', () => {
  const base = unsupportedSong(2)
  for (const mutation of [{ type: 22 }, { type: '21' }, { data_type: undefined }, { data_type: 1 },
    { data_type: '0' }, { mid: undefined }, { mid: 'bad' }, { mid: song().mid },
    { file: { ...base.file, media_mid: song().file.media_mid } }, { id: 0 }, { id: 4294967296 },
    { title: '' }, { name: undefined }, { interval: -1 }, { album: null }, { singer: new Array(1) },
    { singer: [{ name: '' }] }, { file: { ...base.file, media_mid: undefined } },
    { file: { ...base.file, size_flac: '0' } }]) {
    assert.throws(() => decodeWindowsPlaylistDetail({ ...nativeDetail(), songlist: [song(), { ...base, ...mutation }],
      total_song_num: 2 }, { playlistId: detailId, sessionUin }), { message: 'QQ 音乐歌单数据无效' })
  }
})
