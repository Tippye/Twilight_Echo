// QQMusicResource.dll JSON/2009 config -> official wk_v20 musicroom route ->
// current pinned module620 J loader. These are embedded-web shapes, not native
// C++ producers. WindowsMusicClient ct19/cv2271 transport compatibility was
// accepted in Root's saved real Home RPC shape receipt. Shared web transport
// module490 was outside the static asset boundary; no browser defaults copied.
import { mapWindowsTrack, windowsSongMedia, windowsSongReference } from './tracks.mjs'
import { mapWindowsPlaylist } from './search-catalog.mjs'
import { WindowsRpcError } from './response.mjs'
import { nativeSigned64 } from './json-integer.mjs'
import { resolveWindowsPlaylistBinding } from './playlist-binding.mjs'
import { createWindowsPlaylistReference, windowsPlaylistReference } from './playlist-data.mjs'

export const WINDOWS_EMBEDDED_HOME_PROVENANCE = Object.freeze({
  kind: 'windows-configured-embedded-web',
  artifact: 'QQMusicResource.dll',
  artifactSha256: 'f635b213a60fad43f46dd8c49c913904420a4f9f480be952984955ccc2186e89',
  resource: 'JSON/2009/2052',
  resourceSha256: 'fc58467fa8900c227f514a063fe90240301cc6e55f72e3776934024b78050da7',
  configuredPage: 'https://i2.y.qq.com/n3/wk_v20/entry/index/musicroom/recommend',
  consumerModule: 620,
  assetSha256: '16fd3b01c23cc97921988d260a20c0135801976527fe974529c6be0c94d981c4',
  nativeClientTransport: 'compatibility-accepted-public-home-rpc',
  realServiceEvidence: 'qq-home-real-response-shapes.json'
})
export const WINDOWS_EMBEDDED_DAILY_PROVENANCE = Object.freeze({
  kind: 'windows-configured-embedded-web', consumerModule: 609,
  assetSha256: '0688ab8f5f08b9a7575fb926aa512cbff9711f111266e3d9542d9cf95fbb16e9',
  sourceSelectorShelfId: 301, observedNativeCt19ShelfId: 201,
  realServiceEvidence: 'qq-daily-native-variant-real-detail.json'
})

// Full module.method outer keys belong to the existing native-client adapter;
// this source excerpt establishes module/method/param, not a wire envelope.
export const WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY = 'playlist.HotRecommendServer.get_new_hot_recommend'
export const WINDOWS_LATEST_RELEASE_SONGS_REQUEST_KEY = 'newsong.NewSongServer.get_new_song_info'
export const WINDOWS_RECOMMEND_FEED_REQUEST_KEY = 'music.recommend.RecommendFeed.get_recommend_feed'
export const WINDOWS_DAILY_DISS_REQUEST_KEY = 'music.srfDissInfo.aiDissInfo.uniform_get_Dissinfo'

/** One exact initial official-playlist request; no pagination or daily meaning inferred. */
export function buildWindowsOfficialPlaylistRecommendCall() {
  return { module: 'playlist.HotRecommendServer', method: 'get_new_hot_recommend',
    param: { cmd: 0, page: 0, daily_page: 0, size: 12 } }
}

/**
 * Source 最新发行 consumes songlist through an album-card converter. Root's
 * selected provider presentation uses those songs as 最新发行歌曲 previews
 * after actual SongInfo schema validation. This is not a Daily request.
 */
export function buildWindowsLatestReleaseSongsCall() {
  return { module: 'newsong.NewSongServer', method: 'get_new_song_info', param: { type: 5 } }
}

/** Exact module609 Ht -> m(1,0) initial feed body, with fresh owned arrays. */
export function buildWindowsRecommendFeedCall() {
  return { module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed',
    param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 } }
}

/**
 * Module609 v body; replace source parseInt with an exact signed64 JSON number.
 * Zero is allowed only when the caller actually supplies it, never as a default.
 * guid32 is the existing adapter device input, not an original QQ GUID read.
 */
