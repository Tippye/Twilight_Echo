// Windows 22.71 data transformation; file-format validation is handled separately.
// DecryptData -> EncryptData -> FUN_10008d51 uses the same in-place transform.
export const WINDOWS_DATA_TRANSFORM_PROVENANCE = Object.freeze({
  artifact: 'QQMusicCommon.dll',
  version: '22.71',
  artifactSha256: '4267e1c27f7251a31460613a97f5787fd7d9d0be3664e5e615251aba2780471f',
  implementationAddress: '0x10008d51',
  tableAddress: '0x100bae80',
  tableSha256: '771a9b8588ec7cb87d033184d71b0025addea173f51bfb957d004a443f513ebf',
  evidenceId: 'ev_92a30edf23e08e3b569a882fdc6464ac9b424762ddc453438fb7460c23443f34'
})

const MASK_TABLE = Buffer.from(
  '77483273def2c0c895ec30b251c3e1a09ee69dcffa7f14d1ceb8dcc34a6793d6' +
    '28c29170ca8da2a4f00861907e6fa2e0ebae3eb667c792f491b5f66c5e8440f7' +
    'f31b027fd5ab418928f425cc5211ad4368a6418b84b5ff2c924a26d8476a7c956' +
    '1cce6cbbb3f47588975c375a1d9afcc087317dcaa9aa21641d8a206c68bfc6634' +
    '9fcf1823a00a74e72b277092e9af37e68ca7bc62659cc208c988b3f343ac742c0' +
    'fd4afa1c30164954e489ff43578957a39d66aa06d40e84fa8ef111df31b3f3f07' +
    'dd6f5b193019fbef0e37f00ecd1649fe5347131abda4f14019600eed6809065f4' +
    'dcf3d1afe2077e4d9daf9a42b761c71db00bcfd0c6ca547f7f600794a11',
  'hex'
)

const MODULUS = 0x7fff
const UINT64_WRAP_REMAINDER = Number((1n << 64n) % BigInt(MODULUS))

/**
 * Apply the observed native byte transform in place and return the same view.
 * firstParameter is the native signed int32 input; its business meaning is not
 * established. This function alone does not establish QMC/MFLAC/MGG support.
 */
export function transformWindowsData(buffer, firstParameter) {
  if (!(buffer instanceof Uint8Array)) {
    throw new TypeError('buffer must be a Uint8Array or Buffer')
  }
  if (
    !Number.isInteger(firstParameter) ||
    firstParameter < -0x80000000 ||
    firstParameter > 0x7fffffff
  ) {
    throw new RangeError('firstParameter must be a signed int32')
  }
  if (buffer.length > 0x7fffffff) {
    throw new RangeError('buffer length must fit a signed int32')
  }

  for (let i = 0; i < buffer.length; i += 1) {
    let value = firstParameter + i
    if (value < 0) {
      // The native wrapper sign-extends before unsigned 64-bit remainder.
      value = (value % MODULUS + UINT64_WRAP_REMAINDER + MODULUS) % MODULUS
    } else if (value > MODULUS) {
      value %= MODULUS
    }
    buffer[i] ^= MASK_TABLE[(value * value + 0x1b) & 0xff]
  }
  return buffer
}
