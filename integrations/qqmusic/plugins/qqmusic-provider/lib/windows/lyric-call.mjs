export const WINDOWS_PLAY_LYRIC_REQUEST_KEY = 'music.musichallSong.PlayLyricInfo.GetPlayLyricInfo'
export const WINDOWS_PLAY_LYRIC_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  producer: '0x1002d750',
  evidenceId: 'ev_2ff28628a4c4562bdb278b14f5e8a7c86da6d030a67202b4bb7ed2764f546a93',
  nameEncoder: 'QQMusicCommon.dll:0x1004a57d',
  nameEncoderSha256: '4267e1c27f7251a31460613a97f5787fd7d9d0be3664e5e615251aba2780471f',
  nameEncoderEvidenceId: 'ev_5658504914121bd7068136cd2731f5c7a0d7b6c509ed479fc3e6bbd18b371267',
  responseContract: 'Anonymous Windows mode0: crypt0/qrc0, Base64 UTF8 lyric and empty trans/roma; enhanced cipher not recovered'
})

function integer(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} is outside its native integer range`)
  }
  return value
}
const int32 = (value, field) => integer(value, -0x80000000, 0x7fffffff, field)
function name(value, field) {
  // Resource and well-formed Unicode checks are adapter policy.
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !value.isWellFormed()) {
    throw new TypeError(`${field} must be bounded text`)
  }
  return Buffer.from(value, 'utf8').toString('base64')
}

/**
 * Wire type is the server song type; callers provide the matching song type.
 * requestMode is caller-supplied; no default is inferred.
 * Zero timestamps mean a cold request by adapter policy, not native caller defaults.
 */
export function buildWindowsPlayLyricInfoCall({ songID, songName, singerName, albumName,
  interval, type, requestMode, lrc_t = 0, qrc_t = 0, trans_t = 0, roma_t = 0 } = {}) {
  const mode = int32(requestMode, 'requestMode')
  const enhanced = mode === 0 || mode === 3 ? 0 : 1
  return {
    module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo',
    param: {
      songID: integer(songID, 0, 0xffffffff, 'songID'),
      songName: name(songName, 'songName'), singerName: name(singerName, 'singerName'),
      albumName: name(albumName, 'albumName'), qrc: enhanced, trans: enhanced, roma: enhanced,
      lrc_t: int32(lrc_t, 'lrc_t'), qrc_t: int32(qrc_t, 'qrc_t'),
      trans_t: int32(trans_t, 'trans_t'), roma_t: int32(roma_t, 'roma_t'),
      interval: int32(interval, 'interval'), type: int32(type, 'type'),
      crypt: enhanced, ct: 19, cv: 2271
    }
  }
}

const MAX_ENCODED_TEXT = 4 * 1024 * 1024 // Adapter resource bound, not a native field limit.
function decodeText(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > MAX_ENCODED_TEXT ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('QQ 音乐歌词响应无效')
  }
  const bytes = Buffer.from(value, 'base64')
  try {
    const canonical = bytes.toString('base64')
    if (canonical.replace(/=+$/, '') !== value.replace(/=+$/, '') ||
        (value.includes('=') && canonical !== value)) throw new Error('Invalid encoding')
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (text.includes('\0')) throw new Error('Invalid text')
    return text
  } catch {
    throw new Error('QQ 音乐歌词响应无效')
  } finally {
    bytes.fill(0)
  }
}

/** Decode only the independently observed plaintext Windows response branch. */
export function decodeWindowsPlayLyricResponse(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('QQ 音乐歌词响应无效')
  if (data.crypt !== 0 || data.qrc !== 0) throw new Error('QQ 音乐增强歌词解码尚未恢复')
  return { lyrics: decodeText(data.lyric), translatedLyrics: decodeText(data.trans), wordLyrics: null }
}
