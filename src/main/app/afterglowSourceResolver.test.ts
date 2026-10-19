import assert from 'node:assert/strict'
import test from 'node:test'
import { createAfterglowSourceResolver } from './afterglowSourceResolver.ts'

test('local queue entries resolve without touching a provider', async () => {
  let calls = 0
  const resolver = createAfterglowSourceResolver({
    callProvider: async () => {
      calls += 1
      return 'https://cdn.test/unused.flac'
    }
  })
  const resolved = await resolver.resolve({
    id: 'local:1',
    filePath: 'D:/Music/album/song.flac',
    source: 'local'
  })
  assert.deepEqual(resolved, { source: 'D:/Music/album/song.flac', expiresAt: null })
  assert.equal(calls, 0)
})

test('provider results normalize string and identity payloads', async () => {
  const now = 1_000_000
  const seen: Array<{ providerId: string; method: string; args: unknown[] }> = []
  const resolver = createAfterglowSourceResolver({
    now: () => now,
    quality: 'lossless',
    callProvider: async (providerId, method, args) => {
      seen.push({ providerId, method, args })
      return {
        streamUrl: 'https://cdn.test/song.flac?sig=1',
        providerSource: { expiresAt: now + 120_000 }
      }
    }
  })
  const resolved = await resolver.resolve({
    id: 'ncm:123',
    filePath: 'ncm:123',
    source: 'ncm'
  })
  assert.deepEqual(resolved, {
    source: 'https://cdn.test/song.flac?sig=1',
    expiresAt: now + 120_000
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].providerId, 'ncm')
  assert.equal(seen[0].method, 'getPlaybackUrl')
  assert.deepEqual(seen[0].args[1], { quality: 'lossless' })

  const stringResolver = createAfterglowSourceResolver({
    now: () => now,
    quality: 'auto',
    callProvider: async () => 'https://cdn.test/plain.flac'
  })
  const plain = await stringResolver.resolve({ id: 'ncm:2', source: 'ncm' })
  assert.deepEqual(plain, {
    source: 'https://cdn.test/plain.flac',
    expiresAt: now + 8 * 60_000
  })
})

test('provider failures and renderer-only URLs fail closed', async () => {
  const resolver = createAfterglowSourceResolver({
    quality: 'auto',
    callProvider: async () => ({ streamUrl: 'twilight-media://audio/token' })
  })
  assert.equal(await resolver.resolve({ id: 'ncm:3', source: 'ncm' }), null)

  const throwing = createAfterglowSourceResolver({
    quality: 'auto',
    callProvider: async () => {
      throw new Error('provider offline')
    }
  })
  assert.equal(await throwing.resolve({ id: 'ncm:4', source: 'ncm' }), null)
})
