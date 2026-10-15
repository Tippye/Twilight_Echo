import { windowsArtistReference, windowsAlbumReference, mapWindowsAlbum } from './search-catalog.mjs'
import { mapWindowsTrack, windowsSongReference } from './tracks.mjs'
import { WindowsRpcError } from './response.mjs'

// The shipped Windows resource config selects this official embedded page.
// The saved current public asset is JavaScript evidence, not a C++ producer.
// Sending these shapes through WindowsMusicClient ct19/cv2271 is an adapter
// compatibility choice accepted by Root's saved public-artist real RPCs. The original
// embedded transport uses req_i, ct20 and browser cookies; none are copied here.
export const WINDOWS_EMBEDDED_ARTIST_PROVENANCE = Object.freeze({
  kind: 'windows-configured-embedded-web',
  artifact: 'QQMusicResource.dll',
  artifactSha256: 'f635b213a60fad43f46dd8c49c913904420a4f9f480be952984955ccc2186e89',
  resource: 'JSON/2009/2052',
  resourceSha256: 'fc58467fa8900c227f514a063fe90240301cc6e55f72e3776934024b78050da7',
  configuredPage: 'https://y.qq.com/wk_v17/#/singer_detail/song',
  assetSha256: '2a5fbdfd1a7c7fda4a887481e9a347950b08bea1da1c12988c3e7359b97ea3e3',
  nativeClientTransport: 'compatibility-accepted-public-artist-rpc',
  realServiceEvidence: 'qq-artist-real-response-shapes.json'
})

// Outer full-service keys belong to this native-client adapter. The embedded
// page batches the same module/method/param objects under its req_i keys.
export const WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY = 'music.musichallSong.SongListInter.GetSingerSongList'
export const WINDOWS_ARTIST_DETAIL_REQUEST_KEY = 'music.musichallSinger.SingerInfoInter.GetSingerDetail'
export const WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY = 'music.musichallAlbum.AlbumListServer.GetAlbumList'
export const WINDOWS_ARTIST_TOP_SONGS_POLICY = Object.freeze({ begin: 0, num: 10, order: 1 })
// Source /album initializes order0/begin0/num30. Full collection progress by
// returned rows and these resource caps are adapter policy, not a C++ default
// or a response cursor: the observed response has singerMid/total, not curBegin.
export const WINDOWS_ARTIST_ALBUM_PAGING_POLICY = Object.freeze({
  order: 0, pageSize: 30, maxPages: 100, maxRawRows: 10000
})

const MAX_PAGE_ROWS = 100 // Adapter resource cap; embedded source proves no wire integer width/server cap.
const MAX_BEGIN = 1000000
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const mid = value => typeof value === 'string' && value.length === 14 && /^[A-Za-z0-9]+$/.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const validationCodes = new Set(['FIELD', 'ARTIST', 'INPUT', 'IDENTITY', 'SHAPE',
  'COUNT', 'TRACK', 'PROGRESS', 'ALBUM', 'TOTAL_CHANGED', 'LIMIT', 'REQUEST'])
const ownedValidationCodes = new WeakMap()
class WindowsArtistResponseError extends Error {
  constructor(code) {
    super('QQ 音乐艺人数据无法验证')
    this.name = 'WindowsArtistResponseError'
    this.code = validationCodes.has(code) ? code : 'REQUEST'
    ownedValidationCodes.set(this, this.code)
  }
}
const invalid = code => new WindowsArtistResponseError(code)
function text(value, { nonempty = false, maximum = 4096 } = {}) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || !value.isWellFormed() ||
      Buffer.byteLength(value, 'utf8') > maximum || nonempty && value.trim().length === 0) throw invalid('FIELD')
  return value
}
function singerMid(value) { if (!mid(value)) throw invalid('ARTIST'); return value }
function paging(begin, num, order) {
  if (!Number.isSafeInteger(begin) || begin < 0 || begin > MAX_BEGIN ||
      !Number.isSafeInteger(num) || num < 1 || num > MAX_PAGE_ROWS || (order !== 0 && order !== 1)) throw invalid('INPUT')
  return { begin, num, order }
}
function artistReference(artist) {
  try { return windowsArtistReference(artist) } catch { throw invalid('ARTIST') }
}
function nativeIdentity(value) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || source.length === 0 || source.length > 10 || /[^0-9]/.test(source)) throw invalid('IDENTITY')
  const number = BigInt(source)
  if (number < 1n || number > 0xffffffffn) throw invalid('IDENTITY')
  return number.toString()
}
function cancelled() {
  const error = new Error('QQ 音乐艺人加载已取消')
  error.name = 'AbortError'
  return error
}
function check(signal) { if (signal?.aborted) throw cancelled() }
function normalizedError(error, signal) {
  try {
    if (signal?.aborted) return cancelled()
    if (error instanceof WindowsArtistResponseError) return invalid(ownedValidationCodes.get(error) ?? 'REQUEST')
    if (error?.name === 'AbortError') return cancelled()
    if (error instanceof WindowsRpcError) {
      const code = error.code
      if (Number.isInteger(code) && code !== 0 && code >= -0x80000000 && code <= 0x7fffffff) return new WindowsRpcError(code)
    }
  } catch {}
  return invalid('REQUEST')
}

