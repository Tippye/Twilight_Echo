import { ipcMain } from 'electron'
import { writeDiagnostic } from '../diagnostics/logger.ts'
import { pathToFileURL } from 'url'
import { runtime } from '../core/runtime'
import { resolveCoverCacheFile } from '../library/coverCache.ts'
import { shouldAcceptIpcEvent } from '../security/electronSecurity.ts'
import type { MiniPlayerCommand, MiniPlayerStateSnapshot } from '../../shared/miniPlayer.ts'
import {
  canNavigateSystemMediaQueue,
  miniPlayerPlayModeToSmtcRepeatMode,
  smtcRepeatModeToMiniPlayerPlayMode,
  type SystemMediaNativeStatus,
  type WindowsSmtcEvent,
  type WindowsSmtcUpdate
} from '../../shared/systemMedia.ts'
import {
  describeWindowsSmtcBindingFailure,
  loadWindowsSmtcBinding,
  nativeWindowHandleToNumber,
  type WindowsSmtcBinding
} from './windowsSmtcBinding.ts'
import { WINDOWS_APP_USER_MODEL_ID } from './windowsAppIdentity.ts'
import { windowsSmtcUpdateSignature } from './windowsSmtcSignature.ts'

let binding: WindowsSmtcBinding | null = null
let setupAttempted = false
let ipcRegistered = false
let status: SystemMediaNativeStatus = {
  supported: process.platform === 'win32',
  active: false,
  lastError: null
}

function currentStatus(): SystemMediaNativeStatus {
  return { ...status }
}

export function setupWindowsSmtcIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.handle('systemMedia:getNativeStatus', (event) => {
    if (!shouldAcceptIpcEvent(event, 'system media status IPC')) {
      return { supported: false, active: false, lastError: null } satisfies SystemMediaNativeStatus
    }
    return currentStatus()
  })
}

function sendPlayerCommand(command: MiniPlayerCommand): void {
  const win = runtime.mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    void routeRendererFreeCommand(command)
    return
  }
  win.webContents.send('miniPlayer:command', command)
}

/**
 * Afterglow unloads the main window; the same media-session commands are then
 * executed against the native engine instead of a renderer.
 */
async function routeRendererFreeCommand(command: MiniPlayerCommand): Promise<void> {
  const { isAfterglowModeActive, dispatchAfterglowTransport } =
    await import('../app/AfterglowModeService.ts')
  const { toRendererFreePlayMode } = await import('../../shared/afterglowMode.ts')
  if (!isAfterglowModeActive()) return
  switch (command.type) {
    case 'play':
      await dispatchAfterglowTransport({ type: 'play' })
      return
    case 'pause':
      await dispatchAfterglowTransport({ type: 'pause' })
      return
    case 'toggle-play':
      await dispatchAfterglowTransport({ type: 'toggle-play' })
      return
    case 'previous':
      await dispatchAfterglowTransport({ type: 'previous' })
      return
    case 'next':
      await dispatchAfterglowTransport({ type: 'next' })
      return
    case 'cycle-play-mode':
      await dispatchAfterglowTransport({ type: 'cycle-play-mode' })
      return
    case 'set-play-mode':
      await dispatchAfterglowTransport({
        type: 'set-play-mode',
        mode: toRendererFreePlayMode(command.value)
      })
      return
    case 'seek':
      await dispatchAfterglowTransport({ type: 'seek', positionSeconds: command.value })
      return
    case 'set-volume':
      await dispatchAfterglowTransport({ type: 'set-volume', volume: command.value })
      return
    case 'toggle-favorite':
      // The favorites stream lives in the renderer; keep the button inert instead
      // of silently toggling an unrelated list.
      return
  }
}

function handleWindowsSmtcEvent(event: WindowsSmtcEvent): void {
  const state = runtime.latestMiniPlayerState
  if (!state?.track || runtime.appSettings.smtcEnabled === false) return

  if (event.type === 'button') {
    if (event.button === 'play') sendPlayerCommand({ type: 'play' })
    else if (event.button === 'pause' || event.button === 'stop') {
      sendPlayerCommand({ type: 'pause' })
    } else if (event.button === 'previous') sendPlayerCommand({ type: 'previous' })
    else if (event.button === 'next') sendPlayerCommand({ type: 'next' })
    else if (event.button === 'fastForward') {
      sendPlayerCommand({ type: 'seek', value: Math.min(state.duration, state.currentTime + 10) })
    } else if (event.button === 'rewind') {
      sendPlayerCommand({ type: 'seek', value: Math.max(0, state.currentTime - 10) })
    }
    return
  }

  if (event.type === 'position') {
    if (!Number.isFinite(event.positionSeconds)) return
    sendPlayerCommand({
      type: 'seek',
      value: Math.max(0, Math.min(state.duration || event.positionSeconds, event.positionSeconds))
    })
    return
  }

  if (event.type === 'shuffle') {
    if (event.shuffle) {
      sendPlayerCommand({ type: 'set-play-mode', value: 'shuffle' })
    } else if (state.playMode === 'shuffle') {
      sendPlayerCommand({ type: 'set-play-mode', value: 'sequential' })
    }
    return
  }

  if (event.type === 'repeat') {
    sendPlayerCommand({
      type: 'set-play-mode',
      value: smtcRepeatModeToMiniPlayerPlayMode(event.autoRepeatMode)
    })
  }
}

