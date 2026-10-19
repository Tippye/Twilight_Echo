import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { mapWindowsTrack, isUnsupportedWindowsSong, windowsSongReference, windowsSongMid, windowsSongMedia, windowsTrackPlaybackQualities, windowsSearchPage, windowsSearchWindow } from './lib/windows/tracks.mjs'
import { windowsArtistReference, windowsAlbumReference } from './lib/windows/search-catalog.mjs'
import { windowsQualityFallbacks } from './lib/windows/quality.mjs'

const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
// Artificial metadata only; this reproduces the observed shape without private values.
const unsupportedSong = () => ({ ...structuredClone(fixture.publicSongs[0]), id: 123,
  mid: '', title: '公开测试记录', name: '公开测试记录', type: 21, data_type: 0,
  file: { ...fixture.publicSongs[0].file, media_mid: '' } })

test('quality fallback chains stay bounded, never upgrade ordinary selections or cross spatial formats', () => {
  const expected = { '128': ['128'], '320': ['320', '128'], flac: ['flac', '320', '128'],
    hires: ['hires', 'flac', '320', '128'], dolby: ['dolby', 'hires', 'flac', '320', '128'],
    surround: ['surround', 'hires', 'flac', '320', '128'],
    master: ['master', 'hires', 'flac', '320', '128'], galaxy: ['galaxy', 'hires', 'flac', '320', '128'] }
  for (const [quality, chain] of Object.entries(expected)) {
    assert.deepEqual(windowsQualityFallbacks(quality), chain)
    assert.equal(new Set(chain).size, chain.length)
    const changed = windowsQualityFallbacks(quality)
    changed.push('injected')
    assert.deepEqual(windowsQualityFallbacks(quality), chain)
  }
  for (const [alias, target] of [['default', '128'], ['high', '320'], ['lossless', 'flac']]) {
    assert.deepEqual(windowsQualityFallbacks(alias), expected[target])
  }
  for (const invalid of [null, '', 'auto', 'toString', 320, 'excellent', 'excellentSpatial']) assert.deepEqual(windowsQualityFallbacks(invalid), [])
})

test('observed Windows song DTO maps a stable Track without persisting media credentials', () => {
  const song = fixture.publicSongs[0]
  const track = mapWindowsTrack(song)
  assert.equal(track.id, 'qq:0039MnYb0qxYhV:97773')
  assert.equal(track.title, '晴天')
  assert.equal(track.artist, '周杰伦')
  assert.equal(track.album, '叶惠美')
  assert.deepEqual(windowsArtistReference(track.artists[0].id), { singerMid: song.singer[0].mid, singerId: String(song.singer[0].id) })
  assert.deepEqual(windowsAlbumReference(track.albumId), { albumMid: song.album.mid, albumId: String(song.album.id) })
  assert.equal(track.duration, 269)
  assert.equal(track.size, 4317292)
  assert.equal(windowsSongMid({ id: track.id }), song.mid)
  assert.deepEqual(windowsSongReference({ id: track.id }), { songmid: song.mid, songid: '97773' })
  assert.equal(Object.hasOwn(track, 'providerMediaId'), false)
  assert.equal(Object.hasOwn(track, 'playbackStatus'), false)
  assert.equal(windowsSongMedia(song).mediaMid, '003Qui1q2u1Zho')
})

test('native UInt32 song IDs remain exact and reject incompatible detail IDs', () => {
  const song = { ...fixture.publicSongs[0], id: '4294967295' }
  assert.equal(windowsSongMedia(song).songid, '4294967295')
  for (const id of ['4294967296', '9007199254740993', 9007199254740992, 0]) {
    assert.throws(() => windowsSongMedia({ ...song, id }), /媒体信息/)
  }
})

test('per-track qualities retain native format candidates, explicit zero and unknown separately from rights', () => {
  const song = structuredClone(fixture.publicSongs[0])
  Object.assign(song.file, { size_128mp3: 1000, size_320mp3: 2000, size_flac: 3000,
    size_hires: 0, size_dolby: 4000 })
  delete song.file.size_dts
  delete song.file.size_new
  delete song.vs
  const result = windowsTrackPlaybackQualities(song)
  assert.equal(result.trackId, 'qq:0039MnYb0qxYhV:97773')
  assert.deepEqual(result.options.map(({ value, availability, metadataSize }) =>
    [value, availability, metadataSize]), [['128', 'candidate', 1000], ['320', 'candidate', 2000],
    ['flac', 'candidate', 3000], ['hires', 'unavailable', 0], ['dolby', 'candidate', 4000], ['surround', 'unknown', undefined],
    ['master', 'unavailable', undefined], ['galaxy', 'unavailable', undefined]])
  assert.match(result.options.find(option => option.value === 'dolby').reason, /当前账号验证/)
  assert.equal(windowsSongMedia(song).sizes.surround, null)
  assert.equal(windowsSongMedia(song).sizes.hires, 0)
  assert.equal(windowsSongMedia(song).sizes.dolby, 4000)
  assert.equal(Object.hasOwn(result.options[5], 'metadataSize'), false)
})

