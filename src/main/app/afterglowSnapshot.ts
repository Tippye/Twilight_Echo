import type { PlaybackInfo } from '../audio/audioEngineTypes.ts'
import type { MiniPlayerPlayMode, MiniPlayerStateSnapshot } from '../../shared/miniPlayer.ts'
import type { RemotePlayMode } from '../../shared/remoteControl.ts'
import { runtime } from '../core/runtime.ts'
import { normalizeAppSettings, writeAppSettings } from '../core/settings.ts'
import { updateDiscordActivity } from '../integrations/discord.ts'
import {
  getCoverCacheContentType,
  isCoverCacheFileName,
  readCoverCacheFileBytes,
  resizeCoverImageBytes
} from '../library/coverCache.ts'
import { playbackSessionService } from './playbackSessionService.ts'
import {
  resolveAfterglowEngineMapping,
  type AfterglowRestoreState
} from '../../shared/afterglowMode.ts'

const SMTC_REFRESH_INTERVAL_MS = 1_000
const REMOTE_PUBLISH_INTERVAL_MS = 1_000
const MAX_REMOTE_COVER_BYTES = 180_000
const MAX_REMOTE_COVER_DATA_URL = 250_000
const SAFE_REMOTE_COVER_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,/i

let listener: ((info: PlaybackInfo) => void) | null = null
let propertyListener: ((event: { name: string; data: unknown }) => void) | null = null
let lastEngineInfo: PlaybackInfo | null = null
let lastPresentationKey = ''
let lastSmtcRefreshAt = 0
let lastRemotePublishAt = 0
let lastRemoteCoverKey = ''
let lastRemoteCoverGeneration = 0
/** Logical queue index for each native queue entry (window -> logical). */
let engineLogicalIndices: number[] | null = null

export function setAfterglowEngineMapping(mapping: number[] | null): void {
  engineLogicalIndices = mapping ? [...mapping] : null
}

