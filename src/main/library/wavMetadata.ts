import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import iconv from 'iconv-lite'

/** Metadata recovered from RIFF/WAVE INFO or Broadcast Wave chunks. */
export type WaveMetadata = {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: string
  trackNumber?: number
  duration?: number
  sampleRate?: number
  bitDepth?: number
  bitrate?: number
  codec?: string
}

type WaveInfoTagKey = 'title' | 'artist' | 'album' | 'genre' | 'year' | 'trackNumber'

const WAVE_EXTENSIONS = new Set(['.wav', '.wave', '.bwf'])
const WAVE_CONTAINERS = new Set(['RIFF', 'RF64', 'BW64'])
const RIFF_SIZE_PLACEHOLDER = 0xffffffff
const MAX_TEXT_BYTES = 4096
const INFO_ALIASES = new Map<string, WaveInfoTagKey>([
  ['IART', 'artist'],
  ['INAM', 'title'],
  ['TITL', 'title'],
  ['IPRD', 'album'],
  ['IRPD', 'album'],
  ['IGNR', 'genre'],
  ['GNRE', 'genre'],
  ['ICRD', 'year'],
  ['IYEAR', 'year'],
  ['YEAR', 'year'],
  ['ITRK', 'trackNumber'],
  ['IPRT', 'trackNumber']
])

const TEXT_ENCODINGS = [
  'utf-8',
  'gb18030',
  'gbk',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'big5',
  'windows-1252'
] as const
const MOJIBAKE_ENCODINGS = [
  'latin1',
  'win1250',
  'win1251',
  'win1252',
  'win1253',
  'win1254',
  'win1255',
  'win1256',
  'win1257',
  'win1258',
  'windows-874',
  'koi8-r',
  'koi8-u',
  'gb18030',
  'gbk',
  'big5',
  'shift_jis',
  'euc-jp',
  'cp949'
] as const
const LEGACY_BYTE_ENCODINGS = ['gb18030', 'gbk', 'big5', 'shift_jis', 'euc-jp', 'cp949'] as const
const JAPANESE_KANA = /[\u3040-\u30ff]/u
const JAPANESE_KANA_GLOBAL = /[\u3040-\u30ff]/gu
const KOREAN_GLOBAL = /[\uac00-\ud7af]/gu
const SUSPICIOUS_MOJIBAKE =
  /(?:[\u00c0-\u00ff]{2,}|[\u00c2-\u00f4][\u0080-\u00bf]|[\u00c3\u00c2][\u0080-\u00ffA-Za-z]|[\u93c4\u71b7\u5a07\u9287\u958e\u59b5\u7d0b]{2,}|\u{fffd}|\?{2,})/u
const SCRIPT_MOJIBAKE =
  /(?:(?:[\u0420\u0421][\u0400-\u04ff\u00a0-\u00ff]){2,}|(?:[\u0637\u0638][\u0600-\u06ff\u00a0-\u00ff\u2026]){2,})/u
const MOJIBAKE_FRAGMENTS = [
  '\u00c3',
  '\u00c2',
  '\u00d0',
  '\u00d1',
  '\u00d2',
  '\u00d3',
  '\u00c5',
  '\u00c6',
  '\u00c7',
  '\u00c8',
  '\u00c9',
  '\u00ca',
  '\u00cb',
  '\u9287',
  '\u9288',
  '\u93c4',
  '\u71b7',
  '\u59b5',
  '\u958e',
  '\u7d0b',
  '\u{fffd}'
]

function stripTrailingNulls(buffer: Buffer): Buffer {
  let end = buffer.length
  while (end > 0 && buffer[end - 1] === 0) end -= 1
  return buffer.subarray(0, end)
}

function stripTrailingUtf16Nulls(buffer: Buffer): Buffer {
  let end = buffer.length
  while (end >= 2 && buffer[end - 1] === 0 && buffer[end - 2] === 0) end -= 2
  return buffer.subarray(0, end)
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length
}

function countControls(text: string): number {
  let count = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      (codePoint <= 0x1f && ![9, 10, 13].includes(codePoint)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    )
      count += 1
  }
  return count
}

function cleanText(value: string): string | null {
  const text = value
    // eslint-disable-next-line no-control-regex -- RIFF text fields are NUL/control padded.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!text || text.length > 512 || countControls(text) > 0) return null
  return text
}