test('premium sizes keep zero, candidate and unknown distinct and require their exact native vs identity', () => {
  const song = structuredClone(fixture.publicSongs[0])
  song.vs = Array(30).fill('')
  song.vs[3] = '003xkcSf3NBRlX'
  song.vs[29] = '004astzo2Y5HDU'
  song.file.size_new = Array(16).fill(0)
  song.file.size_new[8] = 52832835
  let options = windowsTrackPlaybackQualities(song).options
  assert.deepEqual(options.filter(option => ['master', 'galaxy'].includes(option.value))
    .map(({ value, availability, metadataSize }) => [value, availability, metadataSize]),
  [['master', 'unavailable', 0], ['galaxy', 'candidate', 52832835]])
  const media = windowsSongMedia(song)
  assert.equal(media.sizes.master, 0)
  assert.equal(media.sizes.galaxy, 52832835)
  assert.deepEqual(media.qualityMedia.galaxy, { songmid: song.mid, songid: String(song.id),
    mediaMid: song.file.media_mid, songtype: song.type, type: 15, otherMediaMid: '004astzo2Y5HDU' })
  song.vs[29] = '00000000000001'
  assert.equal(media.qualityMedia.galaxy.otherMediaMid, '004astzo2Y5HDU')
  for (const bad of [undefined, null, {}, { 0: 50, 8: 50 }, [], [50], Array(5).fill(50)]) {
    song.file.size_new = bad
    options = windowsTrackPlaybackQualities(song).options
    for (const quality of ['master', 'galaxy']) {
      const option = options.find(option => option.value === quality)
      assert.equal(option.availability, 'unknown')
      assert.equal(Object.hasOwn(option, 'metadataSize'), false)
      assert.equal(windowsSongMedia(song).sizes[quality], null)
    }
  }
  for (const bad of [undefined, null, '0', -1, 0.5, 0x80000000, NaN, Infinity]) {
    song.file.size_new = Array(16).fill(bad)
    for (const quality of ['master', 'galaxy']) {
      assert.equal(windowsTrackPlaybackQualities(song).options.find(option => option.value === quality).availability, 'unknown')
    }
  }
  song.file.size_new = Array(16).fill(1000)
  for (const bad of [undefined, null, {}, [], Array(30).fill(''), Array(30).fill('bad'),
    Array(30).fill('003xkcSf3NBRlX\n'), Array(30).fill('003xkcSf3NBR/X')]) {
    song.vs = bad
    for (const quality of ['master', 'galaxy']) {
      const option = windowsTrackPlaybackQualities(song).options.find(option => option.value === quality)
      assert.equal(option.availability, 'unavailable')
      assert.equal(option.metadataSize, 1000)
      assert.match(option.reason, /媒体标识/)
      assert.equal(windowsSongMedia(song).qualityMedia[quality].otherMediaMid, null)
    }
  }
})

test('malformed or missing format sizes cannot turn unknown into unavailable or permission success', () => {
  for (const value of [undefined, null, '0', '4096', -1, 0.5, 0x80000000, NaN, Infinity, {}, []]) {
    const song = structuredClone(fixture.publicSongs[0])
    song.file.size_dolby = value
    const option = windowsTrackPlaybackQualities(song).options.find(option => option.value === 'dolby')
    assert.equal(option.availability, 'unknown')
    assert.equal(Object.hasOwn(option, 'metadataSize'), false)
    assert.equal(windowsSongMedia(song).sizes.dolby, null)
  }
  const song = structuredClone(fixture.publicSongs[0])
  song.file.size_dolby = 0x7fffffff
  assert.equal(windowsSongMedia(song).sizes.dolby, 0x7fffffff)
})

test('offset windows retain partial-page skip and require real server totals', () => {
  assert.deepEqual(windowsSearchWindow(30, 35), { pageSize: 30, page: 2, skip: 5, limit: 30 })
  assert.deepEqual(windowsSearchWindow(100, 125), { pageSize: 60, page: 3, skip: 5, limit: 100 })
  assert.deepEqual(windowsSearchPage({ body: { song: { list: fixture.publicSongs } }, meta: fixture.meta }),
    { songs: fixture.publicSongs, total: 997 })
  assert.throws(() => windowsSearchPage({ body: { song: { list: [] } } }))
  for (const offset of [-1, 0.5, 1000001]) assert.throws(() => windowsSearchWindow(30, offset))
})

