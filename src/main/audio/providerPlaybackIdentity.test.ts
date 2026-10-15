import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bindPlaybackSourceMetadata,
  ProviderPlaybackIdentityRegistry
} from './providerPlaybackIdentity.ts'

test('requested quality never substitutes for unknown actual quality', () => {
  const r = new ProviderPlaybackIdentityRegistry()
  r.record('ncm', '1', 'hires', 'https://cdn.example/1.mp3')
  assert.equal(r.get('https://cdn.example/1.mp3')?.actualQuality, null)
})
test('refresh, actual quality, and exact cache path changes revoke old resolution', () => {
  const r = new ProviderPlaybackIdentityRegistry(),
    changed: string[][] = []
  r.on('changed', (sources) => changed.push(sources))
  const first = {
    streamUrl: 'D:/cache/1.a.flac',
    providerSource: {
      originSource: 'https://cdn.example/1?token=a',
      actualQuality: 'lossless',
      sampleRate: 44100
    }
  }
  r.record('ncm', '1', 'hires', first)
  const revision = r.revision(first.streamUrl)
  r.record('ncm', '1', 'hires', first)
  assert.equal(r.revision(first.streamUrl), revision)
  assert.equal(changed.length, 1)
  r.record('ncm', '1', 'hires', {
    ...first,
    providerSource: {
      ...first.providerSource,
      originSource: 'https://cdn.example/1?token=b',
      actualQuality: 'hires'
    }
  })
  assert.notEqual(r.revision(first.streamUrl), revision)
  r.record('ncm', '1', 'standard', 'D:/cache/1.b.mp3')
  assert.throws(() => r.assertCurrent(first.streamUrl), /resolution_changed/)
  assert.doesNotThrow(() => r.assertCurrent('D:/cache/1.b.mp3'))
  assert.doesNotThrow(() => r.assertCurrent('D:/local/unregistered.flac'))
})
test('expired addresses cannot prepare, but cached bytes do not inherit URL expiry', () => {
  const r = new ProviderPlaybackIdentityRegistry()
  r.record('ncm', '1', 'standard', {
    streamUrl: 'https://cdn.example/expired',
    providerSource: { expiresAt: 1 }
  })
  assert.throws(() => r.assertCurrent('https://cdn.example/expired'), /expired/)
  r.record('ncm', '1', 'standard', {
    streamUrl: 'D:/cache/1.flac',
    providerSource: { expiresAt: 1 }
  })
  assert.doesNotThrow(() => r.assertCurrent('D:/cache/1.flac'))
})

test('authorized queue metadata owns a plaintext byte snapshot across provider refresh', () => {
  const r = new ProviderPlaybackIdentityRegistry()
  const original = 'http://127.0.0.1:12345/audio/original'
  const next = 'http://127.0.0.1:12345/audio/next'
  r.record('qq', 'song', '128', { streamUrl: original, providerSource: { bytes: 3_460_301 } })
  const item = bindPlaybackSourceMetadata(
    {
      id: 'qq:song',
      source: 'twilight-media://audio/original',
      sourceBytes: 1,
      rendererSource: 'untrusted-alias'
    },
    original,
    r
  )
  assert.equal(item.source, original)
  assert.equal(item.rendererSource, 'twilight-media://audio/original')
  assert.equal(item.sourceBytes, 3_460_301)
  r.record('qq', 'song', 'flac', { streamUrl: next, providerSource: { bytes: 26_738_688 } })
  assert.throws(() => r.get(original), /resolution_changed/)
  assert.equal(item.sourceBytes, 3_460_301)
  const revoked = bindPlaybackSourceMetadata(item, original, r)
  assert.equal(revoked.sourceBytes, undefined)
  const lossless = bindPlaybackSourceMetadata(
    { id: 'qq:song', source: 'twilight-media://audio/next' },
    next,
    r
  )
  assert.equal(lossless.sourceBytes, 26_738_688)
})

test('queue metadata never trusts renderer bytes or unsafe provider byte values', () => {
  const r = new ProviderPlaybackIdentityRegistry()
  const source = 'http://127.0.0.1:12345/audio/fixture'
  for (const bytes of [
    undefined,
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '123'
  ]) {
    r.record('qq', 'song', '128', { streamUrl: source, providerSource: { bytes } })
    const item = bindPlaybackSourceMetadata(
      { id: 'qq:song', source: 'twilight-media://audio/fixture', sourceBytes: 987 },
      source,
      r
    )
    assert.equal(item.sourceBytes, undefined)
  }
  assert.equal(
    bindPlaybackSourceMetadata(
      { id: 'local', source: 'D:/Music/fixture.flac', sourceBytes: 987 },
      'D:/Music/fixture.flac',
      r
    ).sourceBytes,
    undefined
  )
})
