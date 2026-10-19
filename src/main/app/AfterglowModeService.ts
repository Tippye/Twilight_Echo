import { app, globalShortcut, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { PlaybackInfo } from '../audio/audioEngineTypes.ts'
import { runtime } from '../core/runtime.ts'
import {
  AFTERGLOW_RESTORE_ACCELERATOR,
  AFTERGLOW_RESTORE_ACCELERATORS,
  isAfterglowPlayableSource,
  parseAfterglowRendererSnapshot,
  resolveAfterglowEngineMapping,
  type AfterglowAutoEntry,
  type AfterglowModePhase,
  type AfterglowModeStatus,
  type AfterglowRendererSnapshot,
  type AfterglowRestoreState,
  type AfterglowTransportCommand
} from '../../shared/afterglowMode.ts'
import { saveWindowState } from './windowState.ts'
import { playbackSessionService } from './playbackSessionService.ts'
import {
  buildRestoreState,
  getAfterglowEngineMapping,
  refreshAfterglowPresentationNow,
  setAfterglowEngineMapping,
  startAfterglowPresentation,
  stopAfterglowPresentation
} from './afterglowSnapshot.ts'
import {
  createAfterglowAnchorWindow,
  destroyAfterglowAnchorWindow,
  getAfterglowAnchorHandle
} from './afterglowAnchorWindow.ts'
import { dispatchRendererFreeTransport } from './rendererFreePlayback.ts'
import { AfterglowQueueCore } from './afterglowQueueCore.ts'
import { createAfterglowSourceResolver } from './afterglowSourceResolver.ts'
import { writeDiagnostic } from '../diagnostics/logger.ts'

export type AfterglowEntryMode = 'manual' | 'minimize' | 'hide'

export const afterglowRestoreReadyTimeoutMs = 15_000
const AFTERGLOW_UI_DESTROY_DELAY_MS = 80
/** Windowed (online) queues stop at their last loaded entry; bring the UI back. */
const AFTERGLOW_WINDOWED_AUTO_RESTORE_DELAY_MS = 6_000

const fallbackMediaKeys: Array<[string, AfterglowTransportCommand]> = [
  ['MediaPlayPause', { type: 'toggle-play' }],
  ['MediaPreviousTrack', { type: 'previous' }],
  ['MediaNextTrack', { type: 'next' }],
  ['MediaStop', { type: 'stop' }]
]

class AfterglowModeService {
  private phase: AfterglowModePhase = 'inactive'
  private error: string | null = null
  private generation = 0
  private entryCompletion: Promise<AfterglowModeStatus> | null = null
  private restoreCompletion: Promise<AfterglowModeStatus> | null = null
  private readonly ownedShortcuts = new Set<string>()
  private restoreAccelerator: string | null = null
  private uiDestroyTimer: ReturnType<typeof setTimeout> | null = null
  private entryMode: AfterglowEntryMode | null = null
  private miniPlayerWasOpen = false
  private desktopLyricsWasVisible = false
  private resolveAdopt: (() => void) | null = null
  private adoptPromise: Promise<void> | null = null
  private adoptCompleted = false
  /** Queue snapshot the renderer handed over just before it unloaded. */
  private rendererSnapshot: AfterglowRendererSnapshot | null = null
  /** True when the native queue is only a current+next window (online queues). */
  private windowedQueue = false
  private autoRestoreTimer: ReturnType<typeof setTimeout> | null = null
  private autoRestoreListener: ((info: PlaybackInfo) => void) | null = null
  /** Online (windowed) queue maintenance; null when the engine lacks hot update. */
  private queueCore: AfterglowQueueCore | null = null
  private queueCoreTick: (() => void) | null = null

  getStatus(): AfterglowModeStatus {
    return {
      phase: this.phase,
      active: this.phase !== 'inactive',
      restoreAccelerator: this.restoreAccelerator ?? AFTERGLOW_RESTORE_ACCELERATOR,
      error: this.error
    }
  }

  isActive(): boolean {
    return this.phase !== 'inactive'
  }

  enter(entryMode: AfterglowEntryMode = 'manual'): Promise<AfterglowModeStatus> {
    if (this.entryCompletion) return this.entryCompletion
    if (this.isActive()) return Promise.resolve(this.getStatus())
    const generation = ++this.generation
    this.phase = 'entering'
    this.entryMode = entryMode
    this.error = null
    const completion = this.performEntry(entryMode, generation).catch((error) =>
      this.isCurrentEntry(generation)
        ? this.fail(error instanceof Error ? error.message : String(error))
        : this.getStatus()
    )
    this.entryCompletion = completion
    void completion.then(() => {
      if (this.entryCompletion === completion) this.entryCompletion = null
    })
    return completion
  }

  private isCurrentEntry(generation: number): boolean {
    return generation === this.generation && (this.phase === 'entering' || this.phase === 'active')
  }

  /** Stores the renderer's pre-unload queue snapshot (memory only). */
  setRendererSnapshot(payload: unknown): boolean {
    const snapshot = parseAfterglowRendererSnapshot(payload)
    if (!snapshot) return false
    this.rendererSnapshot = snapshot
    return true
  }

  /**
   * Starts renderer-free online queue maintenance for a windowed native queue.
   * Older engines without the queueHotUpdate capability keep the v0 window
   * behavior (play what was loaded, then auto-restore the UI).
   */
  private async startQueueCore(
    snapshot: AfterglowRendererSnapshot,
    mapping: number[],
    logicalCurrent: number
  ): Promise<void> {
    this.stopQueueCore()
    const manager = runtime.audioEngineManager
    if (!manager) return
    const generation = this.generation
    const capability = await manager.getQueueHotUpdateCapabilityAsync()
    writeDiagnostic(
      'afterglow',
      'queue-core.capability',
      {
        available: capability !== null,
        queueLength: snapshot.queue.length,
        nativeQueueLength: mapping.length,
        windowed: this.windowedQueue
      },
      'info'
    )
    if (
      generation !== this.generation ||
      this.phase !== 'active' ||
      !capability?.append ||
      !capability.updateSource
    ) {
      return
    }
    const core = new AfterglowQueueCore({
      queue: snapshot.queue,
      currentLogicalIndex: logicalCurrent,
      nativeQueueIndices: mapping,
      engine: manager,
      resolver: createAfterglowSourceResolver(),
      onMappingChanged: (next) => {
        setAfterglowEngineMapping([...next])
        writeDiagnostic(
          'afterglow',
          'queue-core.mapping',
          { length: next.length, lastLogicalIndex: next.at(-1) ?? -1 },
          'info'
        )
      },
      onError: (message) => {
        writeDiagnostic('afterglow', 'queue-core.error', { message }, 'warn')
        console.warn('[afterglow] queue core:', message)
      }
    })
    this.queueCore = core
    const tick = (): void => {
      void core.tick()
    }
    this.queueCoreTick = tick
    manager.on('playback-info', tick)
    writeDiagnostic(
      'afterglow',
      'queue-core.start',
      {
        queueLength: snapshot.queue.length,
        nativeQueueLength: mapping.length,
        mappingStart: mapping[0] ?? -1
      },
      'info'
    )
    void core.start()
  }

  private stopQueueCore(): void {
    const manager = runtime.audioEngineManager
    if (manager && this.queueCoreTick) manager.off('playback-info', this.queueCoreTick)
    this.queueCoreTick = null
    this.queueCore?.stop()
    this.queueCore = null
  }

  /**
   * Restores the UI when playback stops for any reason (queue end, failed
   * online URL, user stop). The timer is cancelled if a new track starts first.
   */
  private bindWindowedAutoRestore(): void {
    this.unbindWindowedAutoRestore()
    const manager = runtime.audioEngineManager
    if (!manager) return
    let sawPlayback = false
    const listener = (info: PlaybackInfo): void => {
      if (this.phase !== 'active') return
      if (info.state === 'playing') {
        sawPlayback = true
        // A short stopped blip between tracks must not tear the UI back in.
        if (this.autoRestoreTimer) {
          clearTimeout(this.autoRestoreTimer)
          this.autoRestoreTimer = null
        }
        return
      }
      if (info.state !== 'stopped' || !sawPlayback || this.autoRestoreTimer) return
      // Queue end, a failed online URL and an intentional stop all land here.
      // Restoring the UI is always better than leaving an invisible stopped
      // player, and the user can immediately press play again.
      console.info('[afterglow] playback stopped; restoring the UI')
      this.autoRestoreTimer = setTimeout(() => {
        this.autoRestoreTimer = null
        if (this.phase === 'active') void restoreAfterglowMode()
      }, AFTERGLOW_WINDOWED_AUTO_RESTORE_DELAY_MS)
      this.autoRestoreTimer.unref?.()
    }
    this.autoRestoreListener = listener
    manager.on('playback-info', listener)
  }

  private unbindWindowedAutoRestore(): void {
    if (this.autoRestoreTimer) {
      clearTimeout(this.autoRestoreTimer)
      this.autoRestoreTimer = null
    }
    const manager = runtime.audioEngineManager
    if (manager && this.autoRestoreListener) {
      manager.off('playback-info', this.autoRestoreListener)
    }
    this.autoRestoreListener = null
  }

  private async performEntry(
    entryMode: AfterglowEntryMode,
    generation: number
  ): Promise<AfterglowModeStatus> {
    const rejection = await this.evaluateEntryRejection(entryMode)
    if (rejection) return this.fail(rejection)
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    const manager = runtime.audioEngineManager
    if (!manager) return this.fail('afterglow_requires_native_engine')

    try {
      await playbackSessionService.flushFromRenderer({ includeQueue: true })
    } catch (error) {
      console.warn('[afterglow] renderer session flush failed:', error)
      // The memory handoff is the contract that matters. Disk persistence is
      // best-effort: a locked/corrupt playback-session file must not make the
      // UI permanently un-unloadable.
      if (!this.rendererSnapshot) return this.fail('afterglow_renderer_flush_failed')
    }
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    const snapshot = this.rendererSnapshot
    if (!snapshot || snapshot.queue.length === 0) {
      return this.fail('afterglow_requires_renderer_snapshot')
    }
    const engineQueue = manager.getQueueSnapshot()
    if (engineQueue.length === 0) {
      return this.fail(`afterglow_requires_fully_delegated_queue:0/${snapshot.queue.length}`)
    }
    if (engineQueue.length > snapshot.queue.length) {
      return this.fail(
        `afterglow_requires_fully_delegated_queue:${engineQueue.length}/${snapshot.queue.length}`
      )
    }
    const mapping = resolveAfterglowEngineMapping(
      snapshot.queue,
      engineQueue,
      snapshot.nativeQueueIndices
    )
    const info = await manager.getPlaybackInfo()
    const logicalCurrent = mapping[info.queueIndex]
    if (!(logicalCurrent >= 0)) {
      console.warn('[afterglow] current native entry could not be mapped', {
        engineIndex: info.queueIndex,
        mapping
      })
      return this.fail('afterglow_requires_mappable_current_track')
    }
    // A windowed queue keeps playing only until its loaded entries run out; the
    // service restores the UI automatically when that happens.
    this.windowedQueue = engineQueue.length !== snapshot.queue.length
    setAfterglowEngineMapping(mapping)

    await playbackSessionService.adoptRendererSnapshot(snapshot)
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    playbackSessionService.applyEngineState(
      {
        state: info.state,
        position: info.position,
        queueIndex: info.queueIndex,
        source: info.source,
        playMode: info.playMode
      },
      { force: true, logicalIndex: logicalCurrent }
    )
    try {
      await playbackSessionService.flush()
    } catch (error) {
      // Persistence is best-effort for Afterglow; the in-memory snapshot is
      // what the restore handoff uses.
      console.warn('[afterglow] session flush failed (non-fatal):', error)
    }
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    if (!this.registerRestoreShortcut() && entryMode === 'manual') {
      return this.fail('afterglow_restore_shortcut_unavailable')
    }
    this.registerFallbackMediaKeys()

    const { createTray } = await import('../integrations/shortcutsTray.ts')
    createTray()
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    this.miniPlayerWasOpen = Boolean(
      runtime.miniPlayerWindow && !runtime.miniPlayerWindow.isDestroyed()
    )
    this.desktopLyricsWasVisible = Boolean(
      runtime.desktopLyricsWindow && !runtime.desktopLyricsWindow.isDestroyed()
    )

    const anchor = createAfterglowAnchorWindow({
      showInTaskbar: entryMode === 'minimize',
      onRestore: () => {
        void restoreAfterglowMode()
      }
    })
    if (anchor) {
      const smtc = await import('../integrations/windowsSmtc.ts')
      smtc.rebindWindowsSmtc(getAfterglowAnchorHandle())
    }
    if (!this.isCurrentEntry(generation)) return this.getStatus()

    this.phase = 'active'
    startAfterglowPresentation()
    void this.startQueueCore(snapshot, mapping, logicalCurrent)
    this.bindWindowedAutoRestore()
    this.saveMainWindowBounds()

    this.uiDestroyTimer = setTimeout(() => {
      this.uiDestroyTimer = null
      if (this.isCurrentEntry(generation)) void this.destroyAllUiWindows(generation)
    }, AFTERGLOW_UI_DESTROY_DELAY_MS)
    this.uiDestroyTimer.unref?.()

    return this.getStatus()
  }

  private async evaluateEntryRejection(entryMode: AfterglowEntryMode): Promise<string | null> {
    const manager = runtime.audioEngineManager
    if (!manager) return 'afterglow_requires_native_engine'

    if (entryMode !== 'manual') {
      const window = runtime.mainWindow
      if (!window || window.isDestroyed() || (window.isVisible() && !window.isMinimized())) {
        return 'afterglow_requires_minimized_or_hidden_window'
      }
    }

    let info
    try {
      info = await manager.getPlaybackInfo()
    } catch {
      return 'afterglow_requires_native_engine'
    }
    if (!info.source) return 'afterglow_requires_active_track'
    if (info.state !== 'playing' && info.state !== 'paused') {
      return 'afterglow_requires_active_playback'
    }
    if (info.nativePlaybackActive !== true) {
      return 'afterglow_requires_native_playback'
    }
    // The native queue is what keeps playing; the renderer's Track.streamUrl may
    // still be a twilight-media grant even when main resolved it to a local cache
    // file, so validate the sources the engine actually holds.
    const engineQueue = manager.getQueueSnapshot()
    if (engineQueue.length === 0) {
      return 'afterglow_requires_fully_delegated_queue:0/0'
    }
    const nonLocalIndex = engineQueue.findIndex((item) => !isAfterglowPlayableSource(item.source))
    if (nonLocalIndex >= 0) {
      const scheme =
        /^[a-z][a-z\d+.-]*:/i.exec(engineQueue[nonLocalIndex]?.source ?? '')?.[0] ?? 'unknown'
      console.warn('[afterglow] engine queue entry is not a local file', {
        index: nonLocalIndex,
        scheme
      })
      return `afterglow_requires_fully_local_queue:${nonLocalIndex}`
    }
    return null
  }

  private saveMainWindowBounds(): void {
    const window = runtime.mainWindow
    if (!window || window.isDestroyed()) return
    try {
      const bounds = window.getNormalBounds()
      saveWindowState(join(app.getPath('userData'), 'window-state.json'), {
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized()
      })
    } catch (error) {
      console.warn('[afterglow] unable to save window size:', error)
    }
  }

  private async destroyAllUiWindows(generation: number): Promise<void> {
    if (!this.isCurrentEntry(generation)) return
    try {
      const [{ destroyDesktopLyrics }, { destroyDynamicIsland }, { destroyTrayPlayerWindow }] =
        await Promise.all([
          import('../integrations/desktopLyrics.ts'),
          import('../integrations/dynamicIsland.ts'),
          import('../integrations/trayPlayer.ts')
        ])
      if (!this.isCurrentEntry(generation)) return
      destroyDesktopLyrics()
      destroyDynamicIsland()
      destroyTrayPlayerWindow()
      const miniPlayer = runtime.miniPlayerWindow
      if (miniPlayer && !miniPlayer.isDestroyed()) miniPlayer.destroy()
      runtime.miniPlayerWindow = null
    } catch (error) {
      console.warn('[afterglow] auxiliary window cleanup was incomplete:', error)
    }
    if (!this.isCurrentEntry(generation)) return

    const window = runtime.mainWindow
    if (window && !window.isDestroyed()) {
      const { setMainWindowAfterglowUnloading } = await import('./window.ts')
      setMainWindowAfterglowUnloading(true)
      try {
        window.destroy()
      } catch (error) {
        setMainWindowAfterglowUnloading(false)
        throw error
      }
      runtime.mainWindow = null
      // `closed` normally consumes the flag; keep it from leaking into a later
      // window if the event never reaches this listener.
      setTimeout(() => setMainWindowAfterglowUnloading(false), 1_000).unref?.()
    }
    if (!this.isCurrentEntry(generation)) return
    refreshAfterglowPresentationNow()
  }

  private registerRestoreShortcut(): boolean {
    for (const accelerator of AFTERGLOW_RESTORE_ACCELERATORS) {
      try {
        if (globalShortcut.isRegistered(accelerator)) continue
        if (
          globalShortcut.register(accelerator, () => {
            void restoreAfterglowMode()
          })
        ) {
          this.restoreAccelerator = accelerator
          this.ownedShortcuts.add(accelerator)
          return true
        }
      } catch {
        // Try the next candidate; one inaccessible accelerator must not strand
        // the session without a restore key.
      }
    }
    return false
  }

  private registerFallbackMediaKeys(): void {
    for (const [accelerator, command] of fallbackMediaKeys) {
      try {
        if (globalShortcut.isRegistered(accelerator)) continue
        if (
          globalShortcut.register(accelerator, () => {
            void dispatchAfterglowTransport(command)
          })
        ) {
          this.ownedShortcuts.add(accelerator)
        }
      } catch {
        // Media keys are best effort; the dedicated shortcut and tray still restore.
      }
    }
  }

  private unregisterOwnedShortcuts(): void {
    for (const accelerator of this.ownedShortcuts) {
      try {
        globalShortcut.unregister(accelerator)
      } catch {
        // Ignore: the accelerator may already be gone after a service restart.
      }
    }
    this.ownedShortcuts.clear()
    this.restoreAccelerator = null
  }

  async restore(): Promise<AfterglowModeStatus> {
    if (this.phase === 'inactive') {
      const window = runtime.mainWindow
      if (window && !window.isDestroyed()) {
        window.show()
        if (window.isMinimized()) window.restore()
        window.focus()
      }
      return this.getStatus()
    }
    if (this.phase === 'entering') {
      // Entry unloads the UI on a timer. Wait for it to settle so restore never
      // races the teardown and creates a second main window.
      await this.entryCompletion
      if (!this.isActive()) return this.getStatus()
    }
    if (this.phase === 'restoring') return this.restoreCompletion ?? this.getStatus()

    ++this.generation
    this.phase = 'restoring'
    this.error = null
    this.adoptCompleted = false
    this.stopQueueCore()
    this.unbindWindowedAutoRestore()
    if (this.uiDestroyTimer) {
      clearTimeout(this.uiDestroyTimer)
      this.uiDestroyTimer = null
    }
    let resolveRestore!: (status: AfterglowModeStatus) => void
    const completion = new Promise<AfterglowModeStatus>((resolve) => {
      resolveRestore = resolve
    })
    this.restoreCompletion = completion
    const finish = (status: AfterglowModeStatus): AfterglowModeStatus => {
      resolveRestore(status)
      if (this.restoreCompletion === completion) this.restoreCompletion = null
      return status
    }

    try {
      const manager = runtime.audioEngineManager
      if (manager) {
        const info = await manager.getPlaybackInfo()
        const logicalIndex = getAfterglowEngineMapping()?.[info.queueIndex]
        playbackSessionService.applyEngineState(
          {
            state: info.state,
            position: info.position,
            queueIndex: info.queueIndex,
            source: info.source,
            playMode: info.playMode
          },
          {
            force: true,
            ...(typeof logicalIndex === 'number' && logicalIndex >= 0 ? { logicalIndex } : {})
          }
        )
      }
      await playbackSessionService.flush()
    } catch (error) {
      console.warn('[afterglow] failed to persist state before restore:', error)
    }
    stopAfterglowPresentation()
    this.unregisterOwnedShortcuts()

    let window: BrowserWindow | null = null
    try {
      const { createWindow } = await import('./window.ts')
      window = createWindow({ afterglowRestore: true })
      const ready = await this.waitForWindowReady(window)
      if (!ready || window.isDestroyed()) {
        await this.destroyRestoreWindow(window)
        return finish(this.failWindowRestore('afterglow_restore_window_unavailable'))
      }
      window.show()
      window.focus()

      if (process.platform === 'win32') {
        const smtc = await import('../integrations/windowsSmtc.ts')
        smtc.rebindWindowsSmtc(window.getNativeWindowHandle())
      }
      destroyAfterglowAnchorWindow()

      await this.waitForRendererAdopt(window)
      if (window.isDestroyed()) {
        return finish(this.failWindowRestore('afterglow_restore_window_closed'))
      }
      this.rendererSnapshot = null
      playbackSessionService.clearRuntimeSnapshot()
      this.windowedQueue = false
      setAfterglowEngineMapping(null)
      this.phase = 'inactive'
      this.entryMode = null
      await this.restoreAuxiliaryWindows()
      runtime.refreshTrayMenu?.(true)
      return finish(this.getStatus())
    } catch (error) {
      // Destroy before rebinding SMTC/taskbar: the closed handler would
      // otherwise tear down the anchor-bound session that failWindowRestore
      // is about to recreate.
      await this.destroyRestoreWindow(window)
      const status = this.failWindowRestore(error instanceof Error ? error.message : String(error))
      return finish(status)
    }
  }

  /**
   * Removes a main window that failed to restore without letting its `closed`
   * handler tear down the tray/SMTC surfaces that keep Afterglow controllable.
   */
  private async destroyRestoreWindow(window: BrowserWindow | null): Promise<void> {
    if (!window || window.isDestroyed()) return
    try {
      const { setMainWindowAfterglowUnloading } = await import('./window.ts')
      setMainWindowAfterglowUnloading(true)
      window.destroy()
    } catch (error) {
      console.warn('[afterglow] failed to clean up restore window:', error)
    }
  }

  private waitForWindowReady(window: BrowserWindow): Promise<boolean> {
    if (window.isDestroyed()) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      let settled = false
      const cleanup = (): void => {
        settled = true
        clearTimeout(timer)
        window.removeListener('ready-to-show', handleReady)
        window.removeListener('closed', handleClosed)
      }
      const handleReady = (): void => {
        if (settled) return
        cleanup()
        resolve(true)
      }
      const handleClosed = (): void => {
        if (settled) return
        cleanup()
        resolve(false)
      }
      const timer = setTimeout(() => {
        if (settled) return
        cleanup()
        resolve(false)
      }, afterglowRestoreReadyTimeoutMs)
      timer.unref?.()
      window.once('ready-to-show', handleReady)
      window.once('closed', handleClosed)
    })
  }

  /**
   * The renderer adopts live engine state as soon as it mounts, then reports
   * completion. A bounded wait keeps a renderer that never reports from leaving
   * the service stuck in `restoring` forever.
   */
  private waitForRendererAdopt(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || this.adoptCompleted) return Promise.resolve()
    const promise = new Promise<void>((resolve) => {
      this.resolveAdopt = resolve
    })
    this.adoptPromise = promise
    const settle = (): void => {
      this.resolveAdopt?.()
      this.resolveAdopt = null
      this.adoptPromise = null
    }
    const handleClosed = (): void => settle()
    window.once('closed', handleClosed)
    const timer = setTimeout(() => {
      if (this.adoptPromise !== promise) return
      console.warn('[afterglow] renderer did not confirm restore adoption in time')
      settle()
    }, afterglowRestoreReadyTimeoutMs)
    timer.unref?.()
    return promise.finally(() => {
      clearTimeout(timer)
      window.removeListener('closed', handleClosed)
      this.adoptPromise = null
      this.resolveAdopt = null
    })
  }

  /** Called by the recreated renderer once it has adopted the live state. */
  notifyRendererAdoptComplete(): void {
    if (this.phase !== 'restoring') return
    this.adoptCompleted = true
    this.resolveAdopt?.()
    this.resolveAdopt = null
    this.adoptPromise = null
  }

  private failWindowRestore(message: string): AfterglowModeStatus {
    this.phase = 'active'
    this.error = message
    this.registerRestoreShortcut()
    this.registerFallbackMediaKeys()
    createAfterglowAnchorWindow({
      showInTaskbar: this.entryMode === 'minimize',
      onRestore: () => {
        void restoreAfterglowMode()
      }
    })
    if (process.platform === 'win32') {
      void import('../integrations/windowsSmtc.ts').then((smtc) =>
        smtc.rebindWindowsSmtc(getAfterglowAnchorHandle())
      )
    }
    startAfterglowPresentation()
    this.bindWindowedAutoRestore()
    console.warn('[afterglow] window restore failed:', message)
    return this.getStatus()
  }

  private fail(message: string): AfterglowModeStatus {
    ++this.generation
    this.rendererSnapshot = null
    playbackSessionService.clearRuntimeSnapshot()
    this.windowedQueue = false
    this.stopQueueCore()
    this.unbindWindowedAutoRestore()
    setAfterglowEngineMapping(null)
    this.unregisterOwnedShortcuts()
    destroyAfterglowAnchorWindow()
    stopAfterglowPresentation()
    if (this.uiDestroyTimer) {
      clearTimeout(this.uiDestroyTimer)
      this.uiDestroyTimer = null
    }
    this.phase = 'inactive'
    this.entryMode = null
    this.error = message
    return this.getStatus()
  }

  private async restoreAuxiliaryWindows(): Promise<void> {
    try {
      if (this.desktopLyricsWasVisible && runtime.appSettings.desktopLyrics.enabled) {
        const { showDesktopLyrics } = await import('../integrations/desktopLyrics.ts')
        showDesktopLyrics()
      }
      if (this.miniPlayerWasOpen) {
        const { showMiniPlayer } = await import('../integrations/miniPlayer.ts')
        showMiniPlayer()
      }
    } catch (error) {
      console.warn('[afterglow] auxiliary window restore failed:', error)
    } finally {
      this.miniPlayerWasOpen = false
      this.desktopLyricsWasVisible = false
    }
  }

  getRestoreState(): Promise<AfterglowRestoreState | null> {
    if (!this.isActive()) return Promise.resolve(null)
    return buildRestoreState()
  }

  dispatch(command: AfterglowTransportCommand): Promise<void> {
    if (!this.isActive()) return Promise.resolve()
    return dispatchRendererFreeTransport(command).catch((error) => {
      console.warn('[afterglow] renderer-free command failed:', error)
    })
  }

  handleMainWindowMinimized(): void {
    const auto = runtime.appSettings.afterglowAutoEntry
    if (auto === 'minimize' || auto === 'minimizeOrHide') void this.enter('minimize')
  }

  handleMainWindowHidden(): void {
    const auto = runtime.appSettings.afterglowAutoEntry
    if (auto === 'hide' || auto === 'minimizeOrHide') void this.enter('hide')
  }

  /** Settings panel helper: is automatic entry enabled at all? */
  autoEntryEnabled(value: AfterglowAutoEntry = runtime.appSettings.afterglowAutoEntry): boolean {
    return value !== 'off'
  }

  /**
   * `applyRuntimeSettings` re-registers every global shortcut (and unregisters
   * all first). While Afterglow is active that would remove the only keyboard
   * way back, so the service re-asserts its own registrations afterwards.
   */
  reassertShortcuts(): void {
    if (!this.isActive()) return
    // `applyRuntimeSettings` calls globalShortcut.unregisterAll(), so the set is
    // stale even though it still lists our accelerators. Clear it to force a
    // fresh registration of the restore escape hatch.
    this.ownedShortcuts.clear()
    this.restoreAccelerator = null
    this.registerRestoreShortcut()
    this.registerFallbackMediaKeys()
  }

  /** Releases everything the mode owns during application shutdown. */
  shutdown(): void {
    ++this.generation
    this.rendererSnapshot = null
    playbackSessionService.clearRuntimeSnapshot()
    this.windowedQueue = false
    this.stopQueueCore()
    this.unbindWindowedAutoRestore()
    setAfterglowEngineMapping(null)
    this.resolveAdopt?.()
    this.resolveAdopt = null
    this.adoptPromise = null
    this.adoptCompleted = false
    this.unregisterOwnedShortcuts()
    destroyAfterglowAnchorWindow()
    stopAfterglowPresentation()
    if (this.uiDestroyTimer) {
      clearTimeout(this.uiDestroyTimer)
      this.uiDestroyTimer = null
    }
    this.phase = 'inactive'
  }
}

