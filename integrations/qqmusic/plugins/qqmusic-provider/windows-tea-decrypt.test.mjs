import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { decryptQqTea, decryptTeaBlock } from './lib/windows/tea.mjs'

const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-signature-native-v2.json', import.meta.url)))
for (const vector of native.vectors) {
  test(`inverse recovers original DLL metadata: ${vector.name}`, () => {
    const sign = Buffer.from(vector.signHex, 'hex').subarray(0, -1).toString('ascii')
    const cipher = Buffer.from(Buffer.from(vector.maskHex, 'hex').subarray(0, -1).toString('ascii'), 'base64')
    const key = Buffer.from(sign.slice(0, 8) + sign.slice(-8), 'ascii')
    const before = Buffer.from(cipher)
    assert.equal(decryptQqTea(cipher, key).toString('hex'), vector.metadataHex)
    assert.deepEqual(cipher, before)
  })
}

test('inverse block direction agrees with statically derived 16-cycle examples', () => {
  assert.equal(decryptTeaBlock(Buffer.from('a889f798182d8083', 'hex'), Buffer.alloc(16)).toString('hex'), '0000000000000000')
  assert.equal(decryptTeaBlock(Buffer.from('6328a50896bde3c8', 'hex'), Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')).toString('hex'), '0001020304050607')
})

test('invalid lengths and damaged native framing produce no partial plaintext', () => {
  for (const length of [0, 8, 15, 17]) assert.throws(() => decryptQqTea(Buffer.alloc(length), Buffer.alloc(16)), RangeError)
  const vector = native.vectors[0]
  const sign = Buffer.from(vector.signHex, 'hex').subarray(0, -1).toString('ascii')
  const cipher = Buffer.from(Buffer.from(vector.maskHex, 'hex').subarray(0, -1).toString('ascii'), 'base64')
  cipher[cipher.length - 1] ^= 1
  assert.throws(() => decryptQqTea(cipher, Buffer.from(sign.slice(0, 8) + sign.slice(-8))), /framing is invalid/)
})
