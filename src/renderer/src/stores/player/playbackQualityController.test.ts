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
  const resolves: Array<{ track: Track; options: unknown }> = []
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
    getPlaybackUrl: async (copy, options) => {
      resolves.push({ track: copy, options })
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

test('per-track availability is rechecked before persistence; unavailable or missing choices do not write', async () => {
  for (const missing of [false, true]) {
    const f = fixture()
    f.provider.getTrackPlaybackQualities = async (track) => ({
      trackId: track.id,
      options: missing
        ? []
        : [
            {
              value: 'spatial',
              label: 'Spatial',
              availability: 'unavailable',
              reason: '该歌曲暂无此音质'
            }
          ]
    })
    await assert.rejects(
      f.controller.changeQuality('spatial'),
      missing ? /没有所选音质/ : /暂无此音质/
    )
    assert.deepEqual(f.saved, [])
    assert.deepEqual(f.resolves, [])
    assert.deepEqual(f.reloads, [])
  }
})

test('unknown catalogue evidence may be attempted and cancelled calls reach the availability owner', async () => {
  const f = fixture()
  const held =
    deferred<
      NonNullable<Awaited<ReturnType<NonNullable<MediaProvider['getTrackPlaybackQualities']>>>>
    >()
  let querySignal: AbortSignal | undefined
  f.provider.getTrackPlaybackQualities = async (_track, options) => {
    querySignal = options?.signal
    return held.promise
  }
  const abort = new AbortController()
  const changing = f.controller.changeQuality('lossless', { signal: abort.signal })
  await Promise.resolve()
  assert.deepEqual(f.saved, [])
  abort.abort()
  assert.equal(querySignal?.aborted, true)
  held.resolve({
    trackId: f.track.id,
    options: [{ value: 'lossless', label: 'Lossless', availability: 'unknown' }]
  })
  await changing
  assert.deepEqual(f.saved, [])
  f.provider.getTrackPlaybackQualities = async (track) => ({
    trackId: track.id,
    options: [{ value: 'lossless', label: 'Lossless', availability: 'unknown' }]
  })
  await f.controller.changeQuality('lossless')
  assert.deepEqual(f.saved, ['lossless'])
  assert.equal(f.reloads.length, 1)
})

test('a changed owner while availability is held cannot write or reload; pre-abort performs no work', async () => {
  for (const drift of ['entry', 'provider', 'new-selection']) {
    const f = fixture()
    const held =
      deferred<
        NonNullable<Awaited<ReturnType<NonNullable<MediaProvider['getTrackPlaybackQualities']>>>>
      >()
    let queried = 0
    let firstSignal: AbortSignal | undefined
    f.provider.getTrackPlaybackQualities = async (track, options) => {
      if (++queried === 1) {
        firstSignal = options?.signal
        return held.promise
      }
      return {
        trackId: track.id,
        options: [{ value: 'latest', label: 'Latest', availability: 'candidate' }]
      }
    }
    const changing = f.controller.changeQuality('lossless')
    await Promise.resolve()
    if (drift === 'entry') f.replaceTrack({ ...f.track, queueEntryId: 'next-copy' })
    if (drift === 'provider') f.invalidate()
    if (drift === 'new-selection') {
      await f.controller.changeQuality('latest')
      assert.equal(firstSignal?.aborted, true)
    }
    held.resolve({
      trackId: 'fake:song',
      options: [{ value: 'lossless', label: 'Lossless', availability: 'candidate' }]
    })
    await changing
    assert.deepEqual(f.saved, drift === 'new-selection' ? ['latest'] : [], drift)
    assert.equal(f.reloads.length, drift === 'new-selection' ? 1 : 0, drift)
  }
  const f = fixture()
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(f.controller.changeQuality('lossless', { signal: abort.signal }), /取消/)
  assert.deepEqual(f.saved, [])
})

test('mismatched catalogue identities and malformed options fail before changing preference', async () => {
  const f = fixture()
  f.provider.getTrackPlaybackQualities = async () => ({
    trackId: 'fake:other',
    options: [{ value: 'lossless', label: 'Lossless', availability: 'candidate' }]
  })
  await assert.rejects(f.controller.changeQuality('lossless'), /音质列表无效/)
  assert.deepEqual(f.saved, [])
})