function textQualityScore(text: string): number {
  let score = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (character === '\uFFFD') {
      score -= 40
    } else if (
      (codePoint < 32 && ![9, 10, 13].includes(codePoint)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      score -= 25
    } else if (
      (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7af)
    ) {
      score += 4
    } else if (codePoint >= 0x20 && codePoint <= 0x7e) {
      score += 1
    } else {
      score += 0.5
    }
  }
  score -= countMatches(text, /[\uFFFD?]/gu) * 18
  score -= countControls(text) * 20
  score -=
    countMatches(
      text,
      /(?:[\u00c2-\u00f4][\u0080-\u00bf]|[\u00c3\u00c2][\u0080-\u00ffA-Za-z]|\u00e2[\u0080-\u00ff]{1,2})/gu
    ) * 12
  for (const fragment of MOJIBAKE_FRAGMENTS) score -= text.split(fragment).length - 1
  return score
}

function preferHigherQualityText(primary: string | null, candidate: string | null): string | null {
  if (!candidate) return primary
  if (!primary) return candidate
  const candidateBytes = Buffer.from(candidate, 'utf8')
  const primaryIsLegacyDecoded = MOJIBAKE_ENCODINGS.some((encoding) => {
    try {
      return iconv.decode(candidateBytes, encoding).trim() === primary
    } catch {
      return false
    }
  })
  if (primaryIsLegacyDecoded) return candidate
  return textQualityScore(candidate) >= textQualityScore(primary) + 4 ? candidate : primary
}

/** Repair text returned by parsers after legacy bytes were decoded as the wrong code page. */
export function repairMojibakeText(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const characters = Array.from(trimmed)
  const legacyByteCount = characters.filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 0x80 && codePoint <= 0xff
  }).length
  const suspiciousLegacyBytes =
    legacyByteCount >= 4 &&
    (legacyByteCount / Math.max(1, characters.length) >= 0.3 ||
      /[\u0080-\u00ff]{4,}/u.test(trimmed))
  const suspicious =
    SUSPICIOUS_MOJIBAKE.test(trimmed) ||
    SCRIPT_MOJIBAKE.test(trimmed) ||
    countMatches(trimmed, /[\u0100-\u017f]/gu) >= 4 ||
    suspiciousLegacyBytes
  if (!suspicious) return trimmed

  const originalLength = characters.length
  const candidates: Array<{ text: string; score: number; compression: number }> = []
  for (const encoding of MOJIBAKE_ENCODINGS) {
    try {
      const decoded = iconv.decode(iconv.encode(trimmed, encoding), 'utf8').trim()
      if (!decoded || decoded === trimmed) continue
      const roundTrips =
        !decoded.includes('\uFFFD') &&
        iconv.decode(Buffer.from(decoded, 'utf8'), encoding).trim() === trimmed
      const decodedLength = Array.from(decoded).length
      const compression =
        roundTrips && decodedLength <= originalLength * 0.75 ? originalLength - decodedLength : 0
      candidates.push({
        text: decoded,
        score: textQualityScore(decoded) + compression * 2,
        compression
      })
    } catch {
      // Ignore unsupported or invalid candidate encodings.
    }
  }

  if (suspiciousLegacyBytes) {
    const legacyBytes = iconv.encode(trimmed, 'latin1')
    let gbkHasKana = false
    try {
      gbkHasKana = JAPANESE_KANA.test(iconv.decode(legacyBytes, 'gbk'))
    } catch {
      // Ignore invalid GBK candidates.
    }
    for (const encoding of LEGACY_BYTE_ENCODINGS) {
      try {
        const decoded = iconv.decode(legacyBytes, encoding).trim()
        if (
          !decoded ||
          decoded === trimmed ||
          decoded.includes('\uFFFD') ||
          !iconv.encode(decoded, encoding).equals(legacyBytes)
        )
          continue
        const decodedLength = Array.from(decoded).length
        const compression =
          decodedLength <= originalLength * 0.75 ? originalLength - decodedLength : 0
        const kanaCount = countMatches(decoded, JAPANESE_KANA_GLOBAL)
        const koreanCount = countMatches(decoded, KOREAN_GLOBAL)
        const scriptBonus =
          (encoding === 'shift_jis' || encoding === 'euc-jp') && kanaCount >= 2
            ? 12
            : encoding === 'cp949' && koreanCount >= 2 && !gbkHasKana
              ? 12
              : 0
        candidates.push({
          text: decoded,
          score: textQualityScore(decoded) + compression * 2 + scriptBonus,
          compression
        })
      } catch {
        // Ignore unsupported or invalid legacy candidates.
      }
    }
  }

  const originalScore = textQualityScore(trimmed)
  candidates.sort((left, right) => right.score - left.score)
  const best = candidates[0]
  return best && (suspicious || best.compression >= 3) && best.score >= originalScore + 4
    ? best.text
    : trimmed
}