export function buildWindowsDailyDissCall({ disstid, guid } = {}) {
  if (typeof guid !== 'string' || !/^[A-Fa-f0-9]{32}$/.test(guid)) throw invalid('GUID')
  return { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo',
    param: { disstid: nativeSigned64(exactDisstid(disstid)), userinfo: 1, tag: 1, guid } }
}

// Source Y previews the first20 releases as album cards. The approved provider
// presentation previews their songs instead. Validate every returned record,
// then take20; this is a preview, not a silently truncated complete catalogue.
export const WINDOWS_LATEST_RELEASE_PREVIEW_POLICY = Object.freeze({
  previewSize: 20, maxRawRows: 1000, validation: 'all-returned-rows'
})
// Observed ct19 root-grids guard, not a recovered source/native enum definition.
export const WINDOWS_RECOMMENDED_PLAYLIST_POLICY = Object.freeze({ maximum: 12, observedType: 10014 })
// Source selector remains301. Root directly observed this ct19 variant and
// verified its unique known-title card through a complete aiDissInfo response.
// This201 is a feed shelf kind; it does not change liked-directory201 handling.
export const WINDOWS_DAILY_FEED_POLICY = Object.freeze({ shelfId: 201, title: '每日30首',
  maxShelves: 100, maxFirstNicheCards: 1000, maxSongs: 1000 })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const boundedText = value => typeof value === 'string' && value.length <= 4096 &&
  !value.includes('\0') && value.isWellFormed()
const validationCodes = new Set(['GUID', 'ID', 'STATUS', 'SHAPE', 'TRACK', 'IDENTITY',
  'INPUT', 'REQUEST', 'GRID', 'FEED', 'DAILY_SELECTOR', 'DISS', 'COUNT', 'MORE'])
const ownedValidationCodes = new WeakMap()
class WindowsHomeResponseError extends Error {
  constructor(code) {
    super('QQ 音乐首页数据无法验证')
    this.name = 'WindowsHomeResponseError'
    this.code = validationCodes.has(code) ? code : 'REQUEST'
    ownedValidationCodes.set(this, this.code)
  }
}
const invalid = code => new WindowsHomeResponseError(code)
function cancelled() {
  const error = new Error('QQ 音乐首页加载已取消')
  error.name = 'AbortError'
  return error
}
function check(signal) { if (signal?.aborted) throw cancelled() }
function normalizedError(error, signal) {
  // Even error properties can be external getters. Keep normalization itself
  // inside this boundary so an arbitrary thrown value cannot leak its message.
  try {
    if (signal?.aborted) return cancelled()
    // Public decoders can expose an owned Error to a caller. Its public
    // message/code can be mutated or replaced with getters before rethrowing.
    if (error instanceof WindowsHomeResponseError) return invalid(ownedValidationCodes.get(error) ?? 'REQUEST')
    if (error?.name === 'AbortError') return cancelled()
    if (error instanceof WindowsRpcError) {
      const code = error.code
      if (Number.isInteger(code) && code !== 0 && code >= -0x80000000 && code <= 0x7fffffff) return new WindowsRpcError(code)
    }
  } catch {}
  return invalid('REQUEST')
}
async function deviceInput(getDevice, signal) {
  check(signal)
  if (!signal) return getDevice()
  let onAbort
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(cancelled())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    // Cancellation stops this leaf from starting Diss even when a local device
    // lookup is still pending. The existing device owner retains its promise.
    const pending = Promise.resolve().then(() => { check(signal); return getDevice() })
    return await Promise.race([pending, aborted])
  } finally { signal.removeEventListener('abort', onAbort) }
}
function exactDisstid(value) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || source.length === 0 || source.length > 20 || !/^-?\d+$/.test(source)) throw invalid('ID')
  try { return nativeSigned64(source).rawJSON } catch { throw invalid('ID') }
}
function status(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw invalid('STATUS')
  if (value !== 0) throw new WindowsRpcError(value)
}
function mappedSongs(rows, { maximum, allowUnsupported = false }) {
  if (!Array.isArray(rows) || rows.length > maximum) throw invalid('SHAPE')
  const ids = new Set(), mids = new Set()
  return Array.from(rows, song => {
    if (!object(song) || !boundedText(song.title)) throw invalid('TRACK')
    const track = mapWindowsTrack(song)
    let songid, songmid
    try {
      if (!track) throw invalid('TRACK')
      if (allowUnsupported && track.playbackStatus === 'unsupported') {
        songid = track.id.split(':')[3]
      } else {
        const identity = windowsSongReference(track)
        windowsSongMedia(song)
        songid = identity.songid; songmid = identity.songmid
      }
    } catch { throw invalid('TRACK') }
    if (ids.has(songid) || songmid !== undefined && mids.has(songmid)) throw invalid('IDENTITY')
    ids.add(songid)
    if (songmid !== undefined) mids.add(songmid)
    return track
  })
}

