import type { NativeQueueCommit, NativeQueueSelection } from '../../../shared/nativeQueue.ts'
import type { Track } from '../types/music'
import type { PlayMode } from '../types/settings'
import { toNativePlayMode } from '../../../shared/playbackModes.ts'
import {
  preparePlayerNativeQueue,
  type NativeQueueLoadItem,
  type PreparedNativeQueue,
  type PreparePlayerNativeQueueOptions,
  type PlayerNativeQueueBoundary
} from './nativeQueuePreparation.ts'

interface QueueApi {
  loadQueue: (items: NativeQueueLoadItem[], index: number) => Promise<NativeQueueCommit | void>
  selectQueueItem?: (selection: NativeQueueSelection) => Promise<boolean>
}

/** Retains one content version, with authority to reuse held by main. */
type CommittedEntry = { id: string; queueEntryId?: string; index: number } | null

export class NativeQueueLoader {
  private committed: {
    json: string
    token: string
    window: boolean
    entries: CommittedEntry[]
  } | null = null

  clear(): void {
    this.committed = null
  }

  /**
   * Afterglow restore: adopt the queue identity the engine already holds so
   * later playback-info events map back onto this renderer's logical queue
   * without reloading the native queue. `nativeQueueIndices` describes a
   * current+next window (online queues); without it the mapping is identity.
   */
  adopt(
    queue: readonly Track[],
    info: { queueIndex: number; queueToken?: string; nativeQueueIndices?: readonly number[] }
  ): void {
    const indices =
      info.nativeQueueIndices && info.nativeQueueIndices.length > 0
        ? [...info.nativeQueueIndices]
        : queue.map((_, index) => index)
    this.committed = {
      json: '',
      token: info.queueToken ?? '',
      window: indices.length !== queue.length,
      entries: indices.map((index) => {
        const track = queue[index]
        return track ? { id: track.id, index, queueEntryId: track.queueEntryId } : null
      })
    }
  }

  /** Snapshot of the native→logical mapping, for the pre-unload handoff. */
  getCommittedIndices(): number[] | null {
    if (!this.committed) return null
    return this.committed.entries.map((entry) => entry?.index ?? -1)
  }

  private matches(items: NativeQueueLoadItem[]): boolean {
    return this.committed !== null && JSON.stringify(items) === this.committed.json
  }

  async loadPrepared(
    prepared: PreparedNativeQueue,
    api: QueueApi,
    queue: readonly Track[] = []
  ): Promise<void> {
    this.clear()
    const commit = await api.loadQueue(prepared.items, prepared.startIndex)
    if (commit?.queueToken) {
      this.committed = {
        json: JSON.stringify(prepared.items),
        token: commit.queueToken,
        window: !!prepared.queueIndices,
        entries: prepared.items.map((item, nativeIndex) => {
          const index = prepared.queueIndices?.[nativeIndex] ?? nativeIndex
          return { id: item.id, index, queueEntryId: queue[index]?.queueEntryId }
        })
      }
    }
  }

  findLogicalIndex(
    info: { queueIndex: number; queueToken?: string },
    queue: readonly Track[]
  ): number {
    if (!this.committed || !info.queueToken || info.queueToken !== this.committed.token) return -1
    const entry = this.committed.entries[info.queueIndex]
    if (!entry) return -1
    const track = queue[entry.index]
    return track?.id === entry.id &&
      (!entry.queueEntryId || track.queueEntryId === entry.queueEntryId)
      ? entry.index
      : -1
  }

  hasWindow(): boolean {
    return this.committed?.window === true
  }

  playMode(mode: PlayMode) {
    return this.hasWindow() && mode !== 'repeat' ? 'sequential' : toNativePlayMode(mode)
  }

  async prepareAndLoad(
    options: PreparePlayerNativeQueueOptions,
    boundary: PlayerNativeQueueBoundary,
    api: QueueApi
  ): Promise<PreparedNativeQueue | null> {
    let prepared = await preparePlayerNativeQueue(
      { ...options, canReuseQueue: (items) => !!api.selectQueueItem && this.matches(items) },
      boundary
    )
    if (!prepared || options.isCurrent?.() === false) return null
    if (this.committed && api.selectQueueItem && this.matches(prepared.items)) {
      const item = prepared.items[prepared.startIndex]
      const selected = await api.selectQueueItem({
        queueToken: this.committed.token,
        index: prepared.startIndex,
        id: item.id,
        source: item.source
      })
      if (options.isCurrent?.() === false) {
        this.clear()
        return null
      }
      if (selected) {
        this.committed.window = !!prepared.queueIndices
        this.committed.entries = prepared.items.map((item, nativeIndex) => {
          const index = prepared!.queueIndices?.[nativeIndex] ?? nativeIndex
          return { id: item.id, index, queueEntryId: options.queue[index]?.queueEntryId }
        })
        return prepared
      }
      // Token invalidation, a changed symlink or a service restart: run the
      // full availability checks again, including singleton degradation.
      this.clear()
      prepared = await preparePlayerNativeQueue({ ...options, canReuseQueue: undefined }, boundary)
      if (!prepared || options.isCurrent?.() === false) return null
    }
    await this.loadPrepared(prepared, api, options.queue)
    if (options.isCurrent?.() === false) {
      this.clear()
      return null
    }
    return prepared
  }
}
