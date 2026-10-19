import assert from 'node:assert/strict'
import test from 'node:test'
import type { AudioEngineQueueItem, AudioEngineQueueState } from '../../shared/audioEngineTypes.ts'
import type { AfterglowQueueCoreEngine } from './afterglowQueueCore.ts'
import { AfterglowQueueCore } from './afterglowQueueCore.ts'
import type { AfterglowSourceResolver, ResolvedAfterglowSource } from './afterglowSourceResolver.ts'

const track = (index: number): Record<string, unknown> => ({
  id: `ncm:${index}`,
  title: `Track ${index}`,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  filePath: `ncm:${index}`,
  source: 'ncm'
})

class FakeEngine implements AfterglowQueueCoreEngine {
  items: AudioEngineQueueItem[]
  currentIndex = 0
  revision = 1
  appendCalls: AudioEngineQueueItem[][] = []
  updates: Array<{ index: number; source: string }> = []
  appendError: Error | null = null

  constructor(initial: AudioEngineQueueItem[]) {
    this.items = initial.map((item) => ({ ...item }))
  }

  async getPlaybackInfo(): Promise<{
    queueIndex: number
    upcomingQueueIndex?: number
    state: string
  }> {
    return {
      queueIndex: this.currentIndex,
      upcomingQueueIndex: this.upcomingIndex(),
      state: 'playing'
    }
  }

  async getQueueState(): Promise<AudioEngineQueueState | null> {
    return {
      revision: this.revision,
      size: this.items.length,
      currentIndex: this.currentIndex,
      upcomingIndex: this.upcomingIndex(),
      playMode: 'sequential'
    }
  }

  async appendQueueItems(items: AudioEngineQueueItem[]): Promise<number> {
    if (this.appendError) throw this.appendError
    const firstIndex = this.items.length
    this.items.push(...items.map((item) => ({ ...item })))
    this.revision += 1
    this.appendCalls.push(items)
    return firstIndex
  }

  async updateQueueItemSource(index: number, source: string): Promise<boolean> {
    const item = this.items[index]
    if (!item || index === this.currentIndex) return false
    this.items[index] = { ...item, source }
    this.updates.push({ index, source })
    this.revision += 1
    return true
  }

  private upcomingIndex(): number {
    return this.currentIndex + 1 < this.items.length ? this.currentIndex + 1 : -1
  }
}

class FakeResolver implements AfterglowSourceResolver {
  calls: number[] = []
  sources = new Map<number, ResolvedAfterglowSource>()
  failOn = new Set<number>()

  async resolve(trackValue: unknown): Promise<ResolvedAfterglowSource | null> {
    const index = Number(String((trackValue as { id?: string }).id ?? '').split(':')[1])
    this.calls.push(index)
    if (this.failOn.has(index)) return null
    const configured = this.sources.get(index)
    if (configured) return configured
    return { source: `https://cdn.test/${index}.flac`, expiresAt: Date.now() + 10 * 60_000 }
  }
}

const initialEngine = (): FakeEngine =>
  new FakeEngine([
    { id: 'ncm:0', source: 'https://cdn.test/0.flac' },
    { id: 'ncm:1', source: 'https://cdn.test/1.flac' }
  ])

test('lookahead appends resolved entries without reloading the native queue', async () => {
  const engine = initialEngine()
  const resolver = new FakeResolver()
  const mappings: number[][] = []
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1), track(2), track(3)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver,
    lookahead: 2,
    onMappingChanged: (mapping) => mappings.push([...mapping])
  })

  await core.start()
  assert.deepEqual(core.getMapping(), [0, 1, 2])
  assert.equal(engine.appendCalls.length, 1)
  assert.deepEqual(
    engine.appendCalls[0].map((item) => item.id),
    ['ncm:2']
  )
  assert.equal(engine.items[2].source, 'https://cdn.test/2.flac')
  assert.deepEqual(mappings, [[0, 1, 2]])

  // The cursor advances: the window has room again, so the next entry appends.
  engine.currentIndex = 1
  await core.tick()
  assert.deepEqual(core.getMapping(), [0, 1, 2, 3])
  assert.deepEqual(
    engine.appendCalls[1].map((item) => item.id),
    ['ncm:3']
  )
  assert.equal(engine.items.length, 4)

  // Queue end: no further append, and the core stays healthy.
  engine.currentIndex = 3
  await core.tick()
  assert.deepEqual(core.getMapping(), [0, 1, 2, 3])
  assert.equal(core.getLastError(), null)
  assert.equal(core.isActive(), true)
  core.stop()
})

