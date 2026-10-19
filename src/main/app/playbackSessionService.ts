import type { PlaybackSession } from '../core/types.ts'
import { runtime } from '../core/runtime.ts'
import { getPlaybackSessionStoreBundle } from '../persistence/playbackSessionStore.ts'
import { PersistentDataRevisionConflictError } from '../../shared/versionedPersistence.ts'
import {
  resolveAfterglowQueueIndex,
  afterglowTrackPathOf,
  type AfterglowRendererSnapshot
} from '../../shared/afterglowMode.ts'

export interface LoadedPlaybackSession {
  session: PlaybackSession
  revision: number
}

export interface EnginePlaybackState {
  state: 'stopped' | 'playing' | 'paused'
  position: number
  queueIndex: number
  source: string
  playMode?: string
}

const POSITION_PERSIST_INTERVAL_MS = 5_000
const MAX_CAS_RETRIES = 2

/**
 * Keeps `playback-session.json` authoritative while no renderer exists.
 *
 * The renderer normally writes this file. During Afterglow the main process is
 * the only writer, so it caches one revision and writes track/position changes
 * back with the same compare-and-swap contract the IPC path uses.
 */
class PlaybackSessionService {
  private cached: LoadedPlaybackSession | null = null
  private lastPositionWriteAt = 0
  private writeTail: Promise<void> = Promise.resolve()
  /**
   * The queue is written once when a renderer snapshot is adopted. Later track
   * and position writes omit it so a 32 MB queue file is not rewritten on every
   * persistence tick.
   */
  private queueDirty = false
  /**
   * True when the session exists only for this Afterglow run. Users with
   * playback-resume disabled must not get a resume record written on their behalf.
   */
  private memoryOnly = false

  /** Asks the renderer to flush navigation + playback state before it unloads. */
  async flushFromRenderer(options: { includeQueue?: boolean } = {}): Promise<void> {
    const { requestRendererPlaybackSessionSave } = await import('./window')
    await requestRendererPlaybackSessionSave(options)
  }

  async load(): Promise<LoadedPlaybackSession | null> {
    const { storage } = getPlaybackSessionStoreBundle()
    const envelope = await storage.load()
    this.memoryOnly = false
    this.queueDirty = false
    if (!envelope?.data) {
      this.cached = null
      return null
    }
    const session = envelope.data
    if (!Array.isArray(session.queue) || session.queue.length === 0) {
      this.cached = null
      return null
    }
    this.cached = { session, revision: envelope.revision }
    return this.cached
  }

  /**
   * Adopts the renderer's pre-unload snapshot. With playback resume enabled the
   * existing session envelope (and its revision) is reused so position/track
   * updates survive an unexpected exit; with resume disabled the snapshot lives
   * in memory only and is dropped when the UI comes back.
   */
  async adoptRendererSnapshot(snapshot: AfterglowRendererSnapshot): Promise<void> {
    const nextSession: PlaybackSession = {
      version: 1,
      savedAt: new Date().toISOString(),
      mode: 'trackAndPosition',
      playMode: normalizePersistedPlayMode(snapshot.playMode, undefined),
      track: snapshot.track,
      position: snapshot.position,
      queue: snapshot.queue,
      queueIndex: snapshot.queueIndex
    }
    if (runtime.appSettings.playbackResumeMode === 'off') {
      this.memoryOnly = true
      this.queueDirty = false
      this.cached = { session: nextSession, revision: 0 }
      return
    }
    try {
      const { storage } = getPlaybackSessionStoreBundle()
      const envelope = await storage.load()
      this.memoryOnly = false
      this.queueDirty = true
      this.cached = {
        session: {
          ...(envelope?.data ?? nextSession),
          ...nextSession,
          mode: envelope?.data?.mode ?? nextSession.mode
        },
        revision: envelope?.revision ?? 0
      }
      await this.writeCurrent()
    } catch (error) {
      // The in-memory snapshot is sufficient for Afterglow. A locked, corrupt
      // or read-only playback-session store must not block the UI unload; keep
      // serving restore/handoff from memory and skip further disk writes.
      console.warn(
        '[afterglow] playback session persistence unavailable; continuing in memory:',
        error
      )
      this.memoryOnly = true
      if (!this.cached) this.cached = { session: nextSession, revision: 0 }
    }
  }

