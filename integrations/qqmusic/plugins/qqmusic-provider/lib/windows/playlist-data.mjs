import { mapWindowsTrack, windowsSongMedia } from './tracks.mjs'

const U64_MAX = 0xffffffffffffffffn
const I64_MIN = -0x8000000000000000n
const I64_MAX = 0x7fffffffffffffffn
const MAX_PLAYLISTS = 10000 // Adapter resource limit, not a recovered native limit.
const MAX_TRACKS = 100000

function invalid() { throw new Error('QQ 音乐歌单数据无效') }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function decimal(value, signed = false) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || source.length > 20 ||
      !(signed ? /^-?\d+$/ : /^\d+$/).test(source)) invalid()
  const integer = BigInt(source)
  if (integer < (signed ? I64_MIN : 0n) || integer > (signed ? I64_MAX : U64_MAX)) invalid()
  return integer.toString()
}
function text(value, nonempty = false) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !value.isWellFormed()) invalid()
  const result = value.trim()
  if (nonempty && result.length === 0) invalid()
  return result
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid()
  return value
}
function cover(value) {
  const source = text(value)
  if (source === '') return null
  let url
  try { url = new URL(source) } catch { invalid() }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid()
  return source
}

/**
 * Public-list references contain host and tid. Directory references also retain
 * dirid, selecting the native current-session directory request branch. The
 * SDK retains string IDs; no additional metadata persistence is required.
 */
export function createWindowsPlaylistReference({ hostUin, disstid, dirid } = {}) {
  const parts = ['qq', 'playlist', decimal(hostUin), decimal(disstid, true)]
  if (dirid !== undefined) parts.push(decimal(dirid))
  return parts.join(':')
}

export function windowsPlaylistReference(playlist) {
  const id = typeof playlist === 'string' ? playlist : playlist?.id
  if (typeof id !== 'string' || id.length > 80) invalid()
  const parts = id.split(':')
  if ((parts.length !== 4 && parts.length !== 5) || parts[0] !== 'qq' || parts[1] !== 'playlist') invalid()
  const result = { hostUin: decimal(parts[2]), disstid: decimal(parts[3], true) }
  if (parts.length === 5) result.dirid = decimal(parts[4])
  // Reject alternate spellings so queue/library identity remains stable.
  if (createWindowsPlaylistReference(result) !== id) invalid()
  return result
}

/** Map only the observed GetPlaylistByUin created-directory DTO. */
export function mapCreatedWindowsPlaylist(record, { sessionUin } = {}) {
  if (!object(record)) invalid()
  const owner = decimal(sessionUin)
  // The real response emits uin as a string. Numeric IDs may instead be decimal
  // strings after the client's lossless parser preserves unsafe JSON integers.
  if (typeof record.uin !== 'string' || decimal(record.uin) !== owner) invalid()
  const id = createWindowsPlaylistReference({ hostUin: owner, disstid: record.tid, dirid: record.dirId })
  if (record.dirId === undefined) invalid()
  const large = cover(record.bigpicUrl)
  const small = cover(record.picUrl)
  return { id, name: text(record.dirName, true), cover: large ?? small,
    trackCount: count(record.songNum), creatorName: text(record.nick), owned: true }
}

/**
 * bFinish is returned explicitly, because this producer has no proven paging
 * input. Nonempty deletion records are outside the observed initial snapshot
 * contract. Default liked-folder/status/opType meanings are not inferred.
 */
export function decodeWindowsCreatedPlaylists(data, { sessionUin } = {}) {
  if (!object(data) || !Array.isArray(data.v_playlist) || data.v_playlist.length > MAX_PLAYLISTS ||
      !Array.isArray(data.v_delTid) || data.v_delTid.length !== 0 || typeof data.bFinish !== 'boolean') invalid()
  const total = count(data.total)
  if (total < data.v_playlist.length) invalid()
  const owner = decimal(sessionUin)
  const playlists = Array.from(data.v_playlist, record => mapCreatedWindowsPlaylist(record, { sessionUin: owner }))
  const ids = new Set(playlists.map(playlist => playlist.id))
  if (ids.size !== playlists.length) invalid()
  return { playlists, total, finished: data.bFinish }
}

function favoriteFields(record, allowBlankOwner = false) {
  if (!object(record) || typeof record.uin !== 'string') invalid()
  const owner = allowBlankOwner && record.uin === '' ? null : decimal(record.uin)
  return { owner, disstid: decimal(record.tid, true), name: text(record.name, true),
    cover: cover(record.logo), trackCount: count(record.songnum), creatorName: text(record.nickname) }
}

function favoriteSummary(fields, current) {
  return { id: createWindowsPlaylistReference({ hostUin: fields.owner, disstid: fields.disstid }),
    name: fields.name, cover: fields.cover, trackCount: fields.trackCount,
    creatorName: fields.creatorName, owned: fields.owner === current }
}

/** Favorites preserve the creator's host UIN; their dirId is not the caller's directory branch. */
export function mapFavoriteWindowsPlaylist(record, { sessionUin } = {}) {
  const current = decimal(sessionUin)
  return favoriteSummary(favoriteFields(record), current)
}

