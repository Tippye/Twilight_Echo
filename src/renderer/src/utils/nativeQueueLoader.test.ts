import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeQueueLoader } from './nativeQueueLoader.ts'
import type { Track } from '../types/music'

function tracks(count: number): Track[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `local:${index}`,
        source: 'local',
        filePath: `D:/Music/${index}.flac`,
        duration: 240
      }) as Track
  )
}

test('manual selections reuse one committed 5000-item queue with fresh current-file checks', async () => {
  const loader = new NativeQueueLoader(),
    queue = tracks(5000)
  let batches = 0,
    targets = 0,
    singles = 0,
    loads = 0,
    selections = 0
  const boundary = {
    isAudioFileAuthorized: async () => {
      singles++
      return true
    },
    areAudioFilesAuthorized: async (paths: string[]) => {
      batches++
      targets += paths.length
      return paths.map(() => true)
    }
  }
  const api = {
    loadQueue: async () => {
      loads++
      return { queueToken: 'main-owned-version' }
    },
    selectQueueItem: async ({ queueToken, index }: { queueToken: string; index: number }) => {
      assert.equal(queueToken, 'main-owned-version')
      assert.equal(index, ++selections)
      return true
    }
  }
  for (let index = 0; index < 13; ++index) {
    const prepared = await loader.prepareAndLoad(
      {
        queue,
        currentTrack: queue[index],
        currentTarget: queue[index].filePath,
        currentIndex: index
      },
      boundary,
      api
    )
    assert.equal(prepared?.delegated, true)
  }
  assert.deepEqual(
    { batches, targets, singles, loads, selections },
    { batches: 1, targets: 5000, singles: 13, loads: 1, selections: 12 }
  )
  queue[4].replayGainTrackGainDb = -4
  await loader.prepareAndLoad(
    { queue, currentTrack: queue[0], currentTarget: queue[0].filePath, currentIndex: 0 },
    boundary,
    api
  )
  assert.equal(loads, 2)
  assert.equal(batches, 2)
})

test('stale queue authority repeats availability checks and degrades an unavailable companion', async () => {
  const loader = new NativeQueueLoader(),
    queue = tracks(2)
  let available = true,
    loads = 0,
    lastItems = 0,
    batches = 0
  const api = {
    loadQueue: async (items: unknown[]) => {
      loads++
      lastItems = items.length
      return { queueToken: 'version' }
    },
    selectQueueItem: async () => false
  }
  const boundary = {
    isAudioFileAuthorized: async () => true,
    areAudioFilesAuthorized: async () => {
      batches++
      return [true, available]
    }
  }
  const options = {
    queue,
    currentTrack: queue[0],
    currentTarget: queue[0].filePath,
    currentIndex: 0
  }
  await loader.prepareAndLoad(options, boundary, api)
  available = false
  const prepared = await loader.prepareAndLoad(options, boundary, api)
  assert.equal(prepared?.delegated, false)
  assert.deepEqual({ loads, lastItems, batches }, { loads: 2, lastItems: 1, batches: 2 })
})

test('duplicate sources preserve selected CUE index and range; changes invalidate content', async () => {
  const loader = new NativeQueueLoader(),
    queue = tracks(2)
  queue[1].filePath = queue[0].filePath
  queue[0].cueRange = { startSeconds: 0, endSeconds: 10 } as Track['cueRange']
  queue[1].cueRange = { startSeconds: 10, endSeconds: 20 } as Track['cueRange']
  let loads = 0
  const api = {
    loadQueue: async () => {
      loads++
      return { queueToken: 'cue-version' }
    },
    selectQueueItem: async ({ index, id }: { index: number; id: string }) => {
      assert.equal(index, 1)
      assert.equal(id, queue[1].id)
      return true
    }
  }
  const boundary = { isAudioFileAuthorized: async () => true }
  const select = (index: number) =>
    loader.prepareAndLoad(
      {
        queue,
        currentTrack: queue[index],
        currentTarget: queue[index].filePath,
        currentIndex: index
      },
      boundary,
      api
    )
  await select(0)
  await select(1)
  assert.equal(loads, 1)
  queue[1].cueRange!.endSeconds = 21
  await select(1)
  assert.equal(loads, 2)
})

