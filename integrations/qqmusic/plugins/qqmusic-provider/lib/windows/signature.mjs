import { createHmac, randomInt } from 'node:crypto'
import { encryptQqTea } from './tea.mjs'

// Derived from CommonFunction.dll 22.71, not an account credential.
const HMAC_KEY = Buffer.from('9FF169D646A3', 'ascii')
const secureRandom = () => randomInt(0, 32768)

function bytes(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be serialized bytes`)
  if (value.byteLength > 0x7fffffff) throw new RangeError(`${name} exceeds the native length range`)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

/** Returns HTTP header strings; native output buffers additionally contain one NUL. */
export function createWindowsSignature(body, metadata, { randomInt: random = secureRandom } = {}) {
  body = bytes(body, 'body')
  metadata = bytes(metadata, 'metadata')
  if (typeof random !== 'function') throw new TypeError('randomInt must be a function')
  const nextRandom = () => {
    const value = random()
    if (!Number.isInteger(value) || value < 0 || value >= 32768) {
      throw new RangeError('randomInt must return an integer in [0, 32768)')
    }
    return value
  }
  const reversedBase64 = body.toString('base64').split('').reverse().join('')
  const digest = createHmac('sha1', HMAC_KEY).update(reversedBase64, 'ascii').digest()
  const prefix = Buffer.alloc(12)
  for (let index = 0; index < prefix.length; index += 1) prefix[index] = nextRandom() % 26 + 65
  const sign = Buffer.concat([prefix, digest]).toString('base64')
  const maskKey = Buffer.from(sign.slice(0, 8) + sign.slice(-8), 'ascii')
  const mask = encryptQqTea(metadata, maskKey, nextRandom).toString('base64')
  return { sign, mask }
}