/**
 * Tombstones are returned as native tid values, without deleting or merging
 * records. Their scope/ordering and the full-snapshot versus delta contract are
 * not recovered. The observed failure list is empty; unknown entries reject.
 * visibleOnly is an explicit adapter display policy, not a recovered native
 * getter: validate every row first, then expose only dirShow1, or no rows when
 * the server hides the entire favorites collection. Hidden empty owners never
 * acquire a fabricated identity. Native counts are retained; whole-collection
 * hide reports the server total as hiddenCount, including unreturned rows.
 */
export function decodeWindowsFavoritePlaylists(data, { sessionUin, visibleOnly = false } = {}) {
  if (!object(data) || !Array.isArray(data.v_list) || data.v_list.length > MAX_PLAYLISTS ||
      !Array.isArray(data.v_delTids) || data.v_delTids.length > MAX_PLAYLISTS ||
      !Array.isArray(data.v_failTids) || data.v_failTids.length !== 0 ||
      (data.hasmore !== 0 && data.hasmore !== 1) || typeof data.hide !== 'boolean' ||
      typeof visibleOnly !== 'boolean') invalid()
  const current = decimal(sessionUin)
  const total = count(data.total)
  const reportedCount = count(data.number)
  let playlists
  let hiddenCount
  if (visibleOnly) {
    const rows = Array.from(data.v_list, record => {
      if (!object(record) || (record.dirShow !== 0 && record.dirShow !== 1)) invalid()
      return { fields: favoriteFields(record, record.dirShow === 0), shown: record.dirShow === 1 }
    })
    // Unknown-owner records can be checked for repeated tid values without
    // assigning them a public playlist ID or equating them to another owner.
    const identities = rows.map(({ fields }) => JSON.stringify([fields.owner, fields.disstid]))
    if (new Set(identities).size !== rows.length) invalid()
    playlists = rows.filter(row => row.shown).map(row => favoriteSummary(row.fields, current))
    hiddenCount = rows.length - playlists.length
    if (data.hide) { playlists = []; hiddenCount = total }
  } else {
    playlists = Array.from(data.v_list, record => mapFavoriteWindowsPlaylist(record, { sessionUin: current }))
    if (new Set(playlists.map(playlist => playlist.id)).size !== playlists.length) invalid()
  }
  const deletedTids = Array.from(data.v_delTids, tid => decimal(tid, true))
  if (new Set(deletedTids).size !== deletedTids.length) invalid()
  return { playlists, total, reportedCount, hasMore: data.hasmore === 1, hidden: data.hide, deletedTids,
    ...(visibleOnly ? { hiddenCount } : {}) }
}

function status(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) invalid()
  return value
}

function mappedSong(song) {
  if (!object(song) || !object(song.album) || !object(song.file) || !Array.isArray(song.singer) ||
      song.singer.length > 1000) invalid()
  const songid = decimal(song.id)
  if (BigInt(songid) === 0n || BigInt(songid) > 0xffffffffn) invalid()
  text(song.title, true)
  text(song.name)
  text(song.album.title)
  text(song.album.name)
  count(song.interval)
  for (const singer of song.singer) {
    if (!object(singer)) invalid()
    text(singer.name, true)
  }
  for (const field of ['size_128mp3', 'size_320mp3', 'size_192ogg', 'size_flac']) count(song.file[field])
  const track = mapWindowsTrack(song)
  if (!track) invalid()
  if (track.playbackStatus === 'unsupported') return { track, media: null }
  let media
  try { media = windowsSongMedia(song) } catch { invalid() }
  return { track, media }
}

/**
 * Decode the observed native directory-detail response. Identity is bound to
 * the requested canonical reference. Directory callers must supply the already
 * verified session UIN. Only observed directory201 permits a zero response
 * host placeholder; this is an explicit compatibility policy, not a recovered
 * general owner default or a liked-folder classifier. A larger server total
 * remains incomplete; this producer has no established paging fields.
 */
export function decodeWindowsPlaylistDetail(data, { playlistId, sessionUin } = {}) {
  if (!object(data)) invalid()
  if (status(data.code) !== 0 || status(data.subcode) !== 0) {
    // Server msg and every other private response field are intentionally unused.
    throw new Error('QQ 音乐歌单详情请求失败')
  }
  const reference = windowsPlaylistReference(playlistId)
  if (!object(data.dirinfo) || !Array.isArray(data.songlist) || data.songlist.length > MAX_TRACKS) invalid()
  if (reference.dirid !== undefined && (decimal(sessionUin) !== reference.hostUin || BigInt(reference.hostUin) === 0n)) invalid()
  if (decimal(data.dirinfo.id, true) !== reference.disstid ||
      (reference.dirid !== undefined && decimal(data.dirinfo.dirid) !== reference.dirid)) invalid()
  const actualHost = decimal(data.dirinfo.host_uin)
  const observedPlaceholder = reference.dirid === '201' && actualHost === '0'
  if (actualHost !== reference.hostUin && !observedPlaceholder) invalid()
  const total = count(data.total_song_num)
  if (total < data.songlist.length) invalid()
  const entries = Array.from(data.songlist, mappedSong)
  return { tracks: entries.map(entry => entry.track), media: entries.map(entry => entry.media),
    total, complete: data.songlist.length === total,
    unsupportedCount: entries.reduce((sum, entry) => sum + Number(entry.track.playbackStatus === 'unsupported'), 0) }
}
