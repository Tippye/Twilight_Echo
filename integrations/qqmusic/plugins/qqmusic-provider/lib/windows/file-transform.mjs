import { transformWindowsData, WINDOWS_DATA_TRANSFORM_PROVENANCE } from './data-transform.mjs'

const UINT64_MAX = 0xffffffffffffffffn
const UINT64_SIZE = 1n << 64n
const MODULUS = 32767

export const WINDOWS_FILE_TRANSFORM_PROVENANCE = Object.freeze({
  ...WINDOWS_DATA_TRANSFORM_PROVENANCE,
  callerAddress: '0x1001384f',
  callerEvidenceId: 'ev_fcdf274e2852e2931d8d7f34f41791d14234d387f5abe7510840024d64129d97',
  offsetContract: 'unsigned64 physical read start; no header subtraction in GetCurPosition'
})

/** Apply mode1's full unsigned64 position contract in place, preserving the view. */
export function transformWindowsFileData(buffer, absoluteOffset) {
  if (!(buffer instanceof Uint8Array)) throw new TypeError('media buffer must be bytes')
  if (buffer.length > 0x7fffffff) throw new RangeError('media buffer exceeds native signed length')
  if (typeof absoluteOffset !== 'string' || absoluteOffset.length === 0 || /[^0-9]/.test(absoluteOffset)) {
    throw new TypeError('offset must be unsigned decimal text')
  }
  let position = BigInt(absoluteOffset)
  if (position > UINT64_MAX) throw new RangeError('offset exceeds uint64')

  let index = 0
  while (index < buffer.length) {
    const remaining = buffer.length - index
    if (position <= BigInt(MODULUS)) {
      // This domain cannot wrap with an int32-sized buffer. Preserve x==32767.
      transformWindowsData(buffer.subarray(index), Number(position))
      break
    }
    const untilWrap = UINT64_SIZE - position
    const count = untilWrap < BigInt(remaining) ? Number(untilWrap) : remaining
    let residue = Number(position % BigInt(MODULUS))
    const end = index + count
    while (index < end) {
      // Large native positions always reduce modulo32767; never feed its
      // exceptional unreduced value32767 into the signed wrapper helper.
      const span = Math.min(end - index, MODULUS - residue)
      transformWindowsData(buffer.subarray(index, index + span), residue)
      index += span
      residue = 0
    }
    position = (position + BigInt(count)) & UINT64_MAX
  }
  return buffer
}
