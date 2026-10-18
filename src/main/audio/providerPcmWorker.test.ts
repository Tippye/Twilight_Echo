import assert from 'node:assert/strict'
import test from 'node:test'
import { ProviderPlaybackIdentityRegistry } from './providerPlaybackIdentity.ts'
import { bindProviderPcmWorker } from './providerPcmWorker.ts'

const source = 'http://127.0.0.1:1234/audio/public-fixture'
const now = Date.now()
const plugin = 'com.twilightecho.provider.qqmusic'
function setup({
  provider = 'qq',
  owner = plugin,
  quality = 'flac',
  expiry = now + 60000,
  allowed = true
} = {}) {
  const identities = new ProviderPlaybackIdentityRegistry()
  identities.record(
    provider,
    'song',
    'excellent',
    {
      streamUrl: source,
      providerSource: { effect: 'qq-excellent', actualQuality: quality, expiresAt: expiry }
    },
    owner,
    allowed
  )
  const options = {
    identities,
    workerPath: 'C:/app/resources/audio-engine/own-worker.exe',
    now: () => now,
    exists: () => true,
    platform: 'win32'
  }
  return { identities, options }
}

test('only the current authorized QQ source binds the main-selected executable', () => {
  const { options } = setup()
  const item = bindProviderPcmWorker(
    {
      id: 'song',
      source,
      pcmWorkerExecutable: 'C:/untrusted.exe',
      pcmWorkerExpiresAt: now + 86400000
    },
    source,
    options
  )
  assert.equal(item.pcmWorkerExecutable, options.workerPath)
  assert.equal(item.pcmWorkerExpiresAt, now + 60000)
  assert.equal(item.sourceEffect, '臻品音质（本地音效）')
  const ordinary = bindProviderPcmWorker(
    {
      id: 'local',
      source: 'C:/song.flac',
      pcmWorkerExecutable: 'C:/untrusted.exe',
      sourceEffect: 'fake'
    },
    'C:/song.flac',
    options
  )
  assert.equal(ordinary.pcmWorkerExecutable, undefined)
  assert.equal(ordinary.sourceEffect, undefined)
})

test('cross-provider/owner/format, expired and absent worker cannot execute', () => {
  for (const input of [
    { provider: 'other' },
    { owner: 'other' },
    { quality: 'hires' },
    { quality: 'galaxy' },
    { expiry: now - 1 },
    { expiry: now + 86400000 },
    { allowed: false }
  ]) {
    const { options } = setup(input)
    assert.throws(() => bindProviderPcmWorker({ id: 'song', source }, source, options))
  }
  const { options } = setup()
  assert.throws(() =>
    bindProviderPcmWorker({ id: 'song', source }, source, { ...options, exists: () => false })
  )
  assert.throws(() =>
    bindProviderPcmWorker({ id: 'song', source }, source, { ...options, platform: 'linux' })
  )
})

test('explicit plugin revocation removes execution authority and retains a stale alias', () => {
  const { identities, options } = setup()
  let revoked: unknown
  identities.on('revoked', (value) => {
    revoked = value
  })
  identities.revokePlugin(plugin)
  assert.deepEqual(revoked, [source])
  assert.throws(() => identities.get(source), /resolution_changed/)
  assert.throws(
    () => bindProviderPcmWorker({ id: 'song', source }, source, options),
    /resolution_changed/
  )
})

test('plugin revocation includes an older playing quality alias and preserves other plugins', () => {
  const { identities } = setup()
  const next = source + '/next'
  identities.record('qq', 'song', '128', { streamUrl: next }, plugin, true)
  identities.record('other', 'song', '128', { streamUrl: 'C:/other.flac' }, 'other-plugin')
  let revoked: string[] = []
  identities.on('revoked', (value) => {
    revoked = value
  })
  identities.revokePlugin(plugin)
  assert.deepEqual(revoked, [source, next])
  assert.throws(() => identities.get(source), /resolution_changed/)
  assert.throws(() => identities.get(next), /resolution_changed/)
  assert.equal(identities.get('C:/other.flac')?.pluginId, 'other-plugin')
})

test('bounded alias eviction retires existing queue authority before owner information is forgotten', () => {
  const { identities } = setup()
  const retired: string[] = []
  identities.on('revoked', (value: string[]) => retired.push(...value))
  for (let i = 0; i < 4096; i++)
    identities.record('other', String(i), '128', { streamUrl: 'C:/public/' + i }, 'other-plugin')
  assert.ok(retired.includes(source))
  assert.equal(identities.get(source), null)
  identities.revokePlugin(plugin)
  assert.equal(retired.filter((value) => value === source).length, 1)
})
