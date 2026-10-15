import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { inspectWindowsMediaTail, validateWindowsAudioHeader } from './lib/windows/container.mjs'
const vector = JSON.parse(readFileSync(new URL('./test/fixtures/windows-ekey-native-v1.json', import.meta.url))).vectors[0]
const encoded = Buffer.from(vector.encoded_ekey_hex, 'hex').toString('ascii')

test('canonical native musicex footer trims192 and uses the separately issued Ekey', () => {
  const tail = Buffer.alloc(192)
  tail.writeUInt32LE(192, 176); tail.writeUInt32LE(1, 180); tail.write('musicex\0', 184, 'ascii')
  assert.throws(() => inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true, serverEkey: encoded }))
  tail.write('F0M000000000000001.mflac', 0x48, 'utf16le')
  const result = inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true, serverEkey: encoded })
  assert.equal(result.tailBytes, '192')
  assert.equal(result.footer, 'musicex-v1')
  assert.equal(result.key.toString('hex'), vector.internal_key_hex)
  result.key.fill(0)
  tail.writeUInt32LE(200, 176)
  assert.throws(() => inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true, serverEkey: encoded }))
})

test('musicex filename validation follows native UTF16 termination and dot requirement', () => {
  const tail = Buffer.alloc(192)
  tail.writeUInt32LE(192, 176); tail.writeUInt32LE(1, 180); tail.write('musicex\0', 184, 'ascii')
  for (const name of ['a.', 'abcdef', 'abc\0.flac', '']) {
    tail.fill(0, 0x48, 176)
    tail.write(name, 0x48, 'utf16le')
    assert.throws(() => inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true, serverEkey: encoded }))
  }
  tail.fill(0, 0x48, 176)
  tail.write('a'.repeat(49) + '.', 0x48, 'utf16le')
  assert.throws(() => inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true, serverEkey: encoded }))
})

test('native length suffix supplies an exact key and excludes key plus length word', () => {
  const tail = Buffer.concat([Buffer.from(encoded), Buffer.alloc(4)])
  tail.writeUInt32LE(encoded.length, tail.length - 4)
  const result = inspectWindowsMediaTail({ tail, upstreamLength: '1000', encrypted: true })
  assert.equal(result.tailBytes, String(tail.length))
  assert.equal(result.key.toString('hex'), vector.internal_key_hex)
  result.key.fill(0)
})

test('a CDN stream with a server Ekey can have no disk footer, with codec proof still required', () => {
  const result = inspectWindowsMediaTail({ tail: Buffer.alloc(128), upstreamLength: '1000', encrypted: true, serverEkey: encoded })
  assert.equal(result.tailBytes, '0')
  assert.equal(result.footer, 'none')
  result.key.fill(0)
  assert.throws(() => inspectWindowsMediaTail({ tail: Buffer.alloc(128), upstreamLength: '1000', encrypted: true }))
  assert.throws(() => inspectWindowsMediaTail({ tail: Buffer.alloc(128), upstreamLength: '12', encrypted: true, serverEkey: encoded }))
})

test('preflight recognizes supported headers and rejects an encrypted or wrong-codec prefix', () => {
  const flac = Buffer.alloc(42); flac.write('fLaC'); flac.writeUIntBE(34, 5, 3)
  assert.equal(validateWindowsAudioHeader(flac, 'flac'), 'flac')
  const mp3 = Buffer.alloc(10); mp3.write('ID3'); mp3[3] = 4
  assert.equal(validateWindowsAudioHeader(mp3, 'mp3'), 'mp3')
  assert.equal(validateWindowsAudioHeader(Buffer.from([255, 251, 144, 0]), 'mp3'), 'mp3')
  assert.throws(() => validateWindowsAudioHeader(Buffer.alloc(128), 'flac'))
  assert.throws(() => validateWindowsAudioHeader(flac, 'mp3'))
})