export function getAfterglowEngineMapping(): number[] | null {
  return engineLogicalIndices ? [...engineLogicalIndices] : null
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const buildTrackSnapshot = (track: unknown): MiniPlayerStateSnapshot['track'] => {
  if (!track || typeof track !== 'object') return null
  const record = track as Record<string, unknown>
  const id = text(record.id)
  if (!id) return null
  return {
    id,
    title: text(record.title),
    artist: text(record.artist),
    album: text(record.album),
    albumArtist: text(record.albumArtist),
    trackNumber: number(record.trackNumber) ?? 0,
    cover: typeof record.cover === 'string' ? record.cover : null,
    format: typeof record.format === 'string' ? record.format : null,
    sampleRate: number(record.sampleRate),
    bitDepth: number(record.bitDepth),
    coverSource: typeof record.coverSource === 'string' ? record.coverSource : null
  }
}

const normalizePlayMode = (value: unknown): MiniPlayerPlayMode => {
  return value === 'listLoop' || value === 'repeat' || value === 'shuffle' || value === 'heart'
    ? value
    : 'sequential'
}

const buildSnapshot = (info: PlaybackInfo): MiniPlayerStateSnapshot | null => {
  const session = playbackSessionService.getCachedSession()
  if (!session) return null
  const queueLength = Array.isArray(session.queue) ? session.queue.length : 0
  const track = buildTrackSnapshot(session.track)
  if (!track) return null
  return {
    capturedAtMs: Date.now(),
    track,
    isPlaying: info.state === 'playing',
    isLoading: false,
    currentTime: Number.isFinite(info.position) ? Math.max(0, info.position) : 0,
    duration: Number.isFinite(info.duration) ? Math.max(0, info.duration) : 0,
    playbackRate: info.playbackRate ?? 1,
    volume: Number.isFinite(info.volume) ? info.volume : 1,
    playMode: normalizePlayMode(info.playMode),
    favoriteAvailable: false,
    favoriteLiked: false,
    favoriteLoading: false,
    dominantColor: '',
    queueIndex: Number.isInteger(info.queueIndex) ? info.queueIndex : -1,
    queueLength
  }
}

const presentationKeyOf = (snapshot: MiniPlayerStateSnapshot): string =>
  [
    snapshot.track?.id ?? '',
    snapshot.isPlaying ? '1' : '0',
    snapshot.playMode,
    String(snapshot.queueIndex),
    String(snapshot.queueLength)
  ].join('\u0000')

const RENDERER_FREE_MODES = new Set(['sequential', 'listLoop', 'repeat'])

const toRemotePlayMode = (mode: MiniPlayerPlayMode): RemotePlayMode => {
  if (mode === 'repeat') return 'single'
  if (mode === 'listLoop' || mode === 'shuffle') return 'loop'
  return 'sequence'
}

/**
 * The renderer publishes a small raster data URL as the remote cover. While it
 * is unloaded, read the same local cover cache and hand the web remote an
 * equivalent data URL (resized when the cached art is large).
 */
const resolveRemoteCoverDataUrl = async (
  cover: string | null | undefined
): Promise<string | null> => {
  if (!cover) return null
  if (SAFE_REMOTE_COVER_DATA_URL.test(cover)) {
    return cover.length <= MAX_REMOTE_COVER_DATA_URL ? cover : null
  }
  if (!cover.startsWith('cover://')) return null
  const fileName = cover.slice('cover://'.length).replace(/^\/+/, '')
  if (!isCoverCacheFileName(fileName)) return null
  const bytes = await readCoverCacheFileBytes(fileName)
  if (!bytes) return null
  let buffer: Uint8Array = bytes
  let mime = getCoverCacheContentType(fileName)
  if (buffer.byteLength > MAX_REMOTE_COVER_BYTES) {
    const resized = resizeCoverImageBytes(buffer, mime)
    if (!resized) return null
    buffer = resized.bytes
    mime = resized.mime
  }
  const dataUrl = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`
  return dataUrl.length <= MAX_REMOTE_COVER_DATA_URL ? dataUrl : null
}

const syncRemoteCover = (cover: string | null | undefined, key: string): void => {
  const generation = ++lastRemoteCoverGeneration
  void resolveRemoteCoverDataUrl(cover)
    .then((coverUrl) => {
      if (generation !== lastRemoteCoverGeneration || key !== lastRemoteCoverKey) return
      runtime.publishRemotePlaybackSnapshot?.({ coverUrl })
    })
    .catch(() => undefined)
}

/**
 * The tray changes the play mode through the renderer-free dispatcher. Persist
 * it so the recreated renderer's startup snapshot does not flip the engine back
 * to the stale mode it saved before the unload.
 */
const syncPlayModeSetting = (mode: string): void => {
  if (!RENDERER_FREE_MODES.has(mode)) return
  if (runtime.appSettings.playMode === mode) return
  runtime.appSettings = normalizeAppSettings({
    ...runtime.appSettings,
    playMode: mode as typeof runtime.appSettings.playMode
  })
  writeAppSettings(runtime.appSettings)
}

/** Keeps the LAN web remote and Discord presence alive without a renderer. */
const publishExternalSurfaces = (
  snapshot: MiniPlayerStateSnapshot,
  options: { keyChanged: boolean; engineState: PlaybackInfo['state'] }
): void => {
  const now = Date.now()
  if (options.keyChanged && runtime.appSettings.discordRpcEnabled && snapshot.track) {
    updateDiscordActivity({
      title: snapshot.track.title,
      artist: snapshot.track.artist,
      album: snapshot.track.album,
      playing: snapshot.isPlaying,
      startTime: snapshot.isPlaying ? Math.round(now - snapshot.currentTime * 1000) : undefined
    })
  }
  if (options.keyChanged) {
    const coverKey = `${snapshot.track?.id ?? ''}\u0000${snapshot.track?.cover ?? ''}`
    if (coverKey !== lastRemoteCoverKey) {
      lastRemoteCoverKey = coverKey
      syncRemoteCover(snapshot.track?.cover ?? null, coverKey)
    }
  }
  if (!options.keyChanged && now - lastRemotePublishAt < REMOTE_PUBLISH_INTERVAL_MS) return
  lastRemotePublishAt = now
  runtime.publishRemotePlaybackSnapshot?.({
    state:
      options.engineState === 'stopped' ? 'stopped' : snapshot.isPlaying ? 'playing' : 'paused',
    title: snapshot.track?.title ?? '',
    artist: snapshot.track?.artist ?? '',
    album: snapshot.track?.album ?? '',
    position: snapshot.currentTime,
    duration: snapshot.duration,
    volume: snapshot.volume,
    muted: snapshot.volume <= 0,
    queueIndex: snapshot.queueIndex,
    queueLength: snapshot.queueLength,
    isLive: false,
    castTarget: null,
    playMode: toRemotePlayMode(snapshot.playMode)
  })
}

/**
 * Drives the renderer-free surfaces (tray, SMTC, Discord mirror) from engine
 * state while Afterglow has no renderer to publish `MiniPlayerStateSnapshot`.
 */
const publishFromEngine = (info: PlaybackInfo): void => {
  lastEngineInfo = info
  const logicalIndex = engineLogicalIndices?.[info.queueIndex]
  playbackSessionService.applyEngineState(
    {
      state: info.state,
      position: info.position,
      queueIndex: info.queueIndex,
      source: info.source,
      playMode: info.playMode
    },
    typeof logicalIndex === 'number' && logicalIndex >= 0 ? { logicalIndex } : {}
  )
  const snapshot = buildSnapshot(info)
  if (!snapshot) return
  runtime.latestMiniPlayerState = snapshot

  const key = presentationKeyOf(snapshot)
  const now = Date.now()
  const keyChanged = key !== lastPresentationKey
  if (keyChanged) {
    lastPresentationKey = key
    syncPlayModeSetting(snapshot.playMode)
    runtime.refreshTrayMenu?.()
    runtime.refreshWindowsSmtc?.()
    lastSmtcRefreshAt = now
    publishExternalSurfaces(snapshot, { keyChanged: true, engineState: info.state })
    return
  }
  if (snapshot.isPlaying && now - lastSmtcRefreshAt >= SMTC_REFRESH_INTERVAL_MS) {
    lastSmtcRefreshAt = now
    runtime.refreshWindowsSmtc?.()
  }
  publishExternalSurfaces(snapshot, { keyChanged: false, engineState: info.state })
}

export function startAfterglowPresentation(): void {
  stopAfterglowPresentation()
  lastPresentationKey = ''
  lastSmtcRefreshAt = 0
  lastRemotePublishAt = 0
  lastRemoteCoverKey = ''
  lastRemoteCoverGeneration = 0
  const manager = runtime.audioEngineManager
  if (!manager) return
  const onPlaybackInfo = (info: PlaybackInfo): void => {
    publishFromEngine(info)
  }
  listener = onPlaybackInfo
  manager.on('playback-info', onPlaybackInfo)
  // `playback-info` drops position-only ticks. Progress still has to reach the
  // tray-adjacent snapshot, the web remote and the persisted session, so fold
  // the periodic `time-pos` property into the last engine snapshot.
  const onPropertyChange = (event: { name: string; data: unknown }): void => {
    if (event.name !== 'time-pos' || typeof event.data !== 'number' || !lastEngineInfo) return
    publishFromEngine({ ...lastEngineInfo, position: event.data })
  }
  propertyListener = onPropertyChange
  manager.on('property-change', onPropertyChange)
  // Publish the current state immediately; the next engine tick follows in 250ms.
  void manager
    .getPlaybackInfo()
    .then((info) => publishFromEngine(info))
    .catch(() => undefined)
}

export function stopAfterglowPresentation(): void {
  const manager = runtime.audioEngineManager
  if (manager && listener) manager.off('playback-info', listener)
  if (manager && propertyListener) manager.off('property-change', propertyListener)
  listener = null
  propertyListener = null
  lastEngineInfo = null
  lastPresentationKey = ''
  lastSmtcRefreshAt = 0
  lastRemotePublishAt = 0
  lastRemoteCoverKey = ''
  lastRemoteCoverGeneration = 0
}

export function refreshAfterglowPresentationNow(): void {
  const manager = runtime.audioEngineManager
  if (!manager) return
  void manager
    .getPlaybackInfo()
    .then((info) => publishFromEngine(info))
    .catch(() => undefined)
}

/** State handed to the recreated renderer so it adopts live playback. */
export async function buildRestoreState(): Promise<AfterglowRestoreState | null> {
  const manager = runtime.audioEngineManager
  if (!manager) return null
  const session = playbackSessionService.getCachedSession()
  if (!session) return null
  const info = await manager.getPlaybackInfo()
  const queue = Array.isArray(session.queue) ? session.queue : []
  const engineQueue = manager.getQueueSnapshot()
  // A hot append can land while stop() is racing the restore handoff; recover
  // the native→logical map from queue identity instead of silently shifting
  // indices when the cached mapping is one entry short.
  const mapping = resolveAfterglowEngineMapping(
    queue,
    engineQueue,
    engineLogicalIndices ?? undefined
  )
  const logicalIndex =
    mapping[info.queueIndex] >= 0 ? mapping[info.queueIndex] : (session.queueIndex ?? 0)
  return {
    queueToken: manager.getQueueToken?.() ?? '',
    queueIndex: logicalIndex,
    queueLength: queue.length,
    nativeQueueIndices: [...mapping],
    state: info.state,
    position: Number.isFinite(info.position) ? Math.max(0, info.position) : 0,
    duration: Number.isFinite(info.duration) ? Math.max(0, info.duration) : 0,
    volume: Number.isFinite(info.volume) ? info.volume : 1,
    playbackRate: info.playbackRate ?? 1,
    playMode: info.playMode ?? session.playMode ?? 'sequential',
    queue
  }
}
