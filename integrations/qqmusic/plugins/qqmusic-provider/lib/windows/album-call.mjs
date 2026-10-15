import { mapWindowsTrack, windowsSongReference } from './tracks.mjs'
import { windowsAlbumReference } from './search-catalog.mjs'
import { WindowsRpcError } from './response.mjs'

export const WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY = 'music.musichallAlbum.AlbumSongList.GetAlbumSongList'
export const WINDOWS_ALBUM_SONG_LIST_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  producer: '0x10029c0f',
  evidenceId: 'ev_172c2491f9e3683d10eb54bb69a869adbb61e07fe6c97980a113ea65491f1833'
})

function integer(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} is outside its native integer range`)
  }
  return value
}

/** Native producer fields. Pagination/order values belong to the caller; no defaults are inferred. */
export function buildWindowsAlbumSongListCall({ albumMid, albumId, begin, num, order } = {}) {
  if (typeof albumMid !== 'string' || albumMid.includes('\0')) {
    throw new TypeError('albumMid must be a string without NUL')
  }
  const albumID = integer(albumId, 0, 0xffffffff, 'albumId')
  // Native exits before constructing a request when both album identities are empty.
  if (albumMid.length === 0 && albumID === 0) throw new Error('QQ 音乐专辑标识无效')
  return { module: 'music.musichallAlbum.AlbumSongList', method: 'GetAlbumSongList',
    param: { albumMid, albumID,
      begin: integer(begin, -0x80000000, 0x7fffffff, 'begin'),
      num: integer(num, -0x80000000, 0x7fffffff, 'num'),
      order: integer(order, -0x80000000, 0x7fffffff, 'order') } }
}

/**
 * Client supplies the successful RPC item's data. Native ParseAlbumSongList@1002b055
 * reads data.songList[].songInfo and skips rows rejected by SongItem parser@10045c05.
 * Ordinary field/IAT evidence is recorded in qq-album-native-typed.json; shared public
 * track mapping retains the persisted UInt32 ID/MID without exporting raw DTO extras.
 * The response path does not establish a total count or complete-pagination policy.
 */
export function mapWindowsAlbumSongList(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.songList)) {
    throw new Error('QQ 音乐专辑歌曲列表无效')
  }
  return data.songList.map(row => mapWindowsTrack(row?.songInfo)).filter(Boolean)
}

// Explicit adapter policy: actual public begin0/num2 and begin2/num2 responses
// preserve this order0 and echo curBegin. Native order defaults/enums are unknown.
export const WINDOWS_ALBUM_PAGING_POLICY = Object.freeze({
  order: 0, pageSize: 100, maxPages: 100, maxRawRows: 10000
})
const MID = value => typeof value === 'string' && value.length === 14 && /^[A-Za-z0-9]+$/.test(value)
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 0x7fffffff
const validationCodes = new Set(['PAGE', 'INPUT', 'SHAPE', 'ALBUM', 'CURSOR', 'COUNT',
  'PROGRESS', 'TRACK', 'IDENTITY', 'TOTAL_CHANGED', 'LIMIT', 'REQUEST'])
const ownedValidationCodes = new WeakMap()
class WindowsAlbumResponseError extends Error {
  constructor(code) {
    super('QQ 音乐专辑歌曲列表无法验证')
    this.name = 'WindowsAlbumResponseError'
    this.code = validationCodes.has(code) ? code : 'REQUEST'
    ownedValidationCodes.set(this, this.code)
  }
}
const invalidPage = (code = 'PAGE') => new WindowsAlbumResponseError(code)
function cancelled() {
  const error = new Error('QQ 音乐专辑加载已取消')
  error.name = 'AbortError'
  return error
}
function check(signal) { if (signal?.aborted) throw cancelled() }
function normalizedError(error, signal) {
  try {
    if (signal?.aborted) return cancelled()
    if (error instanceof WindowsAlbumResponseError) return invalidPage(ownedValidationCodes.get(error) ?? 'REQUEST')
    if (error?.name === 'AbortError') return cancelled()
    // Keep the existing numeric-code contract, but read untrusted properties
    // once so the value validated is exactly the value reconstructed.
    const code = error?.code
    if (Number.isInteger(code) && code !== 0 && code >= -0x80000000 && code <= 0x7fffffff) return new WindowsRpcError(code)
  } catch {}
  return invalidPage('REQUEST')
}

/**
 * Validates an observed service page, without mutating prior identity sets.
 * totalNum/curBegin are actual-service fields, not recovered native parser fields.
 * Every raw row must map for this complete-collection adapter; native row parsing
 * separately permits skipped rows. No sort/index semantics are inferred.
 */
export function decodeWindowsAlbumSongPage(data, { albumMid, begin, num,
  seenIds = new Set(), seenMids = new Set() } = {}) {
  if (!MID(albumMid) || !count(begin) || !Number.isInteger(num) || num < 1 || num > 100 ||
    !(seenIds instanceof Set) || !(seenMids instanceof Set)) throw invalidPage('INPUT')
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.songList)) {
    throw invalidPage('SHAPE')
  }
  if (data.albumMid !== albumMid) throw invalidPage('ALBUM')
  if (!count(data.totalNum) || !count(data.curBegin) || data.curBegin !== begin) throw invalidPage('CURSOR')
  const total = data.totalNum
  const rawRows = data.songList.length
  if (rawRows > num || begin < total && rawRows > total - begin || begin >= total && rawRows !== 0) {
    throw invalidPage('COUNT')
  }
  if (begin < total && rawRows === 0) throw invalidPage('PROGRESS')
  const tracks = mapWindowsAlbumSongList(data)
  if (tracks.length !== rawRows) throw invalidPage('TRACK')
  const ids = new Set(seenIds), mids = new Set(seenMids)
  const songIds = [], songMids = []
  for (const track of tracks) {
    let identity
    try { identity = windowsSongReference(track.id) } catch { throw invalidPage('TRACK') }
    if (ids.has(identity.songid) || mids.has(identity.songmid)) throw invalidPage('IDENTITY')
    ids.add(identity.songid)
    mids.add(identity.songmid)
    songIds.push(identity.songid)
    songMids.push(identity.songmid)
  }
  const nextOffset = begin + rawRows
  return { tracks, total, rawRows, nextOffset, hasMore: nextOffset < total,
    songIds, songMids }
}

/** Successful bounded whole-album read; failure never returns a partial collection. */
export async function fetchWindowsAlbumTracks({ client, album, signal,
  pageSize = WINDOWS_ALBUM_PAGING_POLICY.pageSize } = {}) {
  const seenIds = new Set(), seenMids = new Set(), tracks = []
  let begin = 0, total = null, rawRows = 0
  try {
    if (typeof client?.request !== 'function' || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw invalidPage('INPUT')
    }
    let reference
    try { reference = windowsAlbumReference(album) } catch { throw invalidPage('ALBUM') }
    for (let pageNumber = 0; pageNumber < WINDOWS_ALBUM_PAGING_POLICY.maxPages; pageNumber++) {
      check(signal)
      const call = buildWindowsAlbumSongListCall({ albumMid: reference.albumMid,
        albumId: Number(reference.albumId), begin, num: pageSize, order: WINDOWS_ALBUM_PAGING_POLICY.order })
      const data = await client.request(WINDOWS_ALBUM_SONG_LIST_REQUEST_KEY, call, { signal })
      check(signal)
      const page = decodeWindowsAlbumSongPage(data, { albumMid: reference.albumMid, begin,
        num: pageSize, seenIds, seenMids })
      if (total !== null && page.total !== total) throw invalidPage('TOTAL_CHANGED')
      total = page.total
      if (total > WINDOWS_ALBUM_PAGING_POLICY.maxRawRows || rawRows + page.rawRows > WINDOWS_ALBUM_PAGING_POLICY.maxRawRows) {
        throw invalidPage('LIMIT')
      }
      rawRows += page.rawRows
      for (const id of page.songIds) seenIds.add(id)
      for (const mid of page.songMids) seenMids.add(mid)
      tracks.push(...page.tracks)
      if (!page.hasMore) { check(signal); return tracks }
      begin = page.nextOffset
    }
    throw invalidPage('LIMIT')
  } catch (error) {
    throw normalizedError(error, signal)
  }
}
