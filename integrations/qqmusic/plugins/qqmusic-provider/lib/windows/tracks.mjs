// Public Windows desktop search DTO observed in qq-windows-anonymous-song-dto-probe.json.
// Native TrackInfo accepts UInt32 IDs. Persist both IDs in the SDK's retained string ID.
import { WINDOWS_QUALITY_OPTIONS, windowsQualityCandidates, windowsQualityDefinition, windowsQualityMetadataSize } from './quality.mjs'
const MID = { test: value => typeof value === 'string' && value.length === 14 && /^[a-zA-Z0-9]+$/.test(value) }
const decimal = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  ? String(value) : typeof value === 'string' && value.length > 0 && !/[^0-9]/.test(value) ? value : null
const text = value => typeof value === 'string' && !value.includes('\0') ? value.trim() : ''
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
const nativeId = value => {
  const id = decimal(value)
  return id !== null && BigInt(id) > 0n && BigInt(id) <= 0xffffffffn ? BigInt(id).toString() : null
}
const boundedText = value => typeof value === 'string' && value.length <= 4096 &&
  !value.includes('\0') && value.isWellFormed()
const safeCount = value => Number.isSafeInteger(value) && value >= 0
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const boundedNativeId = value => typeof value === 'string' && value.length > 20 ? null : nativeId(value)

/** The only observed empty-MID record branch; no deleted/rights cause is inferred. */
export function isUnsupportedWindowsSong(song) {
  return object(song) && song.type === 21 && song.data_type === 0 && song.mid === '' &&
    object(song.file) && song.file.media_mid === '' && boundedNativeId(song.id) !== null &&
    boundedText(song.title) && song.title.trim().length > 0 && boundedText(song.name) &&
    safeCount(song.interval) && object(song.album) && boundedText(song.album.title) && boundedText(song.album.name) &&
    Array.isArray(song.singer) && song.singer.length <= 1000 && Array.from(song.singer).every(singer =>
      object(singer) && boundedText(singer.name) && singer.name.trim().length > 0) &&
    ['size_128mp3', 'size_320mp3', 'size_192ogg', 'size_flac'].every(field => safeCount(song.file[field]))
}

const unsupportedPlayback = () => { throw new Error('当前音源尚不支持该记录') }

export function windowsSongReference(track) {
  if (track?.playbackStatus === 'unsupported') unsupportedPlayback()
  const id = typeof track === 'string' ? track : track?.id
  const parts = typeof id === 'string' ? id.split(':') : []
  if (parts.length === 4 && parts[0] === 'qq' && parts[1] === 'native' && parts[2] === '21' &&
      parts[3].length <= 10 && nativeId(parts[3]) !== null && nativeId(parts[3]) === parts[3]) unsupportedPlayback()
  if (parts.length !== 3 || parts[0] !== 'qq' || !MID.test(parts[1]) || nativeId(parts[2]) === null) {
    throw new Error('QQ 音乐歌曲标识无效')
  }
  return { songmid: parts[1], songid: nativeId(parts[2]) }
}
export const windowsSongMid = track => windowsSongReference(track).songmid

export function mapWindowsTrack(song) {
  const unsupported = isUnsupportedWindowsSong(song)
  if (!unsupported && (!song || !MID.test(song.mid ?? '') || !text(song.title) || nativeId(song.id) === null)) return null
  const artists = Array.isArray(song.singer) ? song.singer.map(singer => ({
    id: MID.test(singer?.mid ?? '') && nativeId(singer?.id) !== null
      ? `qq:artist:${singer.mid}:${nativeId(singer.id)}` : undefined,
    name: text(singer?.name)
  })).filter(artist => artist.name) : []
  const id = unsupported ? `qq:native:21:${nativeId(song.id)}` : `qq:${song.mid}:${nativeId(song.id)}`
  const title = text(song.title)
  const albumMid = MID.test(song.album?.mid ?? '') ? song.album.mid : null
  return {
    id, title, artist: artists.map(artist => artist.name).join(' / ') || '未知艺术家',
    artists: artists.length ? artists : undefined, album: text(song.album?.title),
    albumId: albumMid && nativeId(song.album?.id) !== null
      ? `qq:album:${albumMid}:${nativeId(song.album.id)}` : undefined,
    filePath: id, fileName: title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') + (unsupported ? '' : '.mp3'),
    duration: count(song.interval), size: count(song.file?.size_128mp3),
    cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null,
    lyrics: null, translatedLyrics: null, source: 'qq', streamUrl: null,
    ...(unsupported ? { playbackStatus: 'unsupported' } : {})
  }
}

export function windowsSongMedia(song) {
  if (isUnsupportedWindowsSong(song)) unsupportedPlayback()
  if (!song || !MID.test(song.mid) || nativeId(song.id) === null || !MID.test(song.file?.media_mid) ||
    !Number.isInteger(song.type) || song.type < -0x80000000 || song.type > 0x7fffffff) {
    throw new Error('QQ 音乐歌曲详情缺少媒体信息')
  }
  return { songmid: song.mid, songid: nativeId(song.id), mediaMid: song.file.media_mid,
    songtype: Number.isInteger(song.type) ? song.type : 0,
    sizes: { ...Object.fromEntries(WINDOWS_QUALITY_OPTIONS.map(option =>
      [windowsQualityDefinition(option.value).sizeKey, windowsQualityMetadataSize(song.file, option.value)])),
      ogg_192: count(song.file.size_192ogg) },
    title: text(song.name), singerName: Array.isArray(song.singer)
      ? song.singer.map(singer => text(singer?.name)).filter(Boolean).join('/') : '',
    albumName: text(song.album?.name), interval: count(song.interval) }
}

export function windowsTrackPlaybackQualities(song) {
  const media = windowsSongMedia(song)
  return { trackId: `qq:${media.songmid}:${media.songid}`, options: windowsQualityCandidates(song.file) }
}

/** Provider policy for SDK offset pagination, independent of native enum mapping. */
export function windowsSearchWindow(limit, offset) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    throw new Error('QQ 音乐搜索分页参数无效')
  }
  const pageSize = Math.min(limit, 60)
  return { pageSize, page: Math.floor(offset / pageSize) + 1, skip: offset % pageSize, limit }
}

export function windowsSearchPage(data) {
  if (!data || !Array.isArray(data.body?.song?.list) || !Number.isSafeInteger(data.meta?.sum) || data.meta.sum < 0) {
    throw new Error('QQ 音乐搜索结果无效')
  }
  return { songs: data.body.song.list, total: data.meta.sum }
}
