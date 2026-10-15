import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlaybackQualityController } from './playbackQualityController.ts'
import type { Track } from '../../types/music'
import type { MediaProvider } from '../../providers/mediaProvider.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture() {
  let track = {
    id: 'fake:song',
    source: 'fake',
    queueEntryId: 'first',
    title: 'Public fixture'
  } as Track
  let owner = 1
  let position = 31
  let playing = true
  let allowed = true
  const resolves: Array<{ track: Track; options: unknown; signal?: AbortSignal }> = []
  const reloads: Array<{ track: Track; target: string; position: number; playing: boolean }> = []
  const saved: string[] = []
  let save = async (quality: string) => {
    saved.push(quality)
  }
  let resolveUrl = async () => 'twilight-media://fixture/new-quality'
  const provider: MediaProvider = {
    id: 'fake',
    source: 'plugin',
    name: 'Fixture',
    capabilities: ['playbackUrl'],
    getPlaybackQuality: async () => ({ quality: 'low', options: [{ value: 'low', label: 'Low' }] }),
    setPlaybackQuality: async (quality) => {
      await save(quality)
      return { quality, options: [{ value: quality, label: quality }] }
    },
    getPlaybackUrl: async (copy, options, callOptions) => {
      resolves.push({ track: copy, options, signal: callOptions?.signal })
      copy.streamUrl = 'provider-mutated-copy'
      return resolveUrl()
    }
  }
  const controller = createPlaybackQualityController({
    getTrack: () => track,
    getProvider: () => provider,
    captureOwner: () => {
      const captured = owner
      return () => captured === owner
    },
    canReload: () => allowed,
    getPosition: () => position,
    isPlaying: () => playing,
    reload: async (copy, target, at, play) => {
      reloads.push({ track: copy, target, position: at, playing: play })
    }
  })
  return {
    controller,
    provider,
    resolves,
    reloads,
    saved,
    get track() {
      return track
    },
    replaceTrack(next: Track) {
      track = next
      owner++
    },
    invalidate() {
      owner++
    },
    setPosition(at: number) {
      position = at
    },
    setPlaying(play: boolean) {
      playing = play
    },
    setAllowed(value: boolean) {
      allowed = value
    },
    holdSave(fn: typeof save) {
      save = fn
    },
    holdResolve(fn: typeof resolveUrl) {
      resolveUrl = fn
    }
  }
}

test('resolve requested quality before reloading and preserve the latest position and pause', async () => {
  const f = fixture()
  const held = deferred<string>()
  f.holdResolve(() => held.promise)
  const changing = f.controller.changeQuality('lossless')
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.reloads.length, 0)
  f.setPosition(47.25)
  f.setPlaying(false)
  held.resolve('twilight-media://fixture/lossless')
  const result = await changing
  assert.equal(result.quality, 'lossless')
  assert.deepEqual(f.resolves[0].options, { quality: 'lossless', force: true })
  assert.equal(f.reloads.length, 1)
  assert.equal(f.reloads[0].position, 47.25)
  assert.equal(f.reloads[0].playing, false)
  assert.equal(f.track.streamUrl, undefined, 'resolver must not mutate the live queue item')
  assert.equal(f.reloads[0].track.id, f.track.id)
})

test('unsupported or rejected quality leaves existing playback untouched', async () => {
  const f = fixture()
  f.holdResolve(async () => null as unknown as string)
  await assert.rejects(f.controller.changeQuality('spatial'), /现有播放继续保留/)
  assert.equal(f.reloads.length, 0)
  f.holdResolve(async () => {
    throw new Error('Source unavailable')
  })
  await assert.rejects(f.controller.changeQuality('spatial'), /Source unavailable/)
  assert.equal(f.reloads.length, 0)
})

test('a newer track, duplicate queue entry, or provider owner invalidation rejects an old resolution', async () => {
  for (const drift of ['next', 'duplicate', 'provider'] as const) {
    const f = fixture()
    const held = deferred<string>()
    f.holdResolve(() => held.promise)
    const changing = f.controller.changeQuality('lossless')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    if (drift === 'next') f.replaceTrack({ ...f.track, id: 'fake:next' })
    if (drift === 'duplicate') f.replaceTrack({ ...f.track, queueEntryId: 'second' })
    if (drift === 'provider') f.invalidate()
    held.resolve('twilight-media://fixture/stale')
    await changing
    assert.equal(f.reloads.length, 0, drift)
  }
})

