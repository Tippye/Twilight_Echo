/** JsonCpp's signed __int64 constructor emits an exact JSON number. */
export function nativeSigned64(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new TypeError('native int64 must be a decimal string')
  }
  const integer = BigInt(value)
  if (integer < -0x8000000000000000n || integer > 0x7fffffffffffffffn) {
    throw new RangeError('native int64 is outside the signed 64-bit range')
  }
  if (typeof JSON.rawJSON !== 'function') {
    throw new Error('Windows protocol requires a runtime supporting JSON.rawJSON')
  }
  return JSON.rawJSON(integer.toString())
}
