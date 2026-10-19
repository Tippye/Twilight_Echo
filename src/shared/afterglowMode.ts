/**
 * Renderer-unload ("Afterglow") mode.
 *
 * The main process destroys every UI window while the native audio service keeps
 * playing; the tray, media keys and SMTC keep controlling playback without any
 * renderer. Restoring recreates the main window and hands it the *live* engine
 * state instead of replaying the persisted session.
 */

export type AfterglowModePhase = 'inactive' | 'entering' | 'active' | 'restoring'

export type AfterglowAutoEntry = 'off' | 'minimize' | 'hide' | 'minimizeOrHide'

/**
 * Restore accelerators, most familiar first. Registration falls back to the next
 * candidate when another application already owns one, so entering Afterglow can
 * never leave the user without a keyboard way back.
 */
export const AFTERGLOW_RESTORE_ACCELERATORS = [
  'CommandOrControl+Shift+E',
  'CommandOrControl+Shift+Alt+E',
  'CommandOrControl+Alt+Shift+Backspace'
] as const

/** Preferred restore accelerator; the live one is reported in the mode status. */
export const AFTERGLOW_RESTORE_ACCELERATOR = AFTERGLOW_RESTORE_ACCELERATORS[0]

/** Query parameter carried by the recreated renderer. */
export const afterglowRendererRestoreQueryKey = 'afterglowRestore'

export const isAfterglowRendererRestore = (search: string): boolean =>
  new URLSearchParams(search).get(afterglowRendererRestoreQueryKey) === '1'

export interface AfterglowModeStatus {
  phase: AfterglowModePhase
  active: boolean
  /** Accelerator the user can press to bring the UI back. */
  restoreAccelerator: string
  error: string | null
}

/**
 * Snapshot the renderer hands to the main process right before it unloads. It is
 * kept in memory only: Afterglow never depends on the user's playback-resume
 * setting and never writes a resume record the user did not ask for.
 */
export interface AfterglowRendererSnapshot {
  queue: unknown[]
  queueIndex: number
  track: unknown
  position: number
  playMode: string
  volume: number
  playbackRate: number
  /**
   * Logical queue index for each entry currently loaded in the native queue.
   * Online queues are usually loaded as a current+next window, so native index
   * 0 does not necessarily mean logical index 0.
   */
  nativeQueueIndices?: number[]
}

/**
 * Snapshot handed to a recreated renderer. The engine already owns playback, so
 * the renderer adopts this state and never issues `loadQueue`/`play` for it.
 */
export interface AfterglowRestoreState {
  /** Content token of the queue currently loaded in the engine. */
  queueToken: string
  /** Logical queue index the engine is on. */
  queueIndex: number
  /** Number of items currently delegated to the engine. */
  queueLength: number
  /** Logical index for each native queue entry (length === queueLength). */
  nativeQueueIndices: number[]
  state: 'stopped' | 'playing' | 'paused'
  position: number
  duration: number
  volume: number
  playbackRate: number
  playMode: string
  /** Queue snapshot persisted by the main process before the renderer unloaded. */
  queue: unknown[]
}

/**
 * Transport vocabulary the main process can execute without a renderer. Shared
 * so the tray, media keys, SMTC and the LAN remote all translate into the same
 * serialized command lane.
 */
export type AfterglowTransportCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle-play' }
  | { type: 'stop' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionSeconds: number }
  | { type: 'seek-by'; deltaSeconds: number }
  | { type: 'set-volume'; volume: number }
  | { type: 'volume-step'; delta: number }
  | { type: 'toggle-mute' }
  | { type: 'set-playback-rate'; playbackRate: number }
  | { type: 'rate-step'; delta: number }
  | { type: 'cycle-play-mode' }
  | { type: 'set-play-mode'; mode: import('./audioEngineTypes.ts').PlayMode }

/**
 * Maps a global-shortcut action onto a renderer-free transport command.
 * `null` means the action needs the renderer and the UI must be restored first.
 */
