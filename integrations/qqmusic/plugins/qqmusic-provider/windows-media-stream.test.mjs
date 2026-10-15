import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { WindowsMediaStream } from './lib/windows/media-stream.mjs'

const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-media-stream-native-v1.json', import.meta.url)))
const zeros = JSON.parse(readFileSync(new URL('./test/fixtures/windows-media-stream-native-v2.json', import.meta.url)))
for (const [label, fixture] of [['v1', native], ['zero-v2', zeros]]) for (const vector of fixture.vectors) {
  test(`media internal key matches original DLL ${label} case ${vector.case_id}`, () => {
    const key = Buffer.from(vector.key_hex, 'hex')
    const cipher = new WindowsMediaStream(key)
    const guarded = Buffer.concat([Buffer.alloc(8, 0xa5), Buffer.from(vector.input_hex, 'hex'), Buffer.alloc(8, 0x5a)])
    const input = guarded.subarray(8, guarded.length - 8)
    assert.equal(cipher.transform(input, vector.offset_unsigned_decimal), input)
    assert.equal(input.toString('hex'), vector.output_hex)
    assert.equal(guarded.subarray(0, 8).toString('hex'), 'a5a5a5a5a5a5a5a5')
    assert.equal(guarded.subarray(-8).toString('hex'), '5a5a5a5a5a5a5a5a')
    assert.equal(key.toString('hex'), vector.key_hex)
  })
}

test('retains key ownership and rejects unsafe native key indexing before mutation', () => {
  const key = Buffer.from(native.vectors[3].key_hex, 'hex')
  const cipher = new WindowsMediaStream(key)
  key.fill(0)
  const data = Buffer.from(native.vectors[3].input_hex, 'hex')
  cipher.transform(data, '0')
  assert.equal(data.toString('hex'), native.vectors[3].output_hex)
  const smallLongKey = new WindowsMediaStream(Buffer.alloc(301, 1))
  const untouched = Buffer.alloc(64, 7)
  assert.throws(() => smallLongKey.transform(untouched, String(301 * 5120)), /outside the key/)
  assert.ok(untouched.every((value) => value === 7))
})

test('rejects lossy offsets and invalid resource sizes', () => {
  const cipher = new WindowsMediaStream(Buffer.alloc(16, 1))
  for (const value of [0, 0n, '-1', '1.5', '18446744073709551616']) {
    assert.throws(() => cipher.transform(Buffer.alloc(1), value))
  }
  assert.throws(() => new WindowsMediaStream(Buffer.alloc(0)), RangeError)
  assert.throws(() => new WindowsMediaStream(Buffer.alloc(8193)), RangeError)
})

test('revoking a stream prevents later transforms without altering caller buffers', () => {
  for (const size of [16, 512]) {
    const key = Buffer.alloc(size, 7)
    const cipher = new WindowsMediaStream(key)
    cipher.dispose()
    cipher.dispose()
    const data = Buffer.alloc(64, 9)
    assert.throws(() => cipher.transform(data, '0'), /closed/)
    assert.ok(data.every(value => value === 9))
    assert.ok(key.every(value => value === 7))
  }
})