const afterglowModeService = new AfterglowModeService()

export const getAfterglowModeStatus = (): AfterglowModeStatus => afterglowModeService.getStatus()
export const isAfterglowModeActive = (): boolean => afterglowModeService.isActive()
export const enterAfterglowMode = (): Promise<AfterglowModeStatus> =>
  afterglowModeService.enter('manual')
export const restoreAfterglowMode = (): Promise<AfterglowModeStatus> =>
  afterglowModeService.restore()
export const getAfterglowRestoreState = (): Promise<AfterglowRestoreState | null> =>
  afterglowModeService.getRestoreState()
export const notifyAfterglowRendererAdoptComplete = (): void =>
  afterglowModeService.notifyRendererAdoptComplete()
export const dispatchAfterglowTransport = (command: AfterglowTransportCommand): Promise<void> =>
  afterglowModeService.dispatch(command)
export const handleMainWindowMinimized = (): void =>
  afterglowModeService.handleMainWindowMinimized()
export const handleMainWindowHidden = (): void => afterglowModeService.handleMainWindowHidden()
export const shutdownAfterglowMode = (): void => afterglowModeService.shutdown()
export const reassertAfterglowShortcuts = (): void => afterglowModeService.reassertShortcuts()
export const publishAfterglowRendererSnapshot = (payload: unknown): boolean =>
  afterglowModeService.setRendererSnapshot(payload)
