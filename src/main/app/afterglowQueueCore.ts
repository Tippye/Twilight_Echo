import type { AudioEngineQueueItem, AudioEngineQueueState } from '../../shared/audioEngineTypes.ts'
import type { CueRange } from '../../shared/cue.ts'
import type { AfterglowSourceResolver, ResolvedAfterglowSource } from './afterglowSourceResolver.ts'

/** Narrow engine surface the core needs; AudioEngineManager satisfies it. */
export interface AfterglowQueueCoreEngine {
  getPlaybackInfo: () => Promise<{
    queueIndex: number
    upcomingQueueIndex?: number
    state: string
  }>
  getQueueState: () => Promise<AudioEngineQueueState | null>
  appendQueueItems: (items: AudioEngineQueueItem[]) => Promise<number>
  updateQueueItemSource: (index: number, source: string) => Promise<boolean>
}

export interface AfterglowQueueCoreOptions {
  /** Logical queue snapshot handed over by the renderer. */
  queue: readonly unknown[]
  /** Logical index the native window currently starts on (usually mapping[0]). */
  currentLogicalIndex: number
  /** Native index -> logical index for the queue already loaded in the engine. */
  nativeQueueIndices: readonly number[]
  engine: AfterglowQueueCoreEngine
  resolver: AfterglowSourceResolver
  /** How many tracks ahead of the native cursor to keep appended. */
  lookahead?: number
  /** Refresh an upcoming provider URL when it expires within this margin. */
  refreshMarginMs?: number
  now?: () => number
  onMappingChanged?: (mapping: readonly number[]) => void
  onError?: (message: string) => void
}

const DEFAULT_LOOKAHEAD = 2
const DEFAULT_REFRESH_MARGIN_MS = 2 * 60 * 1000
const RESOLVE_RETRY_MS = 30 * 1000
const MAX_APPEND_PER_TICK = 2

const textField = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' && value ? value : undefined
}

const numberField = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const toQueueItem = (
  track: unknown,
  source: string,
  logicalIndex: number
): AudioEngineQueueItem => {
  const record = track && typeof track === 'object' ? (track as Record<string, unknown>) : {}
  const cueRange =
    record.cueRange && typeof record.cueRange === 'object'
      ? (record.cueRange as CueRange)
      : undefined
  return {
    id: textField(record, 'id') ?? `afterglow:${logicalIndex}`,
    source,
    ...(textField(record, 'title') ? { title: textField(record, 'title') } : {}),
    ...(textField(record, 'artist') ? { artist: textField(record, 'artist') } : {}),
    ...(textField(record, 'album') ? { album: textField(record, 'album') } : {}),
    ...(numberField(record, 'duration') !== undefined
      ? { duration: numberField(record, 'duration') }
      : {}),
    ...(numberField(record, 'sampleRate') !== undefined
      ? { sampleRate: numberField(record, 'sampleRate') }
      : {}),
    ...(numberField(record, 'bitrate') !== undefined
      ? { bitrate: numberField(record, 'bitrate') }
      : {}),
    ...(numberField(record, 'bitDepth') !== undefined
      ? { bitDepth: numberField(record, 'bitDepth') }
      : {}),
    ...(cueRange ? { cueRange } : {})
  }
}

/**
 * Renderer-free queue maintenance for Afterglow (Route C).
 *
 * The core never calls LoadQueue. It appends already-resolved entries and
 * refreshes the upcoming provider URL through the native hot-update contract,
 * so the active decoder stream keeps running. All work is serialized; `stop()`
 * makes every in-flight provider/append result a no-op.
 */
export class AfterglowQueueCore {
  private readonly queue: readonly unknown[]
  private readonly engine: AfterglowQueueCoreEngine
  private readonly resolver: AfterglowSourceResolver
  private readonly lookahead: number
  private readonly refreshMarginMs: number
  private readonly now: () => number
  private readonly onMappingChanged?: (mapping: readonly number[]) => void
  private readonly onError?: (message: string) => void

  private readonly mapping: number[]
  private readonly sources = new Map<number, ResolvedAfterglowSource>()
  private readonly retryAfter = new Map<number, number>()
  private nextLogicalIndex: number
  private active = false
  private generation = 0
  private lane: Promise<void> = Promise.resolve()
  private pendingTick: Promise<void> | null = null
  private lastError: string | null = null