test('superseded preparation never commits a queue', async () => {
  const loader = new NativeQueueLoader(),
    queue = tracks(2)
  let current = true,
    loads = 0
  const prepared = await loader.prepareAndLoad(
    {
      queue,
      currentTrack: queue[0],
      currentTarget: queue[0].filePath,
      currentIndex: 0,
      isCurrent: () => current
    },
    {
      isAudioFileAuthorized: async () => true,
      areAudioFilesAuthorized: async () => {
        current = false
        return [true, true]
      }
    },
    {
      loadQueue: async () => {
        loads++
      }
    }
  )
  assert.equal(prepared, null)
  assert.equal(loads, 0)
})

test('legacy APIs without cursor selection retain full availability checks', async () => {
  const loader = new NativeQueueLoader(),
    queue = tracks(2)
  let batches = 0,
    available = true
  const boundary = {
    isAudioFileAuthorized: async () => true,
    areAudioFilesAuthorized: async () => {
      batches++
      return [available, true]
    }
  }
  const api = { loadQueue: async () => ({ queueToken: 'legacy' }) }
  const options = {
    queue,
    currentTrack: queue[1],
    currentTarget: queue[1].filePath,
    currentIndex: 1
  }
  assert.equal((await loader.prepareAndLoad(options, boundary, api))?.delegated, true)
  available = false
  assert.equal((await loader.prepareAndLoad(options, boundary, api))?.delegated, false)
  assert.equal(batches, 2)
})

test('partial native queues map versioned indices to duplicate logical occurrences', async () => {
  const loader = new NativeQueueLoader()
  const queue = tracks(4)
  queue[0].id = queue[3].id = 'ncm:same'
  queue.forEach((track, index) => {
    track.queueEntryId = `entry:${index}`
  })
  const prepared = {
    items: [
      { id: queue[3].id, source: 'twilight-media://audio/last' },
      { id: queue[0].id, source: 'twilight-media://audio/first' }
    ],
    startIndex: 0,
    delegated: false,
    queueIndices: [3, 0]
  }
  await loader.loadPrepared(prepared, { loadQueue: async () => ({ queueToken: 'window' }) }, queue)
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'window' }, queue), 3)
  assert.equal(loader.findLogicalIndex({ queueIndex: 1, queueToken: 'window' }, queue), 0)
  assert.equal(loader.findLogicalIndex({ queueIndex: 1, queueToken: 'old-window' }, queue), -1)
  assert.equal(loader.findLogicalIndex({ queueIndex: 1 }, queue), -1)
  queue[0] = { ...queue[0], queueEntryId: 'replacement' }
  assert.equal(loader.findLogicalIndex({ queueIndex: 1, queueToken: 'window' }, queue), -1)
  assert.equal(loader.playMode('listLoop'), 'sequential')
  loader.clear()
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'window' }, queue), -1)
})

test('a QQ singleton retains its non-first logical index and entry authority', async () => {
  const loader = new NativeQueueLoader()
  const queue = tracks(3).map((track, index) => ({
    ...track,
    id: `qq:${index}`,
    source: 'qq' as const,
    filePath: `qq:${index}`,
    queueEntryId: `entry:${index}`,
    streamUrl: index === 1 ? 'twilight-media://audio/current' : null
  }))
  const prepared = await loader.prepareAndLoad(
    {
      queue,
      currentTrack: queue[1],
      currentTarget: queue[1].streamUrl!,
      currentIndex: 1,
      playMode: 'listLoop'
    },
    { isAudioFileAuthorized: async () => false },
    { loadQueue: async () => ({ queueToken: 'qq-singleton' }) }
  )
  assert.equal(prepared?.items.length, 1)
  assert.equal(prepared?.delegated, false)
  assert.deepEqual(prepared?.queueIndices, [1])
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'qq-singleton' }, queue), 1)
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'old-token' }, queue), -1)
  assert.equal(loader.findLogicalIndex({ queueIndex: 0 }, queue), -1)
  assert.equal(loader.playMode('listLoop'), 'sequential')
  assert.equal(loader.playMode('repeat'), 'repeat')
  queue[1] = { ...queue[1], queueEntryId: 'replacement-entry' }
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'qq-singleton' }, queue), -1)
})