/** Embedded /song and overview use order1 (最热); order0 is the source's 最新 label. */
export function buildWindowsArtistSongListCall({ singerMid: value, begin, num, order } = {}) {
  return { module: 'music.musichallSong.SongListInter', method: 'GetSingerSongList',
    param: { singerMid: singerMid(value), ...paging(begin, num, order) } }
}

/** Exact one-artist detail fields from the embedded overview request. */
export function buildWindowsArtistDetailCall({ singerMid: value } = {}) {
  return { module: 'music.musichallSinger.SingerInfoInter', method: 'GetSingerDetail',
    param: { singer_mids: [singerMid(value)], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 } }
}

/** All albums omit types; the embedded tabs emit one of CD0, EP11 or live1. */
export function buildWindowsArtistAlbumListCall({ singerMid: value, begin, num, order, types } = {}) {
  if (types !== undefined && (!Array.isArray(types) || types.length !== 1 || ![0, 11, 1].includes(types[0]))) throw invalid('INPUT')
  return { module: 'music.musichallAlbum.AlbumListServer', method: 'GetAlbumList',
    param: { singerMid: singerMid(value), ...paging(begin, num, order),
      ...(types === undefined ? {} : { types: [...types] }) } }
}

/** Shared song mapper receives exactly the source's songList[].songInfo path. */
export function decodeWindowsArtistSongList(data, { singerMid: value, num } = {}) {
  singerMid(value)
  if (!Number.isInteger(num) || num < 1 || num > MAX_PAGE_ROWS) throw invalid('INPUT')
  if (!object(data) || !Array.isArray(data.songList) || data.songList.length > num) throw invalid('SHAPE')
  if (data.singerMid !== value) throw invalid('ARTIST')
  if (!count(data.totalNum) || data.totalNum < data.songList.length) throw invalid('COUNT')
  const ids = new Set(), mids = new Set()
  return Array.from(data.songList, row => {
    if (!object(row) || !object(row.songInfo)) throw invalid('TRACK')
    const track = mapWindowsTrack(row.songInfo)
    if (!track) throw invalid('TRACK')
    let identity
    try { identity = windowsSongReference(track) } catch { throw invalid('TRACK') }
    if (ids.has(identity.songid) || mids.has(identity.songmid)) throw invalid('IDENTITY')
    ids.add(identity.songid); mids.add(identity.songmid)
    return track
  })
}

/** Only the directly consumed description is exposed; wiki/XML is not parsed. */
export function decodeWindowsArtistDetail(data, { artist } = {}) {
  const reference = artistReference(artist)
  if (!object(data) || !Array.isArray(data.singer_list) || data.singer_list.length !== 1) throw invalid('SHAPE')
  const row = data.singer_list[0]
  if (!object(row) || !object(row.basic_info) || !object(row.ex_info) ||
      row.basic_info.singer_mid !== reference.singerMid || nativeIdentity(row.basic_info.singer_id) !== reference.singerId) {
    throw invalid('IDENTITY')
  }
  return { id: `qq:artist:${reference.singerMid}:${reference.singerId}`,
    name: text(row.basic_info.name, { nonempty: true }),
    description: text(row.ex_info.desc, { maximum: 65536 }) }
}

/**
 * Real public AlbumList DTO keys are recorded in qq-artist-real-response-shapes.
 * Reuse the existing canonical album/date mapper. No albumPic was observed;
 * cover stays null rather than constructing a URL from unproved DTO fields.
 * Caller begin is a request offset; no response cursor is invented.
 */
