export const WINDOWS_ADD_FAVORITE_SONG_REQUEST_KEY = 'music.musicasset.PlaylistDetailWrite.AddSonglist'
export const WINDOWS_REMOVE_FAVORITE_SONG_REQUEST_KEY = 'music.musicasset.PlaylistDetailWrite.DelSonglist'
export const WINDOWS_FAVORITE_SONG_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  addProducer: '0x100f7fcf',
  addEvidenceId: 'ev_8091b34df696fc59d637a4f2296f1f241368040f1f61c12965b80091cca77476',
  removeProducer: '0x100d6d9f',
  removeEvidenceId: 'ev_03bfd91ee07df16a5d186a49d561c1dc85242f52458b735e9e59ed3fecd36dca',
  serializer: '0x100f7a52',
  serializerEvidenceId: 'ev_20f37ebb53ab7d973978548dcba23a2cc512d8b4203247910f8c4ae63ba6bf96',
  keySplitter: '0x100760cf',
  keySplitterEvidenceId: 'ev_6d706f0930695d977c3bf16e58dc67eacca72892fe64b236e761c3b3e65487df',
  envelope: '0x1007573c',
  envelopeEvidenceId: 'ev_56404d2666501b670b5ec36164aea6e46258521cd7bf92b1bda17b8a03437a53',
  responseDecoder: '0x100f7098',
  responseEvidenceId: 'ev_9d0ccbcdb37b08d74e00c6bde07d018ce2d89306a26f27cf45af6d95035de00d'
})

function decimal(value, max, field) {
  if (typeof value !== 'string' || value.length > 20 || !/^\d+$/.test(value)) {
    throw new TypeError(`${field} must be a bounded decimal string`)
  }
  const integer = BigInt(value)
  if (integer > max) throw new RangeError(`${field} is outside its native integer range`)
  return integer.toString()
}

function directoryName(value) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !value.isWellFormed()) {
    throw new TypeError('directoryName must be bounded text')
  }
  return value
}

/**
 * The native Add/Del producers share one serializer. The adapter supports only
 * its numeric normal-song branch, taking the already resolved server song type
 * rather than reproducing native ClientSongType conversion. Directory 201 is
 * adapter scope; the caller must bind its name/tid to the current session's
 * verified liked directory before dispatch. Session ownership is not a wire
 * field, and this pure builder performs no lookup, network write or retry.
 */
export function buildWindowsFavoriteSongCall({ dirid, disstid, directoryName: name,
  songId, songType, liked } = {}) {
  const dir = decimal(dirid, 0xffffffffn, 'dirid')
  if (dir !== '201') throw new RangeError('Only the verified liked directory is supported')
  const tid = decimal(disstid, 0xffffffffffffffffn, 'disstid')
  const id = decimal(songId, 0xffffffffn, 'songId')
  if (id === '0') throw new RangeError('songId must identify a server song')
  if (songType !== 0) throw new RangeError('This song type does not support favorite changes')
  if (typeof liked !== 'boolean') throw new TypeError('liked must be a boolean')
  if (typeof JSON.rawJSON !== 'function') {
    throw new Error('Windows protocol requires a runtime supporting JSON.rawJSON')
  }
  return {
    module: 'music.musicasset.PlaylistDetailWrite', method: liked ? 'AddSonglist' : 'DelSonglist',
    param: { dirId: Number(dir), dirName: directoryName(name), tid: JSON.rawJSON(tid),
      bFmtUtf8: true, v_songInfo: [{ songType, songId: Number(id) }] }
  }
}

function invalidResponse() { throw new Error('QQ 音乐收藏响应无效') }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function responseDecimal(value, max) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  try { return decimal(source, max, 'response identity') } catch { invalidResponse() }
}
function uint32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) invalidResponse()
  return value
}

/**
 * WindowsMusicClient already checks the outer and operation business codes.
 * The recovered Add decoder reads data.result and maps songlist rows by loc;
 * this single-song adapter requires one matching row, rejecting partial or
 * unrelated replies instead of committing native's zero/default result slots.
 * The native Del branch reads only data.msg and supplies no membership proof.
 * Neither branch confirms current liked state: the caller must reread dir201.
 */
export function decodeWindowsFavoriteSongResponse(data, { dirid, disstid, songId,
  songType, liked } = {}) {
  const dir = decimal(dirid, 0xffffffffn, 'dirid')
  const tid = decimal(disstid, 0xffffffffffffffffn, 'disstid')
  const id = decimal(songId, 0xffffffffn, 'songId')
  if (dir !== '201' || id === '0' || songType !== 0 || typeof liked !== 'boolean') {
    throw new TypeError('Favorite response requires a supported request identity')
  }
  if (!object(data) || typeof data.msg !== 'string' || data.msg.length > 4096 ||
      data.msg.includes('\0') || !data.msg.isWellFormed()) invalidResponse()
  if (!liked) {
    // Some Del replies carry no result at all. Reject conflicting identities
    // when supplied, without fabricating a missing native acknowledgement.
    if (data.result !== undefined && data.result !== null) {
      if (!object(data.result)) invalidResponse()
      if (Object.hasOwn(data.result, 'dirId') && responseDecimal(data.result.dirId, 0xffffffffn) !== dir) invalidResponse()
      if (Object.hasOwn(data.result, 'tid') && responseDecimal(data.result.tid, 0xffffffffffffffffn) !== tid) invalidResponse()
    }
    return { refreshRequired: true }
  }
  const result = data.result
  if (!object(result) || responseDecimal(result.dirId, 0xffffffffn) !== dir ||
      responseDecimal(result.tid, 0xffffffffffffffffn) !== tid ||
      !Array.isArray(result.songlist) || result.songlist.length !== 1) invalidResponse()
  const updateTime = uint32(result.updateTime)
  const row = result.songlist[0]
  if (!object(row) || row.loc !== 0 || row.songType !== songType ||
      String(uint32(row.backendSongId)) !== id) invalidResponse()
  return { refreshRequired: true, updateTime }
}