/** Decode an unmarked RIFF INFO/BEXT text field without changing valid UTF-8 text. */
export function decodeWaveText(rawValue: Buffer): string | null {
  const utf16Data = stripTrailingUtf16Nulls(rawValue)
  const data = stripTrailingNulls(rawValue)
  if (!data.length) return null
  const hasLeBom = utf16Data.length >= 2 && utf16Data[0] === 0xff && utf16Data[1] === 0xfe
  const hasBeBom = utf16Data.length >= 2 && utf16Data[0] === 0xfe && utf16Data[1] === 0xff
  if (hasLeBom || hasBeBom) {
    const decoded = cleanText(
      new TextDecoder(hasLeBom ? 'utf-16le' : 'utf-16be').decode(utf16Data.subarray(2))
    )
    if (decoded) return decoded
  }

  const evenNulls = utf16Data.filter((byte, index) => index % 2 === 0 && byte === 0).length
  const oddNulls = utf16Data.filter((byte, index) => index % 2 === 1 && byte === 0).length
  const likelyUtf16 =
    utf16Data.length >= 4 &&
    Math.max(evenNulls, oddNulls) >= 2 &&
    Math.max(evenNulls, oddNulls) / Math.max(1, Math.floor(utf16Data.length / 2)) >= 0.3
  if (likelyUtf16) {
    const preferred = oddNulls >= evenNulls ? 'utf-16le' : 'utf-16be'
    const decoded = cleanText(new TextDecoder(preferred).decode(utf16Data))
    if (decoded) return decoded
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(data)
    const utf8 = countControls(decoded) === 0 ? cleanText(decoded) : null
    if (utf8 && !SUSPICIOUS_MOJIBAKE.test(utf8)) return utf8
  } catch {
    // Legacy WAV files often omit the text encoding marker.
  }

  const candidates = TEXT_ENCODINGS.flatMap((encoding, index) => {
    try {
      const decoded =
        encoding === 'utf-8' || encoding === 'iso-2022-jp'
          ? new TextDecoder(encoding).decode(data)
          : iconv.decode(data, encoding === 'windows-1252' ? 'win1252' : encoding)
      if (countControls(decoded) > 0) return []
      const text = cleanText(decoded)
      if (!text) return []
      const japaneseBonus =
        (encoding === 'shift_jis' || encoding === 'euc-jp' || encoding === 'iso-2022-jp') &&
        JAPANESE_KANA.test(text) &&
        !text.includes('\uFFFD')
          ? 2
          : 0
      return [{ text, score: textQualityScore(text) + japaneseBonus, priority: -index }]
    } catch {
      return []
    }
  })
  candidates.sort((left, right) => right.score - left.score || right.priority - left.priority)
  return candidates[0]?.text ?? null
}

// Keep the source module's terminology available to callers that distinguish INFO text from
// the broader RIFF/WAVE container reader.
export const decodeWaveInfoText = decodeWaveText

function safeUInt64LeToNumber(buffer: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 8 > buffer.length) return null
  const value = buffer.readBigUInt64LE(offset)
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}

function readDs64Sizes(data: Buffer): Map<string, number> {
  const sizes = new Map<string, number>()
  if (data.length < 28) return sizes
  const dataSize = safeUInt64LeToNumber(data, 8)
  if (dataSize !== null) sizes.set('data', dataSize)
  const tableLength = data.readUInt32LE(24)
  for (
    let index = 0, offset = 28;
    index < tableLength && offset + 12 <= data.length;
    index += 1, offset += 12
  ) {
    const chunkId = data.toString('ascii', offset, offset + 4)
    const chunkSize = safeUInt64LeToNumber(data, offset + 4)
    if (chunkSize !== null) sizes.set(chunkId, chunkSize)
  }
  return sizes
}

function resolvedSize(chunkId: string, value: number, sizes: Map<string, number>): number | null {
  return value === RIFF_SIZE_PLACEHOLDER ? (sizes.get(chunkId) ?? null) : value
}

