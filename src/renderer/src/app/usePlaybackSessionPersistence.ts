import { watch, type Ref } from 'vue'
import type { PlaybackSession, Track } from '../types/music'
import type { PlaybackResumeMode } from '../types/settings'
import type { VersionedDataEnvelope } from '../../../shared/versionedPersistence.ts'
import { playbackSessionWriter, type PlaybackSessionWriter } from './playbackSessionWriter.ts'
import { cloneTrackForPlaybackQueue } from '../utils/playerSessionTrack.ts'

interface PlaybackSessionSettings {
  playbackResumeMode: PlaybackResumeMode | Ref<PlaybackResumeMode>
}

interface PlaybackSessionDataApi {
  clearPlaybackSession: (
    expectedRevision: number
  ) => Promise<VersionedDataEnvelope<PlaybackSession | null> | void>
  loadPlaybackSession: () => Promise<
    VersionedDataEnvelope<PlaybackSession | null> | PlaybackSession | null
  >
  savePlaybackSession: (
    session: PlaybackSession,
    expectedRevision: number
  ) => Promise<VersionedDataEnvelope<PlaybackSession> | void>
}

export interface PlaybackSessionPersistenceOptions {
  settings: Ref<PlaybackSessionSettings>
  currentTrack: Ref<Track | null>
  currentTime: Ref<number>
  isPlaying: Ref<boolean>
  queue?: Ref<Track[]>
  restorePlaybackSession: (session: PlaybackSession) => void
  createPlaybackSession: (mode: PlaybackResumeMode) => PlaybackSession | null
  syncPluginProviders: () => Promise<void>
  dataApi: PlaybackSessionDataApi
  autosaveDelayMs?: number
  positionAutosaveMs?: number
  sessionWriter?: PlaybackSessionWriter
  onAutosaveError?: (error: unknown) => void
}

const DEFAULT_PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS = 1200
const DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS = 15000

