import { timingSafeEqual } from 'node:crypto'
import { decodeWindowsEkey } from './ekey.mjs'

const MAGIC = Buffer.from('musicex\0', 'ascii')
const invalid = () => new Error('QQ 音乐媒体容器无效')

/** A bounded CDN tail observation, not an assertion that every CDN stream is a disk cache file. */
export function inspectWindowsMediaTail({ tail, upstreamLength, encrypted, serverEkey = '' } = {}) {
  if (!(tail instanceof Uint8Array) || tail.byteLength > 1027 ||
    typeof upstreamLength !== 'string' || !upstreamLength || /[^0-9]/.test(upstreamLength) ||
    BigInt(upstreamLength) === 0n || BigInt(upstreamLength) > 0xffffffffffffffffn ||
    BigInt(tail.byteLength) > BigInt(upstreamLength) || typeof encrypted !== 'boolean' || typeof serverEkey !== 'string') {
    throw invalid()
  }
  if (!encrypted) return { tailBytes: '0', key: null, footer: 'none' }
  const bytes = Buffer.from(tail.buffer, tail.byteOffset, tail.byteLength)
  let key = null
  let returned = false
  try {
    if (serverEkey) key = decodeWindowsEkey(serverEkey)
    if (bytes.length >= 16 && bytes.subarray(-8).equals(MAGIC)) {
      const distance = bytes.readUInt32LE(bytes.length - 16)
      const version = bytes.readUInt32LE(bytes.length - 12)
      // Only the complete canonical176+16 record has an established adapter boundary.
      // Native reads176 at EOF-distance and later trims192 even when distance differs.
      if (version !== 1 || distance !== 192 || bytes.length < 192 || BigInt(upstreamLength) <= 192n || !key) {
        throw invalid()
      }
      // ReadFileExtension requires a UTF16 filename of at least four code units
      // containing a dot; the native scratch record forces its50th unit to NUL.
      const metadata = bytes.subarray(bytes.length - 192, bytes.length - 16)
      const filename = metadata.subarray(0x48, 0xaa).toString('utf16le').split('\0', 1)[0]
      if (filename.length < 4 || !filename.includes('.')) throw invalid()
      returned = true
      return { tailBytes: '192', key, footer: 'musicex-v1' }
    }
    if (bytes.length >= 4) {
      const length = bytes.readUInt32LE(bytes.length - 4)
      if (length >= 5 && length <= 1023 && bytes.length >= length + 4 && BigInt(upstreamLength) > BigInt(length + 4)) {
        const encoded = bytes.subarray(bytes.length - 4 - length, bytes.length - 4)
        let footerKey
        try {
          if (encoded.some(value => value > 127)) throw invalid()
          footerKey = decodeWindowsEkey(encoded.toString('ascii'))
        } catch {
          // No verified footer: a server key plus a decoded codec header can still
          // establish a raw CDN stream. The disk-cache fallback is not assumed.
          footerKey = null
        }
        if (footerKey) {
          if (key && (key.length !== footerKey.length || !timingSafeEqual(key, footerKey))) {
            footerKey.fill(0)
            throw invalid()
          }
          key?.fill(0)
          key = footerKey
          returned = true
          return { tailBytes: String(length + 4), key, footer: 'length-prefixed-ekey' }
        }
      }
    }
    if (!key) throw invalid()
    returned = true
    return { tailBytes: '0', key, footer: 'none' }
  } finally {
    if (!returned) key?.fill(0)
  }
}

/** Header preflight only; actual decoding remains the host's native codec responsibility. */
export function validateWindowsAudioHeader(bytes, codec) {
  if (!(bytes instanceof Uint8Array)) throw invalid()
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let valid = false
  if (codec === 'flac') valid = b.length >= 8 && b.subarray(0, 4).toString('ascii') === 'fLaC' &&
    (b[4] & 127) === 0 && b.readUIntBE(5, 3) === 34
  if (codec === 'ogg') valid = b.length >= 27 && b.subarray(0, 4).toString('ascii') === 'OggS' && b[4] === 0
  if (codec === 'mp4') valid = b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp' && b.readUInt32BE(0) >= 12
  if (codec === 'mp3') valid = b.length >= 10 && b.subarray(0, 3).toString('ascii') === 'ID3' &&
    b[3] >= 2 && b[3] <= 4 && b.subarray(6, 10).every(value => value < 128)
  if (codec === 'mp3' && !valid) valid = b.length >= 4 && b[0] === 255 && (b[1] & 224) === 224 &&
    (b[1] & 24) !== 8 && (b[1] & 6) !== 0 && (b[2] >> 4) !== 0 && (b[2] >> 4) !== 15 && (b[2] & 12) !== 12
  if (!valid) throw new Error('QQ 音乐返回的音频头无法识别')
  return codec
}