async function request({ client, key, call, signal, decode }) {
  try {
    check(signal)
    if (typeof client?.request !== 'function') throw invalid('INPUT')
    const data = await client.request(key, call, { signal })
    check(signal)
    return decode(data)
  } catch (error) {
    throw normalizedError(error, signal)
  }
}

/** Real ct19 response songlist path; normal media and both identities are required. */
export function decodeWindowsLatestReleaseSongs(data) {
  if (!object(data) || !Array.isArray(data.songlist) ||
      data.songlist.length > WINDOWS_LATEST_RELEASE_PREVIEW_POLICY.maxRawRows) throw invalid('SHAPE')
  const tracks = mappedSongs(data.songlist, { maximum: WINDOWS_LATEST_RELEASE_PREVIEW_POLICY.maxRawRows })
  return tracks.slice(0, WINDOWS_LATEST_RELEASE_PREVIEW_POLICY.previewSize)
}

/** One exact source request, generic private errors, no retry or pagination. */
export async function fetchWindowsLatestReleaseSongs({ client, signal } = {}) {
  return request({ client, key: WINDOWS_LATEST_RELEASE_SONGS_REQUEST_KEY,
    call: buildWindowsLatestReleaseSongsCall(), signal, decode: decodeWindowsLatestReleaseSongs })
}

/**
 * Selected fields from the actual ct19 data.grids variant; the
 * saved embedded consumer instead used modules[0].grids. No container fallback
 * is introduced. type10014 and ordinary no-song/no-Vip branch are observed
 * guards. Root verified one actual creator0/tid through strict NativeDetail;
 * other references still pass the existing detail identity guard when opened.
 * listeners is not invented as trackCount.
 */
export function mapWindowsRecommendedPlaylistCandidate(record) {
  if (!object(record) || !object(record.creator) || typeof record.creator.uin !== 'string' ||
      record.type !== WINDOWS_RECOMMENDED_PLAYLIST_POLICY.observedType || record.song || record.isVip ||
      !boundedText(record.title) || !boundedText(record.picurl) || !boundedText(record.creator.nick)) return null
  // Source creator is candidate metadata only. Reuse the canonical helper for
  // lossless scalar validation, never publish this source pair as a native ref.
  let source
  try { source = windowsPlaylistReference(createWindowsPlaylistReference({ hostUin: record.creator.uin, disstid: record.id })) }
  catch { return null }
  if (BigInt(source.disstid) <= 0n || record.title.trim().length === 0) return null
  return { disstid: source.disstid, sourceCreatorUin: source.hostUin,
    title: record.title, picurl: record.picurl, creatorName: record.creator.nick }
}

/** Initial recommendation preview only; no discovery/curated-public/Daily semantics inferred. */
export function decodeWindowsRecommendedPlaylistCandidates(data) {
  if (!object(data) || !Array.isArray(data.grids) || data.grids.length > WINDOWS_RECOMMENDED_PLAYLIST_POLICY.maximum) throw invalid('SHAPE')
  const seen = new Set()
  return Array.from(data.grids, row => {
    const candidate = mapWindowsRecommendedPlaylistCandidate(row)
    if (!candidate) throw invalid('GRID')
    if (seen.has(candidate.disstid)) throw invalid('IDENTITY')
    seen.add(candidate.disstid)
    return candidate
  })
}
export async function fetchWindowsRecommendPlaylists({ client, loginUin, signal } = {}) {
  const candidates = await request({ client, key: WINDOWS_OFFICIAL_PLAYLIST_RECOMMEND_REQUEST_KEY,
    call: buildWindowsOfficialPlaylistRecommendCall(), signal, decode: decodeWindowsRecommendedPlaylistCandidates })
  const summaries = []
  try { for (const candidate of candidates) {
    check(signal)
    // At most12 sequential one-attempt lookups. Root owns the verified login
    // and whole-read epoch; source creator UIN is not this request's native host.
    const binding = await resolveWindowsPlaylistBinding({ client, loginUin, disstid: candidate.disstid, signal })
    check(signal)
    const reference = windowsPlaylistReference(binding.playlistId)
    const summary = mapWindowsPlaylist({ dissid: reference.disstid,
      creator: { creator_uin: reference.hostUin, name: candidate.creatorName },
      dissname: candidate.title, imgurl: candidate.picurl, song_count: binding.detail.total })
    if (!summary || summary.id !== binding.playlistId) throw invalid('GRID')
    summaries.push(summary)
  } } catch (error) { throw normalizedError(error, signal) }
  return summaries
}