export const afterglowTransportCommandForAction = (
  action: string
): AfterglowTransportCommand | null => {
  switch (action) {
    case 'playPause':
      return { type: 'toggle-play' }
    case 'play':
      return { type: 'play' }
    case 'pause':
      return { type: 'pause' }
    case 'previous':
      return { type: 'previous' }
    case 'next':
      return { type: 'next' }
    case 'stop':
      return { type: 'stop' }
    case 'volumeUp':
      return { type: 'volume-step', delta: 0.05 }
    case 'volumeDown':
      return { type: 'volume-step', delta: -0.05 }
    case 'toggleMute':
    case 'bossKey':
      return { type: 'toggle-mute' }
    case 'seekBackward':
      return { type: 'seek-by', deltaSeconds: -10 }
    case 'seekForward':
      return { type: 'seek-by', deltaSeconds: 10 }
    case 'speedUp':
      return { type: 'rate-step', delta: 0.1 }
    case 'speedDown':
      return { type: 'rate-step', delta: -0.1 }
    case 'cycleRepeatMode':
      return { type: 'cycle-play-mode' }
    default:
      return null
  }
}

const MAX_AFTERGLOW_QUEUE_ITEMS = 5000

/**
 * Validates the renderer's pre-unload snapshot. Kept strict so a compromised or
 * buggy renderer cannot hand main a queue it would later mis-map.
 */
export const parseAfterglowRendererSnapshot = (
  value: unknown
): AfterglowRendererSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const queue = record.queue
  if (!Array.isArray(queue) || queue.length === 0 || queue.length > MAX_AFTERGLOW_QUEUE_ITEMS) {
    return null
  }
  const queueIndex = record.queueIndex
  if (
    typeof queueIndex !== 'number' ||
    !Number.isInteger(queueIndex) ||
    queueIndex < 0 ||
    queueIndex >= queue.length
  ) {
    return null
  }
  const track = record.track
  if (!track || typeof track !== 'object' || Array.isArray(track)) return null
  if (typeof (track as Record<string, unknown>).id !== 'string') return null
  const position = record.position
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null
  const volume = record.volume
  const playbackRate = record.playbackRate
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
    return null
  }
  if (
    typeof playbackRate !== 'number' ||
    !Number.isFinite(playbackRate) ||
    playbackRate < 0.5 ||
    playbackRate > 2
  ) {
    return null
  }
  const rawIndices = record.nativeQueueIndices
  let nativeQueueIndices: number[] | undefined
  if (rawIndices !== undefined) {
    if (!Array.isArray(rawIndices) || rawIndices.length === 0) return null
    if (
      !rawIndices.every(
        (entry) =>
          typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < queue.length
      )
    ) {
      return null
    }
    nativeQueueIndices = [...rawIndices]
  }
  return {
    queue,
    queueIndex,
    track,
    position,
    playMode: typeof record.playMode === 'string' ? record.playMode : 'sequential',
    volume,
    playbackRate,
    ...(nativeQueueIndices ? { nativeQueueIndices } : {})
  }
}

const AFTERGLOW_ERROR_MESSAGES: Record<string, string> = {
  afterglow_requires_native_engine: '原生音频引擎尚未就绪',
  afterglow_requires_active_track: '当前没有可接管的曲目',
  afterglow_requires_active_playback: '当前没有正在播放或暂停的音乐',
  afterglow_requires_native_playback: '当前播放没有走原生输出',
  afterglow_requires_persisted_queue: '播放队列还没有保存下来',
  afterglow_requires_fully_local_queue: '队列里有无法在后台继续的音源',
  afterglow_requires_fully_delegated_queue: '队列还没有完整交给原生引擎',
  afterglow_requires_renderer_snapshot: '没有拿到播放队列快照',
  afterglow_requires_mappable_current_track: '无法把当前播放映射回队列',
  // Legacy status text still cached by running windows from before the resume
  // requirement was removed; keep a readable message until the next action.
  afterglow_requires_resume_mode: '「播放记忆」已关闭（该限制已移除，请重新尝试）',
  afterglow_requires_minimized_or_hidden_window: '窗口需要先最小化或隐藏',
  afterglow_restore_shortcut_unavailable: '恢复快捷键都被占用了',
  afterglow_renderer_flush_failed: '保存播放状态失败',
  afterglow_restore_window_unavailable: '恢复窗口没有创建成功',
  afterglow_restore_window_closed: '恢复窗口被关闭',
  afterglow_restore_window_timeout: '恢复窗口超时',
  afterglow_no_resumable_track: '找不到可继续播放的曲目'
}