test('upcoming URL is refreshed before it expires and again when TTL runs out', async () => {
  let now = 1_000_000
  const engine = initialEngine()
  const resolver = new FakeResolver()
  resolver.sources.set(1, { source: 'https://cdn.test/1-fresh.flac', expiresAt: now + 10_000 })
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1), track(2)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver,
    lookahead: 2,
    refreshMarginMs: 2_000,
    now: () => now
  })

  await core.start()
  assert.deepEqual(engine.updates, [{ index: 1, source: 'https://cdn.test/1-fresh.flac' }])

  // Still outside the refresh margin: no redundant update.
  now += 5_000
  await core.tick()
  assert.equal(engine.updates.length, 1)

  // Inside the margin: resolve again and hot-update the same native slot.
  resolver.sources.set(1, { source: 'https://cdn.test/1-renewed.flac', expiresAt: now + 20_000 })
  now += 4_000
  await core.tick()
  assert.deepEqual(engine.updates.at(-1), { index: 1, source: 'https://cdn.test/1-renewed.flac' })
  assert.equal(engine.items[1].source, 'https://cdn.test/1-renewed.flac')
  core.stop()
})

test('does not update the current item when repeat leaves upcoming on the cursor', async () => {
  const engine = initialEngine()
  engine.currentIndex = 0
  const resolver = new FakeResolver()
  const core = new AfterglowQueueCore({
    queue: [track(0)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0],
    engine,
    resolver
  })
  await core.start()
  assert.deepEqual(engine.updates, [])
  core.stop()
})

test('append failures stop maintenance instead of leaving a half-applied mapping', async () => {
  const engine = initialEngine()
  engine.appendError = new Error('append rejected')
  const resolver = new FakeResolver()
  const errors: string[] = []
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1), track(2)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver,
    onError: (message) => errors.push(message)
  })
  await core.start()
  assert.equal(core.isActive(), false)
  assert.equal(core.getMapping().length, 2)
  assert.match(errors[0] ?? '', /append rejected/)
})

test('mapping drift is treated as a fatal engine-state mismatch', async () => {
  const engine = initialEngine()
  const resolver = new FakeResolver()
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver
  })
  engine.items.push({ id: 'external', source: 'external.flac' })
  await core.start()
  assert.equal(core.isActive(), false)
  assert.match(core.getLastError() ?? '', /mapping_mismatch/)
})

test('stop during an in-flight resolve prevents append and source update', async () => {
  const engine = initialEngine()
  const gate: {
    release: ((value: ResolvedAfterglowSource | null) => void) | null
    started: (() => void) | null
  } = { release: null, started: null }
  const resolver: AfterglowSourceResolver = {
    resolve: () =>
      new Promise<ResolvedAfterglowSource | null>((resolve) => {
        gate.release = resolve
        gate.started?.()
      })
  }
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1), track(2)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver
  })
  const waiting = new Promise<void>((resolve) => {
    gate.started = resolve
  })
  const starting = core.start()
  await waiting
  core.stop()
  gate.release?.({ source: 'https://cdn.test/late.flac', expiresAt: Date.now() + 60_000 })
  await starting
  assert.equal(engine.appendCalls.length, 0)
  assert.deepEqual(engine.updates, [])
  assert.deepEqual(core.getMapping(), [0, 1])
})

test('stop cancels further provider work and queue mutation', async () => {
  const engine = initialEngine()
  const resolver = new FakeResolver()
  const core = new AfterglowQueueCore({
    queue: [track(0), track(1), track(2)],
    currentLogicalIndex: 0,
    nativeQueueIndices: [0, 1],
    engine,
    resolver
  })
  await core.start()
  const appended = engine.appendCalls.length
  const resolved = resolver.calls.length
  core.stop()
  await core.tick()
  assert.equal(engine.appendCalls.length, appended)
  assert.equal(resolver.calls.length, resolved)
})