/** Exact native ct19 selector, with no source301/other shelf/title fallback. */
export function decodeWindowsDailyFeed(data) {
  if (!object(data)) throw invalid('FEED')
  status(data.retcode)
  if (!Array.isArray(data.v_shelf) || data.v_shelf.length > WINDOWS_DAILY_FEED_POLICY.maxShelves) throw invalid('FEED')
  const shelves = Array.from(data.v_shelf)
  if (shelves.some(shelf => !object(shelf))) throw invalid('FEED')
  const matches = shelves.filter(shelf => shelf.id === WINDOWS_DAILY_FEED_POLICY.shelfId)
  if (matches.length !== 1 || !Array.isArray(matches[0].v_niche) || !object(matches[0].v_niche[0]) ||
      !Array.isArray(matches[0].v_niche[0].v_card)) throw invalid('DAILY_SELECTOR')
  const cards = Array.from(matches[0].v_niche[0].v_card)
  if (cards.length > WINDOWS_DAILY_FEED_POLICY.maxFirstNicheCards || cards.some(card => !object(card))) throw invalid('FEED')
  const daily = cards.filter(card => card.title === WINDOWS_DAILY_FEED_POLICY.title)
  if (daily.length !== 1) throw invalid('DAILY_SELECTOR')
  const disstid = exactDisstid(daily[0].id)
  if (BigInt(disstid) < 0n) throw invalid('ID')
  return { disstid }
}

/** Daily is only Track[]; no publisher-host or playlist reference is manufactured. */
export function decodeWindowsDailySongs(data, { disstid } = {}) {
  const expected = exactDisstid(disstid)
  if (!object(data)) throw invalid('DISS')
  status(data.code); status(data.subcode)
  if (!object(data.dirinfo) || exactDisstid(data.dirinfo.id) !== expected) throw invalid('ID')
  if (!Number.isSafeInteger(data.total_song_num) || data.total_song_num < 0 ||
      !Number.isSafeInteger(data.dirinfo.songnum) || data.dirinfo.songnum !== data.total_song_num ||
      !Array.isArray(data.songlist) || data.songlist.length !== data.total_song_num) throw invalid('COUNT')
  if (data.hasmore !== 0) throw invalid('MORE')
  return mappedSongs(data.songlist, { maximum: WINDOWS_DAILY_FEED_POLICY.maxSongs, allowUnsupported: true })
}

/** Root's verified-data owner guards the whole two-phase read, including account changes. */
export async function fetchWindowsDailySongs({ client, getDevice, signal } = {}) {
  const selected = await request({ client, key: WINDOWS_RECOMMEND_FEED_REQUEST_KEY,
    call: buildWindowsRecommendFeedCall(), signal, decode: decodeWindowsDailyFeed })
  try {
    check(signal)
    if (typeof getDevice !== 'function') throw invalid('GUID')
    const device = await deviceInput(getDevice, signal)
    check(signal)
    const call = buildWindowsDailyDissCall({ disstid: selected.disstid, guid: device?.guid })
    return await request({ client, key: WINDOWS_DAILY_DISS_REQUEST_KEY, call, signal,
      decode: data => decodeWindowsDailySongs(data, selected) })
  } catch (error) {
    throw normalizedError(error, signal)
  }
}