test('local singleton degradation binds the selected duplicate occurrence, not the first id', async () => {
  const loader = new NativeQueueLoader()
  const queue = tracks(3).map((track, index) => ({
    ...track,
    id: 'local:same',
    queueEntryId: `entry:${index}`
  }))
  const prepared = await loader.prepareAndLoad(
    { queue, currentTrack: queue[2], currentTarget: queue[2].filePath, currentIndex: 2 },
    {
      isAudioFileAuthorized: async (path) => path === queue[2].filePath,
      areAudioFilesAuthorized: async (paths) => paths.map((path) => path === queue[2].filePath)
    },
    { loadQueue: async () => ({ queueToken: 'local-singleton' }) }
  )
  assert.deepEqual(prepared?.queueIndices, [2])
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'local-singleton' }, queue), 2)
  assert.equal(loader.findLogicalIndex({ queueIndex: 1, queueToken: 'local-singleton' }, queue), -1)
})

test('a current track outside the logical queue does not acquire a fabricated index', async () => {
  const loader = new NativeQueueLoader()
  const queue = tracks(2)
  const current = { ...tracks(1)[0], id: 'local:outside', filePath: 'D:/Music/outside.flac' }
  const prepared = await loader.prepareAndLoad(
    { queue, currentTrack: current, currentTarget: current.filePath, currentIndex: 1 },
    { isAudioFileAuthorized: async () => true },
    { loadQueue: async () => ({ queueToken: 'outside' }) }
  )
  assert.deepEqual(prepared?.queueIndices, [-1])
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'outside' }, queue), -1)
})

test('a stale selected index uses exact occurrence identity and never guesses duplicate ids', async () => {
  const queue = tracks(3).map((track, index) => ({
    ...track,
    id: index === 0 ? 'qq:unresolved' : 'qq:same',
    source: 'qq' as const,
    filePath: index === 0 ? 'qq:unresolved' : 'qq:same',
    queueEntryId: `entry:${index}`,
    streamUrl: index === 0 ? null : 'twilight-media://audio/shared'
  }))
  for (const [current, expected] of [
    [queue[2], 2],
    [{ ...queue[2], queueEntryId: undefined }, -1],
    [{ ...queue[2], queueEntryId: 'outside-entry' }, -1]
  ] as const) {
    const loader = new NativeQueueLoader()
    const prepared = await loader.prepareAndLoad(
      { queue, currentTrack: current, currentTarget: current.streamUrl!, currentIndex: 99 },
      { isAudioFileAuthorized: async () => false },
      { loadQueue: async () => ({ queueToken: 'occurrences' }) }
    )
    assert.deepEqual(prepared?.queueIndices, [expected])
    assert.equal(
      loader.findLogicalIndex({ queueIndex: 0, queueToken: 'occurrences' }, queue),
      expected
    )
  }
  const loader = new NativeQueueLoader()
  await loader.prepareAndLoad(
    { queue, currentTrack: queue[2], currentTarget: queue[2].streamUrl!, currentIndex: 1 },
    { isAudioFileAuthorized: async () => false },
    { loadQueue: async () => ({ queueToken: 'stale-index' }) }
  )
  assert.equal(loader.findLogicalIndex({ queueIndex: 0, queueToken: 'stale-index' }, queue), 2)
})