function parseNumber(value: string): number | undefined {
  const match = value.trim().match(/^\d+/)
  if (!match) return undefined
  const number = Number(match[0])
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function readBextText(data: Buffer, offset: number, length: number): string | undefined {
  if (data.length <= offset) return undefined
  return decodeWaveText(data.subarray(offset, Math.min(data.length, offset + length))) ?? undefined
}

/** Read RIFF INFO, BEXT, RF64 and BW64 metadata using bounded random reads. */
export async function readWaveMetadata(filePath: string): Promise<WaveMetadata | null> {
  if (!WAVE_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
  const file = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(12)
    const headerRead = await file.read(header, 0, header.length, 0)
    if (
      headerRead.bytesRead < 12 ||
      !WAVE_CONTAINERS.has(header.toString('ascii', 0, 4)) ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    )
      return null
    const fileSize = (await file.stat()).size
    const metadata: WaveMetadata = {}
    const bextMetadata: WaveMetadata = {}
    const ds64Sizes = new Map<string, number>()
    let dataBytes: number | undefined
    let byteRate: number | undefined
    let position = 12
    while (position + 8 <= fileSize) {
      const chunkHeader = Buffer.alloc(8)
      const chunkRead = await file.read(chunkHeader, 0, 8, position)
      if (chunkRead.bytesRead < 8) break
      const chunkId = chunkHeader.toString('ascii', 0, 4)
      const size = resolvedSize(chunkId, chunkHeader.readUInt32LE(4), ds64Sizes)
      if (size === null || size < 0 || position + 8 > fileSize) break
      const dataPosition = position + 8
      const boundedSize = Math.min(size, Math.max(0, fileSize - dataPosition))

      if (chunkId === 'ds64' && boundedSize >= 28 && boundedSize <= 1024 * 1024) {
        const data = Buffer.alloc(boundedSize)
        if ((await file.read(data, 0, data.length, dataPosition)).bytesRead === data.length) {
          for (const [id, value] of readDs64Sizes(data)) ds64Sizes.set(id, value)
        }
      } else if (chunkId === 'fmt ' && boundedSize >= 16) {
        const data = Buffer.alloc(Math.min(boundedSize, 64))
        if ((await file.read(data, 0, data.length, dataPosition)).bytesRead === data.length) {
          const format = data.readUInt16LE(0)
          metadata.sampleRate = data.readUInt32LE(4) || undefined
          byteRate = data.readUInt32LE(8) || undefined
          metadata.bitDepth = data.readUInt16LE(14) || undefined
          metadata.bitrate = byteRate ? byteRate * 8 : undefined
          metadata.codec =
            format === 1
              ? 'PCM'
              : format === 3
                ? 'IEEE_FLOAT'
                : format === 0xfffe
                  ? 'WAVE_FORMAT_EXTENSIBLE'
                  : `WAVE_FORMAT_${format.toString(16).toUpperCase()}`
        }
      } else if (chunkId === 'data') {
        dataBytes = size
      } else if (chunkId === 'bext' && boundedSize > 0) {
        const data = Buffer.alloc(Math.min(boundedSize, 602))
        if ((await file.read(data, 0, data.length, dataPosition)).bytesRead === data.length) {
          bextMetadata.title = readBextText(data, 0, 256)
          bextMetadata.artist = readBextText(data, 256, 32)
          bextMetadata.year = readBextText(data, 320, 10)
        }
      } else if (chunkId === 'LIST' && boundedSize >= 4) {
        const listType = Buffer.alloc(4)
        if (
          (await file.read(listType, 0, 4, dataPosition)).bytesRead === 4 &&
          listType.toString('ascii') === 'INFO'
        ) {
          let infoPosition = dataPosition + 4
          const infoEnd = Math.min(dataPosition + size, fileSize)
          while (infoPosition + 8 <= infoEnd) {
            const infoHeader = Buffer.alloc(8)
            if ((await file.read(infoHeader, 0, 8, infoPosition)).bytesRead < 8) break
            const infoId = infoHeader.toString('ascii', 0, 4)
            const infoSize = resolvedSize(infoId, infoHeader.readUInt32LE(4), ds64Sizes)
            if (infoSize === null || infoSize < 0 || infoPosition + 8 + infoSize > infoEnd) break
            const key = INFO_ALIASES.get(infoId)
            if (key && infoSize > 0 && infoSize <= MAX_TEXT_BYTES) {
              const value = Buffer.alloc(infoSize)
              if (
                (await file.read(value, 0, value.length, infoPosition + 8)).bytesRead ===
                value.length
              ) {
                const decoded = decodeWaveText(value)
                if (decoded) {
                  const current = metadata[key] === undefined ? null : String(metadata[key])
                  const selected = preferHigherQualityText(current, decoded)
                  if (selected) {
                    if (key === 'trackNumber') metadata.trackNumber = parseNumber(selected)
                    else metadata[key] = selected
                  }
                }
              }
            }
            infoPosition += 8 + infoSize + (infoSize % 2)
          }
        }
      }
      position += 8 + size + (size % 2)
    }
    if (metadata.title === undefined && bextMetadata.title) metadata.title = bextMetadata.title
    if (metadata.artist === undefined && bextMetadata.artist) metadata.artist = bextMetadata.artist
    if (metadata.year === undefined && bextMetadata.year) metadata.year = bextMetadata.year
    if (metadata.duration === undefined && dataBytes !== undefined && byteRate)
      metadata.duration = dataBytes / byteRate
    return Object.keys(metadata).length ? metadata : null
  } finally {
    await file.close()
  }
}

/** Merge parser text with RIFF text, preferring the value that has stronger encoding evidence. */
export function chooseWaveText(
  primary: unknown,
  waveValue: string | undefined
): string | undefined {
  const primaryText = typeof primary === 'string' ? repairMojibakeText(primary) : undefined
  return preferHigherQualityText(primaryText ?? null, waveValue ?? null) ?? undefined
}
