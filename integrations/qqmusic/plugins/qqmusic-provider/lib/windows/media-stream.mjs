const UINT64_MASK = 0xffffffffffffffffn
const SEGMENT_BYTES = 5120n

export const WINDOWS_MEDIA_STREAM_PROVENANCE = Object.freeze({
  artifact: 'CommonFunction.dll',
  artifactSha256: 'a28ebdd9eda2d3dfbfc540578681bc71425136858e29bc07a22ead142510187d',
  transform: '0x100098a0', init: '0x10009a60', segment: '0x10009b40',
  evidenceIds: ['ev_d2b4f603583399ddcde74c29245e81a7c6d27154f4a3eb4c0413837106ee513b',
    'ev_67c312536fa24a3b657fa4b16995fcc031c47646caa26dfbb23a4b534971f1c8',
    'ev_d629131b5e7cd21bc71558d805061a7be6f92818ff00112f68ef9bbe1068ef42']
})

function offset(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new TypeError('offset must be unsigned decimal text')
  const result = BigInt(value)
  if (result > UINT64_MASK) throw new RangeError('offset exceeds uint64')
  return result
}

function transformSmallKeySpan(buffer, key, begin, end, position) {
  let x = Number(position % 32767n)
  // Native retains the first 32767 but reduces every later multiple to zero.
  const special = position <= 32767n ? 32767 - Number(position) : -1
  const size = key.length
  for (let index = begin; index < end; index += 1) {
    const value = index - begin === special ? 32767 : x
    // value <= 32767, so this arithmetic is exact and stays below 2**31.
    const keyIndex = (value * value + 71214) % size
    const shift = ((keyIndex & 7) + 4) & 7
    // Both native SHR and SHL use this same count; this is not a rotate.
    const byte = key[keyIndex]
    buffer[index] ^= ((byte >>> shift) | (byte << shift)) & 255
    x += 1
    if (x === 32767) x = 0
  }
}

/** Internal-key transform only. Ekey decoding and container boundaries are separate. */
export class WindowsMediaStream {
  #key
  #state
  #hash = 1
  #closed = false

  constructor(key) {
    if (!(key instanceof Uint8Array)) throw new TypeError('media key must be bytes')
    // Adapter resource bound; this is not a native key-length assertion.
    if (key.byteLength === 0 || key.byteLength > 8192) throw new RangeError('media key length is invalid')
    this.#key = Buffer.from(key)
    if (key.byteLength > 300) {
      const size = this.#key.length
      this.#state = Uint8Array.from({ length: size }, (_, index) => index & 255)
      let j = 0
      for (let i = 0; i < size; i += 1) {
        j = (j + this.#state[i] + this.#key[i]) % size
        const previous = this.#state[i]
        this.#state[i] = this.#state[j]
        this.#state[j] = previous
      }
      for (const byte of this.#key) {
        if (byte === 0) continue
        const product = Math.imul(this.#hash, byte) >>> 0
        if (product === 0 || product <= this.#hash) break
        this.#hash = product
      }
    }
  }

  transform(buffer, absoluteOffset) {
    if (this.#closed) throw new Error('media stream is closed')
    if (!(buffer instanceof Uint8Array)) throw new TypeError('media buffer must be bytes')
    if (buffer.byteLength > 0x7fffffff) throw new RangeError('media buffer exceeds native signed length')
    let position = offset(absoluteOffset)
    const size = this.#key.length
    if (size <= 300) {
      // A signed-length buffer can cross the uint64 boundary at most once.
      const untilWrap = UINT64_MASK - position + 1n
      const split = untilWrap < BigInt(buffer.length) ? Number(untilWrap) : buffer.length
      transformSmallKeySpan(buffer, this.#key, 0, split, position)
      if (split < buffer.length) transformSmallKeySpan(buffer, this.#key, split, buffer.length, 0n)
      return buffer
    }

    const spans = []
    let index = 0
    if (position <= 128n) {
      const count = Math.min(buffer.length, 128 - Number(position))
      if (count > 0) spans.push({ prefix: true, position, index, count })
      position += BigInt(count)
      index += count
    }
    const addSpan = (count) => {
      if (count === 0) return
      const segment = position / SEGMENT_BYTES
      const selector = Number(segment & 511n)
      // Native performs an unchecked access here. Reject it before any mutation.
      if (selector >= size) throw new RangeError('media offset selects a key byte outside the key')
      spans.push({ position, index, count, segment, selector })
      index += count
      position = (position + BigInt(count)) & UINT64_MASK
    }
    if (index < buffer.length && position % SEGMENT_BYTES !== 0n) {
      addSpan(Math.min(buffer.length - index, Number(SEGMENT_BYTES - position % SEGMENT_BYTES)))
    }
    while (buffer.length - index > 5120) addSpan(5120)
    addSpan(buffer.length - index)

    const converted = (denominator) => {
      // Native SSE +Infinity -> CAC0/CADC returns this sentinel (public oracle v2).
      if (denominator === 0n) return 0x8000000000000000n
      // Actual SSE scalar double operations, followed by truncation to uint64.
      return BigInt(Math.floor((this.#hash / Number(denominator)) * 100))
    }
    // Compute selectors before mutating data, including bounds/conversion checks.
    for (const span of spans) {
      if (span.prefix) {
        span.masks = []
        for (let i = 0; i < span.count; i += 1) {
          const x = span.position + BigInt(i)
          const denominator = BigInt(this.#key[Number(x % BigInt(size))]) * (x + 1n)
          span.masks.push(this.#key[Number(converted(denominator) % BigInt(size))])
        }
      } else {
        const denominator = BigInt(this.#key[span.selector]) * (span.segment + 1n)
        span.skip = Number(converted(denominator) & 511n) + Number(span.position - span.segment * SEGMENT_BYTES)
      }
    }
    for (const span of spans) {
      if (span.prefix) {
        for (let i = 0; i < span.count; i += 1) buffer[span.index + i] ^= span.masks[i]
        continue
      }
      const state = this.#state.slice()
      let i = 0
      let j = 0
      for (let step = 0; step < span.skip + span.count; step += 1) {
        i = (i + 1) % size
        j = (j + state[i]) % size
        const previous = state[i]
        state[i] = state[j]
        state[j] = previous
        if (step >= span.skip) buffer[span.index + step - span.skip] ^= state[(state[i] + state[j]) % size]
      }
      state.fill(0)
    }
    return buffer
  }

  /** Clear owned byte buffers when a source is revoked; JS does not guarantee secure erasure. */
  dispose() {
    if (this.#closed) return
    this.#closed = true
    this.#key.fill(0)
    this.#state?.fill(0)
    this.#hash = 0
  }
}