  constructor(options: AfterglowQueueCoreOptions) {
    this.queue = options.queue
    this.engine = options.engine
    this.resolver = options.resolver
    this.lookahead = Math.max(1, options.lookahead ?? DEFAULT_LOOKAHEAD)
    this.refreshMarginMs = Math.max(0, options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS)
    this.now = options.now ?? Date.now
    this.onMappingChanged = options.onMappingChanged
    this.onError = options.onError
    this.mapping = [...options.nativeQueueIndices]
    this.nextLogicalIndex = this.mapping.length
      ? Math.max(...this.mapping) + 1
      : options.currentLogicalIndex + 1
    if (
      this.mapping.length === 0 ||
      this.mapping.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= this.queue.length
      )
    ) {
      this.lastError = 'afterglow_core_invalid_initial_mapping'
    }
  }

  isActive(): boolean {
    return this.active
  }

  getLastError(): string | null {
    return this.lastError
  }

  getMapping(): number[] {
    return [...this.mapping]
  }

  async start(): Promise<void> {
    if (this.lastError) {
      this.reportError(this.lastError)
      return
    }
    if (this.active) {
      await this.tick()
      return
    }
    this.active = true
    this.generation += 1
    await this.tick()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.generation += 1
    this.pendingTick = null
  }

  /** Coalesces concurrent ticks; provider/append work is serialized through the lane. */
  tick(): Promise<void> {
    if (!this.active) return Promise.resolve()
    if (this.pendingTick) return this.pendingTick
    const generation = this.generation
    const run = this.lane
      .then(() => this.runTick(generation))
      .catch((error) => {
        this.reportError(error instanceof Error ? error.message : String(error))
      })
    this.pendingTick = run
    void run.finally(() => {
      if (this.pendingTick === run) this.pendingTick = null
    })
    this.lane = run.catch(() => undefined)
    return run
  }

  private reportError(message: string): void {
    this.lastError = message
    console.warn('[afterglow] queue core:', message)
    this.onError?.(message)
  }

  private fail(reason: string): void {
    this.reportError(reason)
    this.active = false
    this.generation += 1
  }

  private async resolveSource(logicalIndex: number): Promise<ResolvedAfterglowSource | null> {
    const retryAt = this.retryAfter.get(logicalIndex) ?? 0
    if (this.now() < retryAt) return null
    const resolved = await this.resolver.resolve(this.queue[logicalIndex])
    if (!resolved) {
      this.retryAfter.set(logicalIndex, this.now() + RESOLVE_RETRY_MS)
      return null
    }
    this.retryAfter.delete(logicalIndex)
    return resolved
  }

  private async runTick(generation: number): Promise<void> {
    if (!this.active || generation !== this.generation) return
    const state = await this.engine.getQueueState()
    if (!this.active || generation !== this.generation) return
    if (!state) {
      // Older engine or transient service failure: keep trying on later ticks.
      return
    }
    if (state.size !== this.mapping.length) {
      this.fail(`afterglow_core_mapping_mismatch:${state.size}/${this.mapping.length}`)
      return
    }
    if (state.currentIndex < 0 || state.currentIndex >= this.mapping.length) return

    await this.refreshUpcoming(state)
    if (!this.active || generation !== this.generation) return
    await this.ensureLookahead(state)
  }

  private async refreshUpcoming(state: AudioEngineQueueState): Promise<void> {
    const upcomingNative = state.upcomingIndex
    if (upcomingNative < 0 || upcomingNative >= this.mapping.length) return
    if (upcomingNative === state.currentIndex) return
    const logicalIndex = this.mapping[upcomingNative]
    if (logicalIndex < 0) return

    const cached = this.sources.get(logicalIndex)
    const expiresAt = cached?.expiresAt
    const due =
      !cached || (typeof expiresAt === 'number' && expiresAt - this.now() <= this.refreshMarginMs)
    if (!due) return

    const resolved = await this.resolveSource(logicalIndex)
    if (!resolved) return
    if (!this.active) return
    if (cached?.source === resolved.source) {
      this.sources.set(logicalIndex, resolved)
      return
    }
    try {
      const updated = await this.engine.updateQueueItemSource(upcomingNative, resolved.source)
      if (!updated) {
        this.reportError(`afterglow_core_source_update_rejected:${upcomingNative}`)
        return
      }
      this.sources.set(logicalIndex, resolved)
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : String(error))
    }
  }

  private async ensureLookahead(state: AudioEngineQueueState): Promise<void> {
    let appended = 0
    while (
      this.active &&
      appended < MAX_APPEND_PER_TICK &&
      this.mapping.length - state.currentIndex <= this.lookahead
    ) {
      if (this.nextLogicalIndex >= this.queue.length) return
      const logicalIndex = this.nextLogicalIndex
      const resolved = await this.resolveSource(logicalIndex)
      if (!resolved) {
        this.reportError(`afterglow_core_source_unavailable:${logicalIndex}`)
        return
      }
      if (!this.active) return
      const item = toQueueItem(this.queue[logicalIndex], resolved.source, logicalIndex)
      let firstIndex: number
      try {
        firstIndex = await this.engine.appendQueueItems([item])
      } catch (error) {
        this.fail(error instanceof Error ? error.message : String(error))
        return
      }
      if (!this.active) return
      if (firstIndex !== this.mapping.length) {
        this.fail(`afterglow_core_append_index_mismatch:${firstIndex}/${this.mapping.length}`)
        return
      }
      this.mapping.push(logicalIndex)
      this.sources.set(logicalIndex, resolved)
      this.nextLogicalIndex = logicalIndex + 1
      appended += 1
      this.onMappingChanged?.(this.getMapping())
    }
  }
}