test('a selection superseded during persistence does not resolve or reload its old song', async () => {
  const f = fixture()
  const held = deferred<void>()
  f.holdSave(() => held.promise)
  const changing = f.controller.changeQuality('lossless')
  f.invalidate()
  held.resolve()
  await changing
  assert.equal(f.resolves.length, 0)
  assert.equal(f.reloads.length, 0)
})

test('the latest selection wins even when an earlier resolution completes last', async () => {
  const f = fixture()
  const old = deferred<string>()
  let count = 0
  f.holdResolve(() =>
    ++count === 1 ? old.promise : Promise.resolve('twilight-media://fixture/latest')
  )
  const earlier = f.controller.changeQuality('first')
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await f.controller.changeQuality('second')
  old.resolve('twilight-media://fixture/earlier')
  await earlier
  assert.equal(f.reloads.length, 1)
  assert.equal(f.reloads[0].target, 'twilight-media://fixture/latest')
})

test('loading, casting, or missing optional methods do not mutate a preference', async () => {
  const f = fixture()
  f.setAllowed(false)
  await assert.rejects(f.controller.changeQuality('lossless'), /不支持切换/)
  f.setAllowed(true)
  delete f.provider.setPlaybackQuality
  await assert.rejects(f.controller.changeQuality('lossless'), /不支持切换/)
  assert.deepEqual(f.saved, [])
})

test('provider same-track downgrade preserves the higher preference and the queue identity', async () => {
  const f = fixture()
  let catalogueReads = 0
  f.provider.getTrackPlaybackQualities = async (track) => {
    catalogueReads++
    return {
      trackId: track.id,
      options: [{ value: 'dolby', label: 'Dolby', availability: 'unavailable' }]
    }
  }
  const original = { ...f.track }
  f.holdResolve(async () => 'twilight-media://fixture/same-track-flac')
  f.setPosition(47.25)
  f.setPlaying(false)
  const result = await f.controller.changeQuality('dolby')
  assert.equal(catalogueReads, 0, 'catalogue hints cannot veto the provider downgrade policy')
  assert.equal(result.quality, 'dolby')
  assert.deepEqual(f.saved, ['dolby'])
  assert.deepEqual(f.resolves[0].options, { quality: 'dolby', force: true })
  assert.equal(f.reloads.length, 1)
  assert.equal(f.reloads[0].target, 'twilight-media://fixture/same-track-flac')
  assert.equal(f.reloads[0].track.id, original.id)
  assert.equal(f.reloads[0].track.queueEntryId, original.queueEntryId)
  assert.equal(f.reloads[0].position, 47.25)
  assert.equal(f.reloads[0].playing, false)
  assert.deepEqual(f.track, original)
})

test('a cancelled provider resolution receives the abort and cannot replace the current stream', async () => {
  const f = fixture()
  const held = deferred<string>()
  f.holdResolve(() => held.promise)
  const abort = new AbortController()
  const changing = f.controller.changeQuality('dolby', { signal: abort.signal })
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.resolves.length, 1)
  abort.abort()
  assert.equal(f.resolves[0].signal?.aborted, true)
  held.resolve('twilight-media://fixture/cancelled-downgrade')
  await changing
  assert.deepEqual(f.saved, ['dolby'])
  assert.deepEqual(f.reloads, [])
})

test('pre-abort performs no preference or resolution work', async () => {
  const f = fixture()
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(f.controller.changeQuality('lossless', { signal: abort.signal }), /取消/)
  assert.deepEqual(f.saved, [])
  assert.deepEqual(f.resolves, [])
})

test('malformed persisted preference state is rejected before resolving any stream', async () => {
  const f = fixture()
  f.provider.setPlaybackQuality = async () => ({
    quality: 'dolby',
    options: [{ value: 'flac', label: 'FLAC' }]
  })
  await assert.rejects(f.controller.changeQuality('dolby'), /音质设置无效/)
  assert.deepEqual(f.resolves, [])
  assert.deepEqual(f.reloads, [])
})
