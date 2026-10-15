import { buildWindowsDesktopSearchCall, WINDOWS_DESKTOP_SEARCH_REQUEST_KEY } from './search-call.mjs'
import { windowsSearchWindow } from './tracks.mjs'
import { createWindowsPlaylistReference, windowsPlaylistReference } from './playlist-data.mjs'
import { WindowsRpcError } from './response.mjs'

export { windowsPlaylistReference } from './playlist-data.mjs'

// Native UI enum -> wire value: singer9->1, album8->2, playlist200->3.
// Hash-pinned Main click-label switch and Protocol map are recorded in
// qq-search-catalog-enum-labels.json; authenticated field types are recorded in
// qq-real-search-catalog-shapes.json. Anonymous requests returned2001 (verification).
export const WINDOWS_CATALOG_SEARCH_TYPES = Object.freeze({ artist: 1, album: 2, playlist: 3 })
const U32_MAX = 0xffffffffn
const U64_MAX = 0xffffffffffffffffn
const I64_MAX = 0x7fffffffffffffffn
const MID = value => typeof value === 'string' && value.length === 14 && /^[A-Za-z0-9]+$/.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length <= 4096 &&
  !value.includes('\0') && value.isWellFormed() ? value.trim() : ''
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : undefined

function nativeDecimal(value, maximum, minimum = 1n) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || source.length === 0 || source.length > 20 || /[^0-9]/.test(source)) return null
  const integer = BigInt(source)
  return integer >= minimum && integer <= maximum ? integer.toString() : null
}

function artwork(value) {
  const source = text(value)
  if (!source) return null
  try {
    const url = new URL(source)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password
      ? source : null
  } catch { return null }
}

// Date conversion is SDK display policy. Only exact ISO calendar dates convert;
// the recovered producer returns publicTime as a string, without an epoch unit.
function publishTime(value) {
  const source = text(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return undefined
  const time = Date.parse(`${source}T00:00:00.000Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === source ? time : undefined
}

function catalogId(kind, mid, value) {
  const id = nativeDecimal(value, U32_MAX)
  return MID(mid) && id !== null ? `qq:${kind}:${mid}:${id}` : null
}

function reference(value, kind) {
  const id = typeof value === 'string' ? value : value?.id
  const parts = typeof id === 'string' ? id.split(':') : []
  if (parts.length !== 4 || parts[0] !== 'qq' || parts[1] !== kind || catalogId(kind, parts[2], parts[3]) !== id) {
    throw new Error('QQ 音乐目录标识无效')
  }
  return { mid: parts[2], id: parts[3] }
}

export function windowsArtistReference(value) {
  const result = reference(value, 'artist')
  return { singerMid: result.mid, singerId: result.id }
}

export function windowsAlbumReference(value) {
  const result = reference(value, 'album')
  return { albumMid: result.mid, albumId: result.id }
}

export function mapWindowsArtist(record) {
  if (!object(record)) return null
  const id = catalogId('artist', record.singerMID, record.singerID)
  const name = text(record.singerName)
  const musicSize = count(record.songNum), albumSize = count(record.albumNum)
  return id && name ? { id, name, cover: artwork(record.singerPic),
    ...(musicSize === undefined ? {} : { musicSize }),
    ...(albumSize === undefined ? {} : { albumSize }) } : null
}

export function mapWindowsAlbum(record) {
  if (!object(record)) return null
  const id = catalogId('album', record.albumMID, record.albumID)
  const name = text(record.albumName)
  if (!id || !name) return null
  const artists = Array.isArray(record.singer_list) ? record.singer_list.map(singer => text(singer?.name)).filter(Boolean) : []
  return { id, name, artist: artists.join(' / ') || text(record.singerName) || undefined,
    cover: artwork(record.albumPic), trackCount: count(record.song_count), publishTime: publishTime(record.publicTime) }
}

/** Public songlist search DTO only; created-directory DTOs have their own owner. */
export function mapWindowsPlaylist(record) {
  if (!object(record)) return null
  // Zero is retained only when actually supplied in the UInt64 field; missing
  // identity never substitutes an anonymous owner.
  const hostUin = nativeDecimal(record.creator?.creator_uin, U64_MAX, 0n)
  const disstid = nativeDecimal(record.dissid, I64_MAX)
  const name = text(record.dissname)
  if (hostUin === null || disstid === null || !name) return null
  return { id: createWindowsPlaylistReference({ hostUin, disstid }), name,
    cover: artwork(record.imgurl), trackCount: count(record.song_count),
    creatorName: text(record.creator?.name) || undefined }
}

const CATALOG = Object.freeze({
  artist: { container: 'singer', map: mapWindowsArtist },
  album: { container: 'album', map: mapWindowsAlbum },
  playlist: { container: 'songlist', map: mapWindowsPlaylist }
})

function category(kind) {
  if (!Object.hasOwn(CATALOG, kind)) throw new Error('QQ 音乐搜索类别无效')
  return CATALOG[kind]
}

export function windowsCatalogSearchPage(data, kind) {
  const { container } = category(kind)
  if (object(data) && Object.hasOwn(data, 'code') && data.code !== 0) {
    if (Number.isSafeInteger(data.code)) throw new WindowsRpcError(data.code)
    throw new Error('QQ 音乐搜索结果无效')
  }
  if (!object(data) || !Array.isArray(data.body?.[container]?.list) ||
      !Number.isSafeInteger(data.meta?.sum) || data.meta.sum < 0) {
    throw new Error('QQ 音乐搜索结果无效')
  }
  return { records: data.body[container].list, total: data.meta.sum }
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('QQ 音乐搜索已取消')
    error.name = 'AbortError'
    throw error
  }
}

/**
 * SDK offset policy reuses the song window. Invalid DTOs consume their original
 * slots; they cannot trigger unbounded refill queries. Callers own searchId.
 * remoteplace is an explicitly accepted adapter placement, not a native default.
 */
export async function searchWindowsCatalog({ client, kind, query, limit = 30, offset = 0,
  signal, searchId, remoteplace = 'pc.button.search.song' } = {}) {
  const { map } = category(kind)
  const keywords = text(query)
  if (!keywords || keywords.length > 256) throw new Error('请输入有效的搜索关键词')
  if (!client || typeof client.request !== 'function') throw new TypeError('QQ 音乐搜索客户端无效')
  const window = windowsSearchWindow(limit, offset)
  const items = []
  let total = 0
  const pages = Math.ceil((window.skip + window.limit) / window.pageSize)
  for (let index = 0; index < pages && items.length < window.limit; index++) {
    checkAbort(signal)
    const page = window.page + index
    const call = buildWindowsDesktopSearchCall({ query: keywords, pageNum: page, numPerPage: window.pageSize,
      searchType: WINDOWS_CATALOG_SEARCH_TYPES[kind], searchId, remoteplace })
    const data = await client.request(WINDOWS_DESKTOP_SEARCH_REQUEST_KEY, call, { signal })
    checkAbort(signal)
    const response = windowsCatalogSearchPage(data, kind)
    total = response.total
    const rows = response.records.slice(0, window.pageSize)
    // The raw slot bound prevents invalid rows from pulling later offset items
    // into this requested window even when further precomputed pages exist.
    const skip = index === 0 ? window.skip : 0
    const remainingSlots = window.limit - (index * window.pageSize - window.skip + skip)
    for (const record of rows.slice(skip, skip + remainingSlots)) {
      const item = map(record)
      if (item) items.push(item)
    }
    if (rows.length < window.pageSize || (page - 1) * window.pageSize + rows.length >= total) break
  }
  return { items, total }
}
