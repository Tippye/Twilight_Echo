import { nativeSigned64 } from './json-integer.mjs'

export const WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY = 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo'
export const WINDOWS_USER_PLAYLISTS_REQUEST_KEY = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin'
// The native favorite producer uses its module name as the outer request key.
export const WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY = 'music.musicasset.PlaylistFavRead'
export const WINDOWS_PLAYLIST_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  detailProducer: '0x1005cb06',
  detailEvidenceId: 'ev_09daa7b7d181601e15033864b132df9cb7fad0bff4420e4571da80d2c0d6ac86',
  userProducer: '0x1005e1a1',
  userEvidenceId: 'ev_e2aef1c4ad22ce16602da678184a6764ced8917a353f36756a6ad80e4f7805dd',
  favoriteProducer: '0x1005e2b7',
  favoriteEvidenceId: 'ev_de8f3a57aa61cd7eb474d241903e8f16cb423dbc1750879056b32b3bde71f6e6'
})

function decimal(value, signed, field) {
  // The string-only API and input size bound are adapter policy for lossless IDs.
  if (typeof value !== 'string' || value.length > 20 ||
      !(signed ? /^-?\d+$/ : /^\d+$/).test(value)) {
    throw new TypeError(`${field} must be a bounded decimal string`)
  }
  const integer = BigInt(value)
  const min = signed ? -0x8000000000000000n : 0n
  const max = signed ? 0x7fffffffffffffffn : 0xffffffffffffffffn
  if (integer < min || integer > max) throw new RangeError(`${field} is outside its native integer range`)
  return integer.toString()
}

function unsignedJson(value) {
  if (typeof JSON.rawJSON !== 'function') {
    throw new Error('Windows protocol requires a runtime supporting JSON.rawJSON')
  }
  return JSON.rawJSON(value)
}

/**
 * Native detail producer takes only the first caller record. Its zero-flag
 * branch emits dirid and uses the current session for both UIN fields; the
 * other branch omits dirid and obtains host_uin from that record. This API
 * accepts already resolved IDs, without reconstructing native record parsers.
 * No pagination or caller defaults are established by this producer.
 */
export function buildWindowsPlaylistDetailCall({ loginUin, hostUin, disstid, dirid } = {}) {
  const login = decimal(loginUin, false, 'loginUin')
  const host = decimal(hostUin, false, 'hostUin')
  const diss = decimal(disstid, true, 'disstid')
  const directory = dirid === undefined ? undefined : decimal(dirid, false, 'dirid')
  if (directory !== undefined && host !== login) {
    throw new TypeError('Native directory requests require the session UIN as hostUin')
  }
  const param = { login_uin: unsignedJson(login) }
  if (directory !== undefined) param.dirid = unsignedJson(directory)
  param.host_uin = unsignedJson(host)
  param.disstid = nativeSigned64(diss)
  return { module: 'music.srfDissInfo.DissInfoForPc', method: 'uniform_get_Dissinfo', param }
}

/**
 * The recovered caller always uses its current session UIN, then calls a
 * separate favorites producer. Arbitrary-user access and combined created /
 * favorite response decoding are not established. No account access occurs here.
 */
export function buildWindowsUserPlaylistsCall({ uin } = {}) {
  return {
    module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin',
    param: { uin: decimal(uin, false, 'uin') }
  }
}

/**
 * Native user-list retrieval unconditionally dispatches this separate request.
 * Its only field is the current session UIN formatted as a JSON string. Caller
 * must supply the already verified current-session musicid; arbitrary-user
 * access, favorite response decoding and pagination are not established here.
 */
export function buildWindowsFavoritePlaylistsCall({ uin } = {}) {
  return {
    module: 'music.musicasset.PlaylistFavRead', method: 'GetPlaylistFavInfo',
    param: { uin: decimal(uin, false, 'uin') }
  }
}