  /** Drops a memory-only session once the UI has adopted it again. */
  clearRuntimeSnapshot(): void {
    if (!this.memoryOnly) return
    this.memoryOnly = false
    this.queueDirty = false
    this.cached = null
  }

  getCachedSession(): PlaybackSession | null {
    return this.cached?.session ?? null
  }

  getCachedQueue(): unknown[] {
    const queue = this.cached?.session.queue
    return Array.isArray(queue) ? queue : []
  }

  /**
   * Mirrors the engine onto the persisted session. Track changes are written
   * immediately; position-only updates are throttled so a 4Hz status stream does
   * not turn into a 4Hz disk write.
   */
  applyEngineState(
    status: EnginePlaybackState,
    options: { force?: boolean; logicalIndex?: number } = {}
  ): void {
    const cached = this.cached
    if (!cached) return
    const queue = Array.isArray(cached.session.queue) ? cached.session.queue : []
    const resolved =
      typeof options.logicalIndex === 'number' &&
      Number.isInteger(options.logicalIndex) &&
      options.logicalIndex >= 0 &&
      options.logicalIndex < queue.length
        ? options.logicalIndex
        : resolveAfterglowQueueIndex(queue, status)
    const index = resolved
    if (index < 0) return

    const track = queue[index]
    const trackChanged =
      cached.session.track !== track ||
      cached.session.queueIndex !== index ||
      afterglowTrackPathOf(cached.session.track) !== afterglowTrackPathOf(track)
    const now = Date.now()
    const positionDue = now - this.lastPositionWriteAt >= POSITION_PERSIST_INTERVAL_MS
    if (!options.force && !trackChanged && !positionDue) return

    cached.session = {
      ...cached.session,
      savedAt: new Date(now).toISOString(),
      track,
      queueIndex: index,
      position: Number.isFinite(status.position) ? Math.max(0, status.position) : 0,
      playMode: normalizePersistedPlayMode(status.playMode, cached.session.playMode)
    }
    if (this.memoryOnly) return
    this.lastPositionWriteAt = now
    if (trackChanged) {
      this.enqueueWrite({ force: true })
      return
    }
    this.enqueueWrite({ force: false })
  }

  /** Flushes any pending engine-state change before the process exits or restores. */
  async flush(): Promise<void> {
    if (this.memoryOnly) return
    await this.writeTail
    await this.writeCurrent()
  }

  private enqueueWrite(options: { force: boolean }): void {
    if (options.force) this.lastPositionWriteAt = Date.now()
    this.writeTail = this.writeTail.then(
      () =>
        this.writeCurrent().catch((error) => {
          console.warn('[afterglow] failed to persist playback session:', error)
        }),
      () => undefined
    )
  }

  private async writeCurrent(): Promise<void> {
    const cached = this.cached
    if (!cached || this.memoryOnly) return
    const { storage } = getPlaybackSessionStoreBundle()
    for (let attempt = 0; attempt <= MAX_CAS_RETRIES; attempt += 1) {
      try {
        const saved = await storage.save(
          this.queueDirty ? cached.session : { ...cached.session, queue: undefined },
          cached.revision
        )
        this.queueDirty = false
        cached.revision = saved.revision
        return
      } catch (error) {
        if (!(error instanceof PersistentDataRevisionConflictError)) throw error
        // Another writer (a still-alive renderer, or a personal restore) moved
        // the revision. Adopt it and retry with our in-memory state.
        const current = error.current
        if (!current || !current.data) return
        cached.revision = current.revision
      }
    }
  }
}

const normalizePersistedPlayMode = (
  value: string | undefined,
  fallback: PlaybackSession['playMode']
): PlaybackSession['playMode'] => {
  return value === 'sequential' ||
    value === 'listLoop' ||
    value === 'repeat' ||
    value === 'shuffle' ||
    value === 'heart'
    ? value
    : fallback
}

export const playbackSessionService = new PlaybackSessionService()
