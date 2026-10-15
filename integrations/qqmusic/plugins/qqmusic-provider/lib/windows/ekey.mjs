import { decryptQqTea } from './tea.mjs'

// Exact outputs for the eight immutable native seed inputs, verified by original DLL.
const SEEDS = Buffer.from('695646382b20150b', 'hex')
const V2_MARKER = Buffer.from('QQMusic EncV2,Key:', 'ascii')
const V2_KEYS = [Buffer.from('3338365a4a592140232a24255e262928', 'hex'),
  Buffer.from('2a2a232128232425265e6131635a2c54', 'hex')]
const MAX_ENCODED_BYTES = 32768
const MAX_KEY_BYTES = 8192

export const WINDOWS_EKEY_PROVENANCE = Object.freeze({
  artifact: 'CommonFunction.dll',
  artifactSha256: 'a28ebdd9eda2d3dfbfc540578681bc71425136858e29bc07a22ead142510187d',
  keyIntake: '0x100053c0', base64Decoder: '0x10001370', inverse: '0x1000a695',
  evidenceIds: ['ev_7e525199f2aab5f0b4fe1a4bc8ab250f77e928a010ce25b0f2a8343ff304693f',
    'ev_3e413d36d4e6ab476fb7a8183793aa3159675a4bd5eb8992a17aacf3c3450e81']
})

function base64(value) {
  if (typeof value !== 'string' || value.length > MAX_ENCODED_BYTES ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('QQ 音乐媒体密钥编码无效')
  }
  const decoded = Buffer.from(value, 'base64')
  const canonical = decoded.toString('base64')
  if (canonical.replace(/=+$/, '') !== value.replace(/=+$/, '') ||
      (value.includes('=') && value !== canonical)) {
    decoded.fill(0)
    throw new Error('QQ 音乐媒体密钥编码无效')
  }
  return decoded
}

/** Decode the actual native V1 or EncV2 representation to an internal stream key. */
export function decodeWindowsEkey(encoded) {
  const owned = []
  const keep = (buffer) => { owned.push(buffer); return buffer }
  try {
    let raw = keep(base64(encoded))
    if (raw.subarray(0, V2_MARKER.length).equals(V2_MARKER)) {
      const first = keep(decryptQqTea(raw.subarray(V2_MARKER.length), V2_KEYS[0]))
      const second = keep(decryptQqTea(first, V2_KEYS[1]))
      if (second.some((value) => value > 127)) throw new Error('Invalid media key')
      raw = keep(base64(second.toString('ascii')))
    }
    if (raw.length < 24) throw new Error('Invalid media key')
    const mixedKey = keep(Buffer.alloc(16))
    for (let index = 0; index < 8; index += 1) {
      mixedKey[index * 2] = SEEDS[index]
      mixedKey[index * 2 + 1] = raw[index]
    }
    const tail = keep(decryptQqTea(raw.subarray(8), mixedKey))
    if (tail.length + 8 > MAX_KEY_BYTES) throw new Error('Invalid media key')
    return Buffer.concat([raw.subarray(0, 8), tail])
  } catch {
    throw new Error('QQ 音乐媒体密钥无效')
  } finally {
    for (const buffer of owned) buffer.fill(0)
  }
}