/** Human-readable explanation for an Afterglow rejection/restore error code. */
export const describeAfterglowError = (error: string | null | undefined): string => {
  if (!error) return ''
  const separator = error.indexOf(':')
  const base = separator >= 0 ? error.slice(0, separator).trim() : error.trim()
  const detail = separator >= 0 ? error.slice(separator + 1).trim() : ''
  const message = AFTERGLOW_ERROR_MESSAGES[base]
  if (!message) return error
  if (base === 'afterglow_requires_fully_delegated_queue' && /^\d+\/\d+$/.test(detail)) {
    return `${message}（${detail} 首）`
  }
  if (base === 'afterglow_requires_fully_local_queue' && /^\d+$/.test(detail)) {
    return `${message}（队列第 ${Number(detail) + 1} 首）`
  }
  return message
}

/** Playback path a queue entry points at (local file, CUE file, or stream URL). */
export const afterglowTrackPathOf = (track: unknown): string => {
  if (!track || typeof track !== 'object') return ''
  const record = track as Record<string, unknown>
  for (const key of ['filePath', 'path', 'streamUrl', 'subTrack'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const UNPLAYABLE_SOURCE_PATTERN = /^(?:blob|data|twilight-media|twilight-audio):/i

/**
 * Whether the native engine can keep this source alive without the renderer.
 * Local files always qualify; http(s) streams qualify while the network and the
 * CDN URL remain valid (online queues are a best-effort window). Session-scoped
 * grants and renderer-only blob/data URLs do not.
 */
export const isAfterglowPlayableSource = (source: unknown): boolean => {
  if (typeof source !== 'string') return false
  const trimmed = source.trim()
  if (!trimmed || UNPLAYABLE_SOURCE_PATTERN.test(trimmed)) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  if (/^file:\/\//i.test(trimmed)) return true
  // Windows drive paths, UNC paths, and POSIX absolute paths.
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true
  if (trimmed.startsWith('\\\\')) return true
  return trimmed.startsWith('/')
}

/**
 * Maps each engine queue entry onto the logical queue index it came from.
 * Full delegation keeps identity; online queues are a current+next window and
 * rely on the renderer-provided mapping (or id/source matching as a fallback).
 * Unmapped entries stay `-1`.
 */
export const resolveAfterglowEngineMapping = (
  queue: readonly unknown[],
  engineItems: readonly { id?: string; source?: string }[],
  provided?: readonly number[]
): number[] => {
  if (
    provided &&
    provided.length === engineItems.length &&
    provided.every((index) => Number.isInteger(index) && index >= 0 && index < queue.length)
  ) {
    return [...provided]
  }
  if (engineItems.length === queue.length) return queue.map((_, index) => index)
  const used = new Set<number>()
  return engineItems.map((item) => {
    const id = typeof item.id === 'string' ? item.id : ''
    const source = typeof item.source === 'string' ? item.source : ''
    let index = -1
    if (id) {
      index = queue.findIndex(
        (track, candidate) =>
          !used.has(candidate) &&
          !!track &&
          typeof track === 'object' &&
          (track as Record<string, unknown>).id === id
      )
    }
    if (index < 0 && source) {
      index = queue.findIndex(
        (track, candidate) => !used.has(candidate) && afterglowTrackPathOf(track) === source
      )
    }
    if (index >= 0) used.add(index)
    return index
  })
}

/**
 * Collapses the renderer's five play modes onto the three the native queue
 * understands. Shuffle already reaches the engine as a pre-shuffled queue and
 * `heart` is a renderer-owned stream, so both become a wrapping list loop.
 */
export const toRendererFreePlayMode = (mode: string): 'sequential' | 'listLoop' | 'repeat' => {
  if (mode === 'repeat') return 'repeat'
  if (mode === 'listLoop' || mode === 'shuffle') return 'listLoop'
  return 'sequential'
}

/**
 * Maps an engine status onto the persisted session queue. Prefers the native
 * index when its path still matches, otherwise matches by source path.
 */
export const resolveAfterglowQueueIndex = (
  queue: readonly unknown[],
  status: { queueIndex: number; source?: string }
): number => {
  const nativeIndex = Number.isInteger(status.queueIndex) ? status.queueIndex : -1
  const nativePath =
    nativeIndex >= 0 && nativeIndex < queue.length ? afterglowTrackPathOf(queue[nativeIndex]) : ''
  if (nativeIndex >= 0 && nativeIndex < queue.length) {
    if (!status.source || nativePath === status.source) return nativeIndex
  }
  const source = status.source?.trim()
  if (!source) return nativeIndex >= 0 && nativeIndex < queue.length ? nativeIndex : -1
  return queue.findIndex((item) => {
    const path = afterglowTrackPathOf(item)
    return path === source || path.replace(/\\/g, '/') === source.replace(/\\/g, '/')
  })
}
