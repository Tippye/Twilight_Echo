import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { transformWindowsFileData, WINDOWS_FILE_TRANSFORM_PROVENANCE } from './lib/windows/file-transform.mjs'

// All expected bytes below were captured from the original DLL, never a port.
const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-file-transform-native-v1.json', import.meta.url)))
const wrapper = JSON.parse(readFileSync(new URL('./lib/windows/data-transform-vectors.json', import.meta.url)))

test('full64 fixture has the original implementation identity', () => {
  assert.equal(native.original_dll_sha256, WINDOWS_FILE_TRANSFORM_PROVENANCE.artifactSha256)
  assert.equal(native.implementation_address, WINDOWS_FILE_TRANSFORM_PROVENANCE.implementationAddress)
  assert.equal(native.vectors.length, 14)
})
for (const vector of native.vectors) {
  test(`file transform matches original full64 helper case ${vector.case_id}`, () => {
    const input = Buffer.from(vector.input_hex, 'hex')
    assert.equal(transformWindowsFileData(input, vector.offset_unsigned_decimal), input)
    assert.equal(input.toString('hex'), vector.output_hex)
    transformWindowsFileData(input, vector.offset_unsigned_decimal)
    assert.equal(input.toString('hex'), vector.input_hex)
  })
}
test('reuses all26 original signed-wrapper cases through their unsigned64 inputs', () => {
  for (const vector of wrapper.vectors) {
    const input = Buffer.from(vector.inputHex, 'hex')
    const position = BigInt.asUintN(64, BigInt(vector.firstParameter)).toString()
    transformWindowsFileData(input, position)
    assert.equal(input.toString('hex'), vector.expectedHex, vector.caseId)
  }
})
test('full64 wrap and modulo segments retain original bytes across range reads', () => {
  for (const caseId of [2,7,9,11,13]) {
    const vector = native.vectors[caseId]
    const data = Buffer.from(vector.input_hex, 'hex')
    for (let start = 0; start < data.length; start += 8191) {
      const position = BigInt.asUintN(64, BigInt(vector.offset_unsigned_decimal) + BigInt(start))
      transformWindowsFileData(data.subarray(start, start + 8191), position.toString())
    }
    assert.equal(data.toString('hex'), vector.output_hex)
  }
})
test('typed subview touches only its requested bytes and returns the same object', () => {
  const vector = native.vectors[13]
  const storage = Buffer.alloc(vector.length + 32, 0xa5)
  const view = new Uint8Array(storage.buffer, storage.byteOffset + 16, vector.length)
  view.set(Buffer.from(vector.input_hex, 'hex'))
  assert.equal(transformWindowsFileData(view, vector.offset_unsigned_decimal), view)
  assert.equal(Buffer.from(view).toString('hex'), vector.output_hex)
  assert.deepEqual(storage.subarray(0,16), Buffer.alloc(16,0xa5))
  assert.deepEqual(storage.subarray(-16), Buffer.alloc(16,0xa5))
})
test('invalid offset and byte types fail before caller mutation', () => {
  const data = Buffer.from([1,2,3])
  for (const value of [0, 0n, undefined, '', '-1', '1.5', 'NaN', '0\n', '0\r', '0\u2028', ' 0', '0 ', '0x1', '18446744073709551616']) {
    assert.throws(() => transformWindowsFileData(data,value))
    assert.deepEqual(data,Buffer.from([1,2,3]))
  }
  for (const value of [null,[1],new DataView(new ArrayBuffer(1))]) {
    assert.throws(() => transformWindowsFileData(value,'0'),TypeError)
  }
})