export function createPlaybackSessionPersistence(options: PlaybackSessionPersistenceOptions) {
  const autosaveDelayMs = options.autosaveDelayMs ?? DEFAULT_PLAYBACK_SESSION_AUTOSAVE_DEBOUNCE_MS
  const positionAutosaveMs =
    options.positionAutosaveMs ?? DEFAULT_PLAYBACK_SESSION_POSITION_AUTOSAVE_MS
  let playbackSessionAutosaveTimer: ReturnType<typeof setTimeout> | null = null
  let lastPlaybackSessionPositionSaveAt = 0
  let playbackSessionWritesEnabled = false
  let restoreGeneration = 0
  const sessionWriter = options.sessionWriter ?? playbackSessionWriter
  const stopHandles: Array<() => void> = []
  let unregisterAutosaveScheduler: (() => void) | null = null

  async function restoreSavedPlaybackSession(mode: PlaybackResumeMode): Promise<void> {
    const generation = ++restoreGeneration
    let selectionChanged = false
    const stopSelectionWatch = watch(
      [
        options.currentTrack,
        options.currentTime,
        options.isPlaying,
        () => options.queue?.value,
        () => getPlaybackResumeMode()
      ],
      () => {
        selectionChanged = true
      },
      { flush: 'sync' }
    )
    const canRestore = () => generation === restoreGeneration && !selectionChanged
    playbackSessionWritesEnabled = false
    clearPlaybackSessionAutosave()

    try {
      // Always pin the writer to the on-disk revision before any write. The
      // player store can also enqueue session saves during startup; a stale
      // expected revision (0) against a live envelope (e.g. 16) used to block
      // window close with a revision-conflict dialog.
      const session = await refreshAuthoritativeSession()
      if (!canRestore()) return

      if (mode === 'off') {
        await clearSavedPlaybackSession()
        return
      }

      if (!session?.track?.id) return

      if (requiresPluginProviderSync(session.track)) {
        await options.syncPluginProviders()
      }
      if (!canRestore()) return

      const restoredSession: PlaybackSession = {
        ...session,
        mode,
        position: mode === 'trackAndPosition' ? session.position : 0
      }
      options.restorePlaybackSession(restoredSession)
      sessionWriter.setSavedQueueRef(
        session.queueRevision !== undefined ? (options.queue?.value ?? null) : null
      )
    } finally {
      stopSelectionWatch()
      // A damaged old session must not prevent the next valid playback action
      // from replacing it with a fresh snapshot.
      if (generation === restoreGeneration) playbackSessionWritesEnabled = true
    }
  }

  async function savePlaybackSessionForQuit(): Promise<void> {
    clearPlaybackSessionAutosave()
    if (!playbackSessionWritesEnabled) return
    await savePlaybackSessionSnapshot()
  }

  /**
   * Afterglow entry flush: the main process needs the full queue snapshot so it
   * can rebuild the UI (and the tray metadata) while no renderer exists.
   */
  async function savePlaybackSessionWithQueue(): Promise<void> {
    clearPlaybackSessionAutosave()
    if (!playbackSessionWritesEnabled) return
    const mode = getPlaybackResumeMode()
    if (mode === 'off') return
    const queueRef = options.queue?.value ?? null
    const session = options.createPlaybackSession(mode)
    if (!session || !queueRef || queueRef.length === 0) return
    const write = sessionWriter.save(options.dataApi, {
      ...session,
      queue: queueRef.map(cloneTrackForPlaybackQueue)
    })
    await write.completion
  }

  /**
   * Afterglow restore: the engine kept playing, so no session is restored from
   * disk. Only the persisted revision is synced so later autosaves do not fight
   * the main-process writer that owned the file while the renderer was gone.
   */
  async function adoptLivePlaybackSession(): Promise<void> {
    playbackSessionWritesEnabled = false
    clearPlaybackSessionAutosave()
    try {
      await refreshAuthoritativeSession()
    } finally {
      sessionWriter.setSavedQueueRef(options.queue?.value ?? null)
      playbackSessionWritesEnabled = true
    }
    startAutosaveWatchers()
  }

  async function savePlaybackSessionSnapshot(): Promise<void> {
    if (!playbackSessionWritesEnabled) return

    const mode = getPlaybackResumeMode()
    if (mode === 'off') {
      await clearSavedPlaybackSession()
      return
    }

    const queueRef = options.queue?.value ?? null
    const session = options.createPlaybackSession(mode)
    const write = sessionWriter.saveSnapshot(
      options.dataApi,
      session,
      queueRef,
      () => queueRef?.map(cloneTrackForPlaybackQueue) ?? []
    )
    await write.completion
  }

  async function clearSavedPlaybackSession(): Promise<void> {
    const write = sessionWriter.clear(options.dataApi)
    await write.completion
  }

  async function refreshAuthoritativeSession(): Promise<PlaybackSession | null> {
    const loaded = await options.dataApi.loadPlaybackSession()
    if (isVersionedPlaybackSession(loaded)) {
      sessionWriter.setRevision(loaded.revision)
      return loaded.data
    }
    sessionWriter.setRevision(0)
    return loaded
  }

  function clearPlaybackSessionAutosave(): void {
    if (playbackSessionAutosaveTimer !== null) {
      clearTimeout(playbackSessionAutosaveTimer)
      playbackSessionAutosaveTimer = null
    }
  }

  function schedulePlaybackSessionAutosave(delay = autosaveDelayMs): void {
    if (!playbackSessionWritesEnabled) return

    clearPlaybackSessionAutosave()
    playbackSessionAutosaveTimer = setTimeout(() => {
      playbackSessionAutosaveTimer = null
      lastPlaybackSessionPositionSaveAt = Date.now()
      void savePlaybackSessionSnapshot().catch((err) => {
        console.warn('自动保存播放会话失败：', err)
        options.onAutosaveError?.(err)
      })
    }, delay)
  }

  function startAutosaveWatchers(): void {
    if (!playbackSessionWritesEnabled || stopHandles.length > 0) return
    unregisterAutosaveScheduler = sessionWriter.registerAutosaveScheduler(
      schedulePlaybackSessionAutosave
    )

    // The first track can be selected while the application is still waiting
    // for startup work. Vue watchers do not replay that change by default.
    // Capture the current state before installing the reactive listeners.
    if (options.currentTrack.value && getPlaybackResumeMode() !== 'off') {
      lastPlaybackSessionPositionSaveAt = Date.now()
      void savePlaybackSessionSnapshot().catch((err) => {
        console.warn('自动保存播放会话失败:', err)
        options.onAutosaveError?.(err)
      })
    }

    stopHandles.push(
      ...(options.queue
        ? [watch(options.queue, () => schedulePlaybackSessionAutosave(), { flush: 'post' })]
        : []),
      watch(
        [() => options.currentTrack.value?.id, () => getPlaybackResumeMode()],
        ([trackId]) => {
          if (!trackId || getPlaybackResumeMode() === 'off') {
            schedulePlaybackSessionAutosave()
            return
          }

          schedulePlaybackSessionAutosave()
        },
        { flush: 'post' }
      )
    )

    stopHandles.push(
      watch(
        [options.currentTime, options.isPlaying],
        ([, playing]) => {
          if (
            !playing ||
            !options.currentTrack.value ||
            getPlaybackResumeMode() !== 'trackAndPosition'
          ) {
            return
          }

          const now = Date.now()
          if (now - lastPlaybackSessionPositionSaveAt < positionAutosaveMs) return
          lastPlaybackSessionPositionSaveAt = now
          schedulePlaybackSessionAutosave()
        },
        { flush: 'post' }
      )
    )
  }

  function stop(): void {
    restoreGeneration++
    clearPlaybackSessionAutosave()
    unregisterAutosaveScheduler?.()
    unregisterAutosaveScheduler = null
    while (stopHandles.length > 0) {
      stopHandles.pop()?.()
    }
  }

  function getPlaybackResumeMode(): PlaybackResumeMode {
    const mode = options.settings.value.playbackResumeMode
    return typeof mode === 'object' && mode !== null && 'value' in mode ? mode.value : mode
  }

  return {
    restoreSavedPlaybackSession,
    adoptLivePlaybackSession,
    savePlaybackSessionForQuit,
    savePlaybackSessionWithQueue,
    savePlaybackSessionSnapshot,
    clearPlaybackSessionAutosave,
    schedulePlaybackSessionAutosave,
    startAutosaveWatchers,
    stop
  }
}

function isVersionedPlaybackSession(
  value: VersionedDataEnvelope<PlaybackSession | null> | PlaybackSession | null
): value is VersionedDataEnvelope<PlaybackSession | null> {
  return (
    !!value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === 2 &&
    'data' in value
  )
}

function requiresPluginProviderSync(track: Track): boolean {
  if (track.source) return track.source !== 'local' && track.source !== 'ncm'
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return false
  const separatorIndex = track.id.indexOf(':')
  const source = separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
  return source !== 'local' && source !== 'ncm'
}
