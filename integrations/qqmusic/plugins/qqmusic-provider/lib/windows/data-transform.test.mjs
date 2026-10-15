import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { transformWindowsData, WINDOWS_DATA_TRANSFORM_PROVENANCE } from './data-transform.mjs'

// Expected bytes were produced by the original x86 DLL, not this implementation.
const fixture = JSON.parse(readFileSync(new URL('./data-transform-vectors.json', import.meta.url)))

test('native oracle fixture refers to the reconstructed DLL identity and 32-bit runtime', () => {
  assert.equal(fixture.source.artifactSha256, WINDOWS_DATA_TRANSFORM_PROVENANCE.artifactSha256)
  assert.equal(fixture.source.pointerBits, 32)
  assert.equal(fixture.vectors.length, 26)
})

for (const vector of fixture.vectors) {
  test(`matches original native output: ${vector.caseId}`, () => {
    const input = Buffer.from(vector.inputHex, 'hex')
    assert.equal(input.length, vector.length)
    assert.equal(transformWindowsData(input, vector.firstParameter), input)
    assert.equal(input.toString('hex'), vector.expectedHex)
    transformWindowsData(input, vector.firstParameter)
    assert.equal(input.toString('hex'), vector.inputHex)
  })
}

test('matches native output on a subview without touching surrounding storage', () => {
  const vector = fixture.vectors.find((item) => item.firstParameter === -16 && item.length === 64)
  assert.ok(vector)
  const parent = Buffer.alloc(vector.length + 32, 0xa5)
  const view = new Uint8Array(parent.buffer, parent.byteOffset + 16, vector.length)
  view.set(Buffer.from(vector.inputHex, 'hex'))
  assert.equal(transformWindowsData(view, vector.firstParameter), view)
  assert.equal(Buffer.from(view).toString('hex'), vector.expectedHex)
  assert.deepEqual(parent.subarray(0, 16), Buffer.alloc(16, 0xa5))
  assert.deepEqual(parent.subarray(-16), Buffer.alloc(16, 0xa5))
})

test('segment positions agree with the native whole result across modulo and signed boundaries', () => {
  for (const firstParameter of [-16, 32760]) {
    const vector = fixture.vectors.find((item) => item.firstParameter === firstParameter && item.length === 64)
    assert.ok(vector)
    const input = Buffer.from(vector.inputHex, 'hex')
    for (let start = 0; start < input.length; start += 7) {
      transformWindowsData(input.subarray(start, start + 7), firstParameter + start)
    }
    assert.equal(input.toString('hex'), vector.expectedHex)
  }
})

test('rejects invalid native input before mutating the caller buffer', () => {
  const input = Buffer.from([1, 2, 3])
  for (const firstParameter of [undefined, '0', NaN, Infinity, 0.5, -2147483649, 2147483648]) {
    assert.throws(() => transformWindowsData(input, firstParameter), RangeError)
    assert.deepEqual(input, Buffer.from([1, 2, 3]))
  }
  for (const buffer of [null, [1, 2], new DataView(new ArrayBuffer(2))]) {
    assert.throws(() => transformWindowsData(buffer, 0), TypeError)
  }
})