export function decodeWindowsArtistAlbumPage(data, { singerMid: value, begin, num,
  seenIds = new Set(), seenMids = new Set() } = {}) {
  singerMid(value)
  paging(begin, num, WINDOWS_ARTIST_ALBUM_PAGING_POLICY.order)
  if (!(seenIds instanceof Set) || !(seenMids instanceof Set)) throw invalid('INPUT')
  if (!object(data) || !Array.isArray(data.albumList) || data.albumList.length > num) throw invalid('SHAPE')
  if (data.singerMid !== value) throw invalid('ARTIST')
  const total = data.total, rawRows = data.albumList.length
  if (!count(total) || begin < total && rawRows > total - begin || begin >= total && rawRows !== 0) throw invalid('COUNT')
  if (begin < total && rawRows === 0) throw invalid('PROGRESS')
  const ids = new Set(seenIds), mids = new Set(seenMids), albumIds = [], albumMids = []
  const albums = Array.from(data.albumList, row => {
    if (!object(row) || !mid(row.albumMid) || !count(row.totalNum)) throw invalid('ALBUM')
    const album = mapWindowsAlbum({ albumID: row.albumID, albumMID: row.albumMid,
      albumName: text(row.albumName, { nonempty: true }), song_count: row.totalNum,
      publicTime: text(row.publishDate), singerName: text(row.singerName) })
    if (!album) throw invalid('ALBUM')
    const reference = windowsAlbumReference(album)
    if (ids.has(reference.albumId) || mids.has(reference.albumMid)) throw invalid('IDENTITY')
    ids.add(reference.albumId); mids.add(reference.albumMid)
    albumIds.push(reference.albumId); albumMids.push(reference.albumMid)
    return album
  })
  const nextOffset = begin + rawRows
  return { albums, total, rawRows, nextOffset, hasMore: nextOffset < total, albumIds, albumMids }
}

async function request({ client, key, call, signal, decode }) {
  try {
    if (typeof client?.request !== 'function') throw invalid('INPUT')
    check(signal)
    const data = await client.request(key, call, { signal })
    check(signal)
    return decode(data)
  } catch (error) {
    throw normalizedError(error, signal)
  }
}

/** One bounded overview Top10 request, not an invented all-songs pagination contract. */
export async function fetchWindowsArtistTopSongs({ client, artist, signal } = {}) {
  const reference = artistReference(artist)
  const call = buildWindowsArtistSongListCall({ singerMid: reference.singerMid, ...WINDOWS_ARTIST_TOP_SONGS_POLICY })
  return request({ client, key: WINDOWS_ARTIST_SONG_LIST_REQUEST_KEY, call, signal,
    decode: data => decodeWindowsArtistSongList(data, { singerMid: reference.singerMid, num: WINDOWS_ARTIST_TOP_SONGS_POLICY.num }) })
}

/** Host renders this string with text interpolation; no HTML or wiki fallback is introduced. */
export async function fetchWindowsArtistIntro({ client, artist, signal } = {}) {
  const reference = artistReference(artist)
  const identity = `qq:artist:${reference.singerMid}:${reference.singerId}`
  const call = buildWindowsArtistDetailCall({ singerMid: reference.singerMid })
  return request({ client, key: WINDOWS_ARTIST_DETAIL_REQUEST_KEY, call, signal,
    decode: data => decodeWindowsArtistDetail(data, { artist: identity }).description })
}

/** Complete bounded all-albums read. Failures return no partial collection. */
export async function fetchWindowsArtistAlbums({ client, artist, signal,
  pageSize = WINDOWS_ARTIST_ALBUM_PAGING_POLICY.pageSize } = {}) {
  const reference = artistReference(artist)
  paging(0, pageSize, WINDOWS_ARTIST_ALBUM_PAGING_POLICY.order)
  const seenIds = new Set(), seenMids = new Set(), albums = []
  let begin = 0, total = null, rawRows = 0
  for (let pageNumber = 0; pageNumber < WINDOWS_ARTIST_ALBUM_PAGING_POLICY.maxPages; pageNumber++) {
    check(signal)
    const call = buildWindowsArtistAlbumListCall({ singerMid: reference.singerMid, begin,
      num: pageSize, order: WINDOWS_ARTIST_ALBUM_PAGING_POLICY.order })
    const page = await request({ client, key: WINDOWS_ARTIST_ALBUM_LIST_REQUEST_KEY, call, signal,
      decode: data => decodeWindowsArtistAlbumPage(data, { singerMid: reference.singerMid, begin,
        num: pageSize, seenIds, seenMids }) })
    check(signal)
    if (total !== null && total !== page.total) throw invalid('TOTAL_CHANGED')
    total = page.total
    if (total > WINDOWS_ARTIST_ALBUM_PAGING_POLICY.maxRawRows ||
        rawRows + page.rawRows > WINDOWS_ARTIST_ALBUM_PAGING_POLICY.maxRawRows) throw invalid('LIMIT')
    rawRows += page.rawRows
    for (const id of page.albumIds) seenIds.add(id)
    for (const value of page.albumMids) seenMids.add(value)
    albums.push(...page.albums)
    if (!page.hasMore) return albums
    begin = page.nextOffset
  }
  throw invalid('LIMIT')
}
