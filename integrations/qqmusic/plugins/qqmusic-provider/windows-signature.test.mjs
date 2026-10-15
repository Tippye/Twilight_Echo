import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createWindowsSignature } from './lib/windows/signature.mjs'
import { encryptTeaBlock } from './lib/windows/tea.mjs'

const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-signature-native-v2.json', import.meta.url)))

for (const vector of native.vectors) {
  test(`Windows signature matches original DLL: ${vector.name}`, () => {
    const body = Buffer.from(vector.bodyHex, 'hex')
    const metadata = Buffer.from(vector.metadataHex, 'hex')
    const beforeBody = Buffer.from(body)
    const beforeMetadata = Buffer.from(metadata)
    let index = 0
    const result = createWindowsSignature(body, metadata, {
      randomInt: () => native.sampledRandStream[index++]
    })
    const sign = Buffer.from(`${result.sign}\0`, 'ascii')
    const mask = Buffer.from(`${result.mask}\0`, 'ascii')
    assert.equal(sign.toString('hex'), vector.signHex)
    assert.equal(mask.toString('hex'), vector.maskHex)
    assert.equal(sign.length, vector.signLength)
    assert.equal(mask.length, vector.maskLength)
    assert.ok(!result.sign.includes('\0') && !result.mask.includes('\0'))
    assert.deepEqual(body, beforeBody)
    assert.deepEqual(metadata, beforeMetadata)
  })
}

test('TEA block has native 16-cycle and big-endian semantics', () => {
  assert.equal(encryptTeaBlock(Buffer.alloc(8), Buffer.alloc(16)).toString('hex'), 'a889f798182d8083')
  assert.equal(
    encryptTeaBlock(Buffer.from('0001020304050607', 'hex'), Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')).toString('hex'),
    '6328a50896bde3c8'
  )
})

test('serialized views preserve their byte offset', () => {
  const body = new Uint8Array([99, 123, 125, 99]).subarray(1, 3)
  const metadata = new Uint8Array([99, 120, 99]).subarray(1, 2)
  const options = { randomInt: () => 0 }
  assert.deepEqual(createWindowsSignature(body, metadata, options), createWindowsSignature(Buffer.from('{}'), Buffer.from('x'), options))
})

test('production randomness returns NUL-free header strings', () => {
  const { sign, mask } = createWindowsSignature(Buffer.from('{}'), Buffer.from('fake-metadata'))
  assert.equal(sign.length, 44)
  assert.match(sign, /^[A-Za-z0-9+/]+=$/)
  assert.match(mask, /^[A-Za-z0-9+/]+={0,2}$/)
})

test('signing requires bytes and a bounded random integer source', () => {
  const body = Buffer.from('{}')
  const metadata = Buffer.from('fake')
  assert.throws(() => createWindowsSignature('{}', metadata), TypeError)
  assert.throws(() => createWindowsSignature(body, {}), TypeError)
  assert.throws(() => createWindowsSignature(body, metadata, { randomInt: 1 }), TypeError)
  for (const value of [-1, 32768, NaN, 0.5, '1']) {
    assert.throws(() => createWindowsSignature(body, metadata, { randomInt: () => value }), RangeError)
  }
})
