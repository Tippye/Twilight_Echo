import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decodeWindowsEkey } from './lib/windows/ekey.mjs'
import { WindowsMediaStream } from './lib/windows/media-stream.mjs'

const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-ekey-native-v1.json', import.meta.url)))
const stream = JSON.parse(readFileSync(new URL('./test/fixtures/windows-media-stream-native-v1.json', import.meta.url)))
for (const vector of native.vectors) {
  test(`Ekey ${vector.version} matches original KeyDec length ${vector.key_length}`, () => {
    const encoded = Buffer.from(vector.encoded_ekey_hex, 'hex').toString('ascii')
    const key = decodeWindowsEkey(encoded)
    assert.equal(key.length, vector.key_length)
    assert.equal(key.toString('hex'), vector.internal_key_hex)
    const sample = stream.vectors.find((entry) => entry.key_hex === vector.internal_key_hex)
    assert.ok(sample)
    const buffer = Buffer.from(sample.input_hex, 'hex')
    new WindowsMediaStream(key).transform(buffer, sample.offset_unsigned_decimal)
    assert.equal(buffer.toString('hex'), sample.output_hex)
  })
}

test('malformed and damaged Ekeys fail without exposing input or partial key material', () => {
  for (const value of [null, {}, '', 'PRIVATE_VALUE!', 'AA=', 'AA===', 'AB==', 'A', 'A'.repeat(32769)]) {
    assert.throws(() => decodeWindowsEkey(value), (error) => error.message === 'QQ 音乐媒体密钥无效')
  }
  const bytes = Buffer.from(Buffer.from(native.vectors[0].encoded_ekey_hex, 'hex').toString('ascii'), 'base64')
  bytes[bytes.length - 1] ^= 1
  assert.throws(() => decodeWindowsEkey(bytes.toString('base64')), /媒体密钥无效/)
})