test('invalid identifiers and incomplete metadata fail before a playback request', () => {
  for (const id of ['qq:97773', 'qq:0039MnYb0qxYhV', 'qq:0039MnYb0qxYhV:4294967296', 'qq:0039MnYb0qxYhV:97773:extra', 'ncm:0039MnYb0qxYhV:97773', null]) {
    assert.throws(() => windowsSongMid({ id }))
  }
  assert.equal(mapWindowsTrack({ ...fixture.publicSongs[0], mid: '../bad' }), null)
  assert.throws(() => windowsSongMedia({ ...fixture.publicSongs[0], file: {} }))
})

test('the observed native type21 empty-MID shape retains real identity and visible metadata', () => {
  const input = unsupportedSong()
  const track = mapWindowsTrack(input)
  assert.equal(isUnsupportedWindowsSong(input), true)
  assert.equal(track.id, 'qq:native:21:123')
  assert.equal(track.filePath, track.id)
  assert.equal(track.fileName, '公开测试记录')
  assert.equal(track.playbackStatus, 'unsupported')
  assert.equal(track.title, input.title)
  assert.equal(track.artist, '周杰伦')
  assert.equal(track.album, '叶惠美')
  assert.equal(track.duration, 269)
  assert.equal(track.streamUrl, null)
  assert.equal(Object.hasOwn(track, 'songmid'), false)
  const restored = JSON.parse(JSON.stringify(track))
  assert.equal(restored.id, track.id)
  assert.equal(restored.playbackStatus, 'unsupported')
  input.title = 'changed'
  input.singer[0].name = 'changed'
  assert.equal(track.title, '公开测试记录')
  assert.equal(track.artist, '周杰伦')
})

test('native unsupported identities refuse playback without inventing a normal MID', () => {
  const input = unsupportedSong()
  for (const track of [mapWindowsTrack(input), 'qq:native:21:123', { id: 'qq:native:21:123' },
    'qq:native:21:4294967295']) {
    assert.throws(() => windowsSongReference(track), { message: '当前音源尚不支持该记录' })
    assert.throws(() => windowsSongMid(track), { message: '当前音源尚不支持该记录' })
  }
  assert.throws(() => windowsSongMedia(input), { message: '当前音源尚不支持该记录' })
  for (const id of ['qq:native:21:0', 'qq:native:21:0123', 'qq:native:21:4294967296',
    'qq:native:21:123\n', 'qq:native:22:123', 'qq:native:21:' + '1'.repeat(1000)]) {
    assert.throws(() => windowsSongReference(id), { message: 'QQ 音乐歌曲标识无效' })
  }
})

test('type21 exception is narrow and malformed empty-MID records remain rejected', () => {
  const input = unsupportedSong()
  const mutations = [
    { type: 22 }, { type: '21' }, { data_type: undefined }, { data_type: 1 }, { data_type: '0' },
    { mid: undefined }, { mid: null }, { mid: ' ' },
    { file: { ...input.file, media_mid: undefined } }, { file: { ...input.file, media_mid: ' ' } },
    { id: 0 }, { id: -1 }, { id: 4294967296 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: '1'.repeat(1000) }, { title: '' }, { title: '\0' }, { title: '\ud800' },
    { name: undefined }, { interval: '269' }, { album: null }, { singer: new Array(1) },
    { singer: [{ name: '' }] }, { file: { ...input.file, size_flac: -1 } }
  ]
  for (const mutation of mutations) {
    const song = { ...input, ...mutation }
    assert.equal(isUnsupportedWindowsSong(song), false)
    assert.equal(mapWindowsTrack(song), null)
    assert.throws(() => windowsSongMedia(song), { message: 'QQ 音乐歌曲详情缺少媒体信息' })
  }
  assert.equal(mapWindowsTrack({ ...input, id: 4294967295 }).id, 'qq:native:21:4294967295')
  assert.equal(mapWindowsTrack({ ...input, id: '123' }).id, 'qq:native:21:123')
  const withMedia = { ...input, mid: fixture.publicSongs[0].mid,
    file: { ...input.file, media_mid: fixture.publicSongs[0].file.media_mid } }
  assert.equal(isUnsupportedWindowsSong(withMedia), false)
  assert.equal(Object.hasOwn(mapWindowsTrack(withMedia), 'playbackStatus'), false)
  assert.equal(windowsSongMedia(withMedia).songtype, 21)
})
