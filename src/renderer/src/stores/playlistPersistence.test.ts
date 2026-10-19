import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PlaylistPersistence, type PlaylistPersistenceStatus } from './playlistPersistence.ts'

class FakeTimers {
  private nextId = 1
  private readonly callbacks = new Map<number, () => void>()

  setTimeout = (callback: () => void): ReturnType<typeof setTimeout> => {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    return id as unknown as ReturnType<typeof setTimeout>
  }

  clearTimeout = (id: ReturnType<typeof setTimeout>): void => {
    this.callbacks.delete(id as unknown as number)
  }

  get pendingCount(): number {
    return this.callbacks.size
  }

  runNext(): void {
    const next = this.callbacks.entries().next().value as [number, () => void] | undefined
    if (!next) throw new Error('No timer queued')
    this.callbacks.delete(next[0])
    next[1]()
  }
}

test('playlist persistence snapshots at enqueue and commits 5000 mutations as one trailing write', async () => {
  const timers = new FakeTimers()
  const writes: Array<{ ids: string[] }> = []
  const statuses: PlaylistPersistenceStatus[] = []
  const persistence = new PlaylistPersistence<{ ids: string[] }>({
    write: async (snapshot) => {
      writes.push(snapshot)
    },
    onStatus: (status) => statuses.push(status),
    flushDelayMs: 250,
    retryDelayMs: 1_000,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout
  })

  const startedAt = performance.now()
  const snapshot = { ids: Array.from({ length: 5_000 }, (_, id) => `track-${id}`) }
  persistence.enqueue(snapshot)
  snapshot.ids[0] = 'mutated-after-enqueue'
  const elapsedMs = performance.now() - startedAt

  assert.equal(timers.pendingCount, 1)
  timers.runNext()
  await persistence.flush()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].ids.length, 5_000)
  assert.equal(writes[0].ids[0], 'track-0')
  assert.equal(writes[0].ids.at(-1), 'track-4999')
  assert.equal(statuses.at(-1)?.state, 'idle')
  assert.ok(elapsedMs < 5_000, `5000 enqueue operations took ${elapsedMs.toFixed(1)}ms`)
})

test('exit flush commits the final playlist mutation before its debounce timer fires', async () => {
  const timers = new FakeTimers()
  const writes: string[] = []
  const persistence = new PlaylistPersistence<{ name: string }>({
    write: async (snapshot) => {
      writes.push(snapshot.name)
    },
    flushDelayMs: 250,
    retryDelayMs: 1_000,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout
  })

  persistence.enqueue({ name: 'created-immediately-before-exit' })
  assert.equal(timers.pendingCount, 1)

  assert.equal(await persistence.flush(), true)
  assert.deepEqual(writes, ['created-immediately-before-exit'])
  assert.equal(timers.pendingCount, 0)
})

test('application close coordinator awaits the playlist exit flush', () => {
  const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8')

  assert.match(
    appSource,
    /onSavePlaybackSession\(async \([^)]*\) => \{[\s\S]*await flushPlaylistsForExit\(\)[\s\S]*savePlaybackSessionForQuit\(\)/
  )
  assert.match(
    appSource,
    /async function flushPlaylistsForExit\(\): Promise<void> \{[\s\S]*await flushPlaylists\(\)/
  )
  assert.match(appSource, /quitFlushHandler = flushPendingPersistenceForExit/)
  assert.match(appSource, /pageHideFlushHandler = flushPendingPersistenceForExit/)
})

test('playlist persistence serializes snapshots in enqueue order', async () => {
  const timers = new FakeTimers()
  const writes: string[] = []
  const persistence = new PlaylistPersistence<{ version: string }>({
    write: async (snapshot) => {
      writes.push(snapshot.version)
    },
    flushDelayMs: 1,
    retryDelayMs: 1,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout
  })

  persistence.enqueue({ version: 'first' })
  timers.runNext()
  await persistence.flush()
  persistence.enqueue({ version: 'second' })
  timers.runNext()
  await persistence.flush()

  assert.deepEqual(writes, ['first', 'second'])
})

test('playlist persistence retains dirty data after failure and allows a later action to recover', async () => {
  const timers = new FakeTimers()
  const writes: string[] = []
  const statuses: PlaylistPersistenceStatus[] = []
  let failuresRemaining = 1
  const persistence = new PlaylistPersistence<{ version: string }>({
    write: async (snapshot) => {
      writes.push(snapshot.version)
      if (failuresRemaining-- > 0) throw new Error('disk unavailable')
    },
    onStatus: (status) => statuses.push(status),
    flushDelayMs: 1,
    retryDelayMs: 1,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout
  })

  persistence.enqueue({ version: 'failed' })
  assert.equal(await persistence.flush(), false)
  assert.equal(statuses.at(-1)?.state, 'error')
  assert.equal(statuses.at(-1)?.dirty, true)

  persistence.enqueue({ version: 'recovered' })
  assert.equal(await persistence.flush(), true)
  assert.deepEqual(writes, ['failed', 'recovered'])
  assert.deepEqual(statuses.at(-1), {
    state: 'idle',
    dirty: false,
    failureCount: 0,
    lastError: null
  })
})

test('a failed in-flight transaction rebases a queued newer snapshot to the original base', async () => {
  const timers = new FakeTimers()
  const writes: Array<{ snapshot: string; base: string }> = []
  let rejectFirstWrite!: (error: Error) => void
  let signalFirstWrite!: () => void
  const firstWriteStarted = new Promise<void>((resolve) => {
    signalFirstWrite = resolve
  })
  const firstWrite = new Promise<void>((_resolve, reject) => {
    rejectFirstWrite = reject
  })
  const persistence = new PlaylistPersistence<{ value: string }>({
    write: async (snapshot, base) => {
      writes.push({ snapshot: snapshot.value, base: base.value })
      if (writes.length === 1) {
        signalFirstWrite()
        await firstWrite
      }
    },
    flushDelayMs: 1,
    retryDelayMs: 1,
    setTimeout: timers.setTimeout as typeof globalThis.setTimeout,
    clearTimeout: timers.clearTimeout as typeof globalThis.clearTimeout
  })

  persistence.enqueue({ value: 'first' }, { value: 'base' })
  timers.runNext()
  await firstWriteStarted

  // This second state was calculated from `first`, but the first write never
  // reached storage. It must therefore replay from `base` on retry.
  persistence.enqueue({ value: 'second' }, { value: 'first' })
  rejectFirstWrite(new Error('disk unavailable'))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(writes, [{ snapshot: 'first', base: 'base' }])
  assert.equal(await persistence.flush(), true)
  assert.deepEqual(writes, [
    { snapshot: 'first', base: 'base' },
    { snapshot: 'second', base: 'base' }
  ])
})
