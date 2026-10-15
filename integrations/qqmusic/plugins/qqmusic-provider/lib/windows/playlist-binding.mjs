import { buildWindowsPlaylistDetailCall, WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY } from './playlist-call.mjs'
import { createWindowsPlaylistReference, windowsPlaylistReference, decodeWindowsPlaylistDetail } from './playlist-data.mjs'
import { WindowsRpcError } from './response.mjs'

// Explicit adapter lookup policy accepted in Root's dev31 feed/category/search
// probes. Both request UIN fields use the caller's already verified login UIN.
// Publisher/profile UIN fields are not native host references. Only actual
// response host_uin, bound to creator.musicid and requested tid, produces a ref.
export const WINDOWS_PLAYLIST_BINDING_PROVENANCE = Object.freeze({
  lookupPolicy: 'verified-login-as-public-lookup-host',
  evidence: 'qq-public-playlist-owned-lookup-native-bindings.json',
  identityPolicy: 'response-id-and-host-creator-musicid-binding',
  directoryPolicy: 'unchanged-existing-decoder'
})
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const codes = new Set(['INPUT', 'LOGIN', 'ID', 'RESPONSE', 'HOST', 'INCOMPLETE', 'REQUEST'])
const ownedCodes = new WeakMap()
class WindowsPlaylistBindingError extends Error {
  constructor(code) {
    super('QQ 音乐歌单来源无法验证')
    this.name = 'WindowsPlaylistBindingError'
    this.code = codes.has(code) ? code : 'REQUEST'
    ownedCodes.set(this, this.code)
  }
}
const invalid = code => new WindowsPlaylistBindingError(code)
function aborted() {
  const error = new Error('QQ 音乐歌单来源加载已取消')
  error.name = 'AbortError'
  return error
}
function check(signal) { if (signal?.aborted) throw aborted() }
function normalizedError(error, signal) {
  try {
    if (signal?.aborted) return aborted()
    if (error instanceof WindowsPlaylistBindingError) return invalid(ownedCodes.get(error) ?? 'REQUEST')
    if (error?.name === 'AbortError') return aborted()
    if (error instanceof WindowsRpcError) {
      const code = error.code
      if (Number.isInteger(code) && code !== 0 && code >= -0x80000000 && code <= 0x7fffffff) return new WindowsRpcError(code)
    }
  } catch {}
  return invalid('REQUEST')
}
function reference(hostUin, disstid) {
  try { return windowsPlaylistReference(createWindowsPlaylistReference({ hostUin, disstid })) }
  catch { throw invalid('ID') }
}
function success(code) {
  if (!Number.isInteger(code) || code < -0x80000000 || code > 0x7fffffff) throw invalid('RESPONSE')
  if (code !== 0) throw new WindowsRpcError(code)
}

/**
 * Bind an explicitly supplied external-catalog tid through one native lookup.
 * This leaf has no session/device/cache owner or retry, and never publishes raw
 * response/account metadata. Root guards the whole caller read's account epoch.
 */
export async function resolveWindowsPlaylistBinding({ client, loginUin, disstid, signal } = {}) {
  try {
    check(signal)
    if (typeof client?.request !== 'function') throw invalid('INPUT')
    const requested = reference(loginUin, disstid)
    if (BigInt(requested.hostUin) === 0n) throw invalid('LOGIN')
    const call = buildWindowsPlaylistDetailCall({ loginUin: requested.hostUin,
      hostUin: requested.hostUin, disstid: requested.disstid })
    const data = await client.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, call, { signal })
    check(signal)
    if (!object(data)) throw invalid('RESPONSE')
    // Snapshot critical untrusted DTO fields once. The existing strict decoder
    // receives an owned projection of those bound values, with no dirid branch.
    const code = data.code, subcode = data.subcode
    success(code); success(subcode)
    const directory = data.dirinfo
    if (!object(directory)) throw invalid('RESPONSE')
    const creator = directory.creator
    if (!object(creator)) throw invalid('HOST')
    const actual = reference(directory.host_uin, directory.id)
    const creatorRef = reference(creator.musicid, requested.disstid)
    if (actual.disstid !== requested.disstid) throw invalid('ID')
    if (actual.hostUin !== creatorRef.hostUin) throw invalid('HOST')
    const playlistId = createWindowsPlaylistReference(actual)
    const detail = decodeWindowsPlaylistDetail({ code, subcode,
      dirinfo: { id: actual.disstid, host_uin: actual.hostUin },
      songlist: data.songlist, total_song_num: data.total_song_num }, { playlistId })
    if (!detail.complete) throw invalid('INCOMPLETE')
    check(signal)
    return { playlistId, detail }
  } catch (error) { throw normalizedError(error, signal) }
}