function resolveSmtcCoverUri(state: MiniPlayerStateSnapshot): string {
  const track = state.track
  if (!track) return ''
  const durable = track.coverSource?.trim() ?? ''
  if (/^https?:\/\//i.test(durable)) return durable
  const cover = track.cover?.trim() ?? ''
  if (/^(?:https?|file):\/\//i.test(cover)) return cover
  if (cover.startsWith('cover://')) {
    const file = resolveCoverCacheFile(cover.slice('cover://'.length))
    return file ? pathToFileURL(file).toString() : ''
  }
  return ''
}

export function buildWindowsSmtcUpdate(
  state: MiniPlayerStateSnapshot | null,
  enabled = true
): WindowsSmtcUpdate {
  const track = state?.track ?? null
  const hasTrack = track != null
  const queueLength = state?.queueLength ?? 0
  const mode = state?.playMode ?? 'sequential'
  const canNavigateQueue = canNavigateSystemMediaQueue(hasTrack, queueLength)
  const canNext = canNavigateQueue
  const canPrevious = canNavigateQueue
  return {
    enabled,
    hasTrack,
    isPlaying: state?.isPlaying === true,
    isLoading: state?.isLoading === true,
    canNext,
    canPrevious,
    shuffle: mode === 'shuffle',
    autoRepeatMode: miniPlayerPlayModeToSmtcRepeatMode(mode),
    positionSeconds: Math.max(0, state?.currentTime ?? 0),
    durationSeconds: Math.max(0, state?.duration ?? 0),
    playbackRate: Math.max(0.25, Math.min(4, state?.playbackRate ?? 1)),
    title: track?.title ?? '',
    artist: track?.artist ?? '',
    album: track?.album ?? '',
    albumArtist: track?.albumArtist || track?.artist || '',
    trackNumber: track?.trackNumber ?? 0,
    coverUri: state ? resolveSmtcCoverUri(state) : ''
  }
}

let lastUpdateSignature: string | null = null

export function refreshWindowsSmtc(force = false): void {
  if (!binding || !status.active) return
  const enabled = runtime.appSettings.smtcEnabled !== false
  const signature = windowsSmtcUpdateSignature(runtime.latestMiniPlayerState, enabled)
  if (!force && signature === lastUpdateSignature) return
  try {
    binding.Update(buildWindowsSmtcUpdate(runtime.latestMiniPlayerState, enabled))
    lastUpdateSignature = signature
    status.lastError = null
  } catch (error) {
    writeDiagnostic('system.media', 'session.update.failed', { error }, 'error')
    lastUpdateSignature = null
    status.lastError = error instanceof Error ? error.message : String(error)
    console.warn('[smtc] failed to update Windows media session:', error)
  }
}

export function initializeWindowsSmtc(explicitHandle?: Buffer | null): boolean {
  if (process.platform !== 'win32') return false
  if (status.active && binding) return true
  if (setupAttempted) return false
  setupAttempted = true

  const loaded = loadWindowsSmtcBinding()
  if (!loaded.binding) {
    status = {
      supported: true,
      active: false,
      lastError: describeWindowsSmtcBindingFailure(loaded)
    }
    console.warn(`[smtc] ${status.lastError}`)
    return false
  }

  try {
    const nativeWindowHandle = nativeWindowHandleToNumber(
      explicitHandle ?? runtime.mainWindow?.getNativeWindowHandle()
    )
    const created = loaded.binding.Create(
      handleWindowsSmtcEvent,
      nativeWindowHandle,
      WINDOWS_APP_USER_MODEL_ID
    )
    if (!created) {
      const nativeDetail = loaded.binding.GetLastError?.()
      status = {
        supported: true,
        active: false,
        lastError: nativeDetail
          ? `native SMTC Create() returned false (${nativeDetail})`
          : 'native SMTC Create() returned false'
      }
      try {
        loaded.binding.Destroy()
      } catch {
        // Best effort cleanup after a failed Create().
      }
      return false
    }
    binding = loaded.binding
    status = { supported: true, active: true, lastError: null }
    writeDiagnostic('system.media', 'session.started', { backend: 'windows-smtc' })
    lastUpdateSignature = null
    runtime.refreshWindowsSmtc = refreshWindowsSmtc
    refreshWindowsSmtc(true)
    return true
  } catch (error) {
    status = {
      supported: true,
      active: false,
      lastError: error instanceof Error ? error.message : String(error)
    }
    console.warn('[smtc] failed to initialize native Windows media session:', error)
    return false
  }
}

export function destroyWindowsSmtc(): void {
  writeDiagnostic('system.media', 'session.stopped')
  runtime.refreshWindowsSmtc = null
  lastUpdateSignature = null
  const current = binding
  binding = null
  if (current) {
    try {
      current.Destroy()
    } catch (error) {
      console.warn('[smtc] failed to destroy native Windows media session:', error)
    }
  }
  status = { supported: process.platform === 'win32', active: false, lastError: status.lastError }
  setupAttempted = false
}

export function getWindowsSmtcStatus(): SystemMediaNativeStatus {
  return currentStatus()
}

/**
 * Recreates the media session against a different window handle. Used when the
 * main window is unloaded (anchor handle) and again when it is recreated.
 */
export function rebindWindowsSmtc(handle?: Buffer | null): boolean {
  if (process.platform !== 'win32') return false
  destroyWindowsSmtc()
  return initializeWindowsSmtc(handle)
}
