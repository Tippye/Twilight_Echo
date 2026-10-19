import { buildDerivedCollections } from './library/derivedCollections.ts'
import { createPlaylistController } from './library/playlistController.ts'
import type { Playlist, LibraryItem, PlaylistPersistenceNotice } from './library/musicStoreTypes.ts'
export type {
  Playlist,
  PlaylistImportApplyResult,
  PlaylistBatchMoveResult,
  PlaylistPersistenceNotice,
  DerivedTrackGroup
} from './library/musicStoreTypes.ts'
import { computed, ref, shallowRef } from 'vue'
import type { Track } from '../types/music'
import { equalBpmAnalysis } from '../utils/bpmAnalysisEquality.ts'
import type {
  LocalLibraryExclusion,
  LocalLibraryClearExclusionsResult,
  LocalLibraryRemoveResult,
  LocalLibraryRemovalMode,
  LocalMusicLibraryDocument
} from '../../../shared/localLibrary.ts'
import type {
  LocalLibraryScanProgress,
  LocalLibraryScanStatus,
  LocalLibraryScanUpdate
} from '../../../shared/localLibraryScan.ts'
import type { LocalLibraryTagPatch } from '../../../shared/localLibraryTags.ts'
import { syncPluginProviders, useMediaProviders } from '../providers/index.ts'
import {
  LibraryMetadataEnrichmentQueue,
  type LibraryMetadataEnrichmentStatus,
  type LibraryMetadataEnrichmentTrackUpdate
} from '../utils/libraryMetadataEnrichment.ts'
import { isAggregatePlaylist, sortAggregatePlaylists } from '../utils/aggregatePlaylistView.ts'
import { getTrackSource } from '../utils/logicalTrackModel.ts'
import {
  enrichLocalTrackMetadata,
  type MetadataMatchConfidence
} from '../utils/musicMetadataMatching.ts'
import { useSettingsStore } from './useSettingsStore.ts'
import {
  notifyLocalTracksUnavailable,
  prepareLocalTracksForRemoval
} from '../utils/localTrackRemovalPolicy.ts'
import { type PlaylistPersistenceStatus } from './playlistPersistence.ts'
import {
  isLocalLibraryTrack,
  isReleaseDateOnlyUpdate,
  normalizePortableLibraryPath,
  nonEmptySnapshots,
  toPlaylistTrackSnapshot
} from './library/musicStoreData.ts'

interface AddTracksOptions {
  deferRebuild?: boolean
}

interface ManualMetadataMatchOptions {
  confidence: MetadataMatchConfidence
  score: number
}

interface LibraryRepairReport {
  checkedAt: string
  repairedCount: number
  unresolvedCount: number
  repairedTrackIds: string[]
  unresolvedTrackIds: string[]
}

type LibraryChange =
  | { kind: 'add' | 'remove' | 'unknown'; path?: string }
  | { kind: 'scan'; update: LocalLibraryScanUpdate }

const tracks = shallowRef<Track[]>([])
const scannedFolders = ref<string[]>([])
const isScanning = ref(false)
const artists = shallowRef<LibraryItem[]>([])
const albums = shallowRef<LibraryItem[]>([])
const genres = shallowRef<LibraryItem[]>([])
const folders = shallowRef<LibraryItem[]>([])
// 歌单内含完整 trackSnapshots，深度代理代价高。所有变更（替换与就地修改）都
// 汇入 playlistState.queuePlaylistPersistence，统一在那里 triggerRef。
const playlists = shallowRef<Playlist[]>([])
// 聚合歌单与普通歌单共用 playlists.json，靠 kind 分流；这两个视图让消费方不必
// 各自过滤，也保证普通"歌单"页永远看不到聚合歌单。
const aggregatePlaylists = computed(() =>
  sortAggregatePlaylists(playlists.value.filter(isAggregatePlaylist))
)
const localPlaylists = computed(() =>
  playlists.value.filter((playlist) => !isAggregatePlaylist(playlist))
)
const playlistPersistenceStatus = ref<PlaylistPersistenceStatus>({
  state: 'idle',
  dirty: false,
  failureCount: 0,
  lastError: null
})
const playlistPersistenceNotice = ref<PlaylistPersistenceNotice | null>(null)
const libraryRepairReport = ref<LibraryRepairReport | null>(null)
const excludedTracks = ref<LocalLibraryExclusion[]>([])
const libraryScanStatus = ref<LocalLibraryScanStatus>({
  jobId: null,
  mode: null,
  state: 'idle',
  current: 0,
  total: 0,
  parsedFileCount: 0,
  skippedUnchanged: 0,
  error: ''
})
const libraryScanProgress = ref<LocalLibraryScanProgress | null>(null)
const libraryMetadataEnrichmentStatus = ref<LibraryMetadataEnrichmentStatus>({
  state: 'idle',
  total: 0,
  queued: 0,
  active: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  error: ''
})
let libraryRevision = 0
const trackById = new Map<string, Track>()
const trackByPath = new Map<string, Track>()
const trackIndexById = new Map<string, number>()
let derivedCollectionsInitialized = false
let tracksRevision = 0

// Rebuild coalescing state — module-level so it persists across useMusicStore() calls.
let rebuildScheduled = false
let rebuildCount = 0

// Save debounce state — module-level so it persists across useMusicStore() calls.
let saveLibraryTimer: ReturnType<typeof setTimeout> | null = null
const pendingSaveResolvers: Array<{ generation: number; resolve: () => void }> = []
let librarySaveChain: Promise<void> = Promise.resolve()
let libraryMutationGeneration = 0
let libraryRemovalOperations = 0
let librarySaveRetryDelayMs = 500
let pendingRejectedRemoval: { selectedTracks: Track[] } | null = null

// Background post-load state lets callers await enrichment without blocking first render.
let librarySettlementInFlight: Promise<void> | null = null
let libraryMetadataEnrichmentQueue: LibraryMetadataEnrichmentQueue | null = null
let metadataProviderSync: Promise<void> | null = null
const pendingMetadataEnrichmentUpdates = new Map<string, LibraryMetadataEnrichmentTrackUpdate>()
let metadataEnrichmentFlushScheduled = false

const { clonePlaylistSnapshot, queuePlaylistPersistence, ...playlistCommands } =
  createPlaylistController({
    playlists,
    tracks,
    trackById,
    getTracksRevision: () => tracksRevision,
    playlistPersistenceStatus,
    playlistPersistenceNotice
  })

export function useMusicStore() {
  function rebuildDerivedCollections(): void {
    rebuildTrackLookupIndexes()
    const { settings } = useSettingsStore()
    const collections = buildDerivedCollections(
      tracks.value,
      [...scannedFolders.value, ...settings.value.libraryFolders],
      settings.value.genreSeparators
    )
    artists.value = collections.artists
    albums.value = collections.albums
    genres.value = collections.genres
    folders.value = collections.folders
  }

  function setTracks(nextTracks: Track[], options: { rebuildIndexes?: boolean } = {}): void {
    tracks.value = nextTracks
    tracksRevision++
    libraryMutationGeneration++
    if (options.rebuildIndexes !== false) {
      rebuildTrackLookupIndexes(nextTracks)
    }
  }

  function rebuildTrackLookupIndexes(nextTracks: Track[] = tracks.value): void {
    trackById.clear()
    trackByPath.clear()
    trackIndexById.clear()
    nextTracks.forEach((track, index) => {
      trackById.set(track.id, track)
      trackByPath.set(track.filePath, track)
      trackIndexById.set(track.id, index)
    })
  }

  function replaceTrackAtIndex(index: number, nextTrack: Track): void {
    const current = tracks.value[index]
    if (!current) return
    const nextTracks = tracks.value.slice()
    nextTracks[index] = nextTrack
    setTracks(nextTracks, { rebuildIndexes: false })
    trackById.delete(current.id)
    trackByPath.delete(current.filePath)
    trackIndexById.delete(current.id)
    trackById.set(nextTrack.id, nextTrack)
    trackByPath.set(nextTrack.filePath, nextTrack)
    trackIndexById.set(nextTrack.id, index)
  }

  function librarySnapshot(): { revision: number; tracks: Track[]; folders: string[] } {
    return {
      revision: libraryRevision,
      tracks: tracks.value,
      folders: [...scannedFolders.value]
    }
  }

  async function doSaveLibrary(): Promise<void> {
    await enqueueLibraryWrite(async () => {
      const generation = libraryMutationGeneration
      const saved = await persistLibrarySnapshotWithRevisionRecovery()
      applySavedLibraryMetadata(saved)
      librarySaveRetryDelayMs = 500
      resolvePendingLibrarySavesThrough(generation)
    })
  }

  async function saveLibrary(): Promise<void> {
    // Direct save: flush any pending timer and write immediately
    if (saveLibraryTimer !== null) {
      clearTimeout(saveLibraryTimer)
      saveLibraryTimer = null
    }
    try {
      await doSaveLibrary()
    } catch (error) {
      armScheduledLibrarySave()
      throw error
    }
  }

  function scheduleSaveLibrary(): Promise<void> {
    return new Promise<void>((resolve) => {
      pendingSaveResolvers.push({ generation: libraryMutationGeneration, resolve })
      librarySaveRetryDelayMs = 500
      if (saveLibraryTimer !== null) {
        clearTimeout(saveLibraryTimer)
        saveLibraryTimer = null
      }
      armScheduledLibrarySave()
    })
  }

  function flushSaveLibrary(): void {
    if (saveLibraryTimer !== null) {
      clearTimeout(saveLibraryTimer)
      saveLibraryTimer = null
    }
    // Best-effort synchronous save for quit-flush (beforeunload)
    const generation = libraryMutationGeneration
    void window.api.data
      .saveMusicLibrary({
        revision: libraryRevision,
        tracks: tracks.value,
        folders: [...scannedFolders.value]
      })
      .then(
        (saved) => {
          applySavedLibraryMetadata(saved)
          librarySaveRetryDelayMs = 500
          resolvePendingLibrarySavesThrough(generation)
        },
        () => {
          increaseLibrarySaveRetryDelay()
          armScheduledLibrarySave()
        }
      )
  }

  function scheduleRebuild(): void {
    if (rebuildScheduled) return
    rebuildScheduled = true
    queueMicrotask(() => {
      if (!rebuildScheduled) return
      rebuildScheduled = false
      rebuildDerivedCollections()
      rebuildCount++
    })
  }

  function flushRebuild(): void {
    if (rebuildScheduled) {
      rebuildScheduled = false
      rebuildDerivedCollections()
      rebuildCount++
    }
  }

  async function loadLibrary(skipDateOnlyEnrichment = false): Promise<void> {
    const saved = await window.api.data.loadMusicLibrary()
    if (!saved) return

    libraryMetadataEnrichmentQueue?.cancel()
    pendingMetadataEnrichmentUpdates.clear()
    metadataEnrichmentFlushScheduled = false

    let loadedTracks: Track[]
    if (Array.isArray(saved)) {
      loadedTracks = saved as Track[]
      libraryRevision = 0
      excludedTracks.value = []
    } else {
      loadedTracks = (saved.tracks || []) as Track[]
      scannedFolders.value = (saved.folders || []) as string[]
      libraryRevision = Number.isSafeInteger(saved.revision) ? saved.revision : 0
      excludedTracks.value = Array.isArray(saved.exclusions) ? saved.exclusions : []
    }
    // Set tracks immediately so the UI renders local music without waiting for
    // provider metadata enrichment (which can be slow when a provider is unavailable).
    const enrichmentTracks = skipDateOnlyEnrichment
      ? loadedTracks.filter((track) => !isReleaseDateOnlyUpdate(trackById.get(track.id), track))
      : loadedTracks
    setTracks(loadedTracks)
    rebuildDerivedCollections()
    libraryRepairReport.value = null
    // File-system reconciliation is owned by the main-process incremental scan
    // coordinator. Provider enrichment is queued after the first local render.
    void queueBackgroundMetadataEnrichment(enrichmentTracks)
  }

  function whenLibrarySettled(): Promise<void> {
    return librarySettlementInFlight ?? Promise.resolve()
  }

  function applyLibraryScanStatus(status: LocalLibraryScanStatus): void {
    libraryScanStatus.value = { ...status }
    if (status.state === 'completed' || status.state === 'cancelled' || status.state === 'failed') {
      libraryScanProgress.value = null
    }
  }

  function applyLibraryScanProgress(progress: LocalLibraryScanProgress): void {
    libraryScanProgress.value = { ...progress }
    libraryScanStatus.value = {
      ...libraryScanStatus.value,
      jobId: progress.jobId,
      mode: progress.mode,
      current: progress.current,
      total: progress.total,
      parsedFileCount: progress.parsedFileCount,
      skippedUnchanged: progress.skippedUnchanged
    }
  }

  async function applyLibraryScanUpdate(update: LocalLibraryScanUpdate): Promise<void> {
    excludedTracks.value = update.exclusions
    libraryRevision = update.libraryRevision
    libraryScanStatus.value = {
      ...libraryScanStatus.value,
      jobId: update.jobId,
      mode: update.mode,
      state: update.state,
      parsedFileCount: update.parsedFileCount,
      skippedUnchanged: update.skippedUnchanged,
      error: ''
    }
    if (update.state === 'cancelled') return
    if (update.reloadRequired) {
      await loadLibrary(true)
      return
    }

    const excludedPaths = new Set(
      update.exclusions.map((entry) => normalizePortableLibraryPath(entry.filePath))
    )
    const removedPaths = new Set(update.removedFilePaths.map(normalizePortableLibraryPath))
    const replacements = [...update.addedTracks, ...update.updatedTracks].filter(
      (track): track is Track => isLocalLibraryTrack(track)
    )
    const enrichmentTracks = replacements.filter(
      (track) => !isReleaseDateOnlyUpdate(trackById.get(track.id), track)
    )
    const replacementPaths = new Set(
      replacements.map((track) => normalizePortableLibraryPath(track.filePath))
    )
    const replacementIds = new Set(replacements.map((track) => track.id))
    const nextTracks = tracks.value.filter((track) => {
      const key = normalizePortableLibraryPath(track.filePath)
      return (
        !removedPaths.has(key) &&
        !replacementPaths.has(key) &&
        !replacementIds.has(track.id) &&
        !excludedPaths.has(key)
      )
    })
    for (const track of replacements) {
      if (!excludedPaths.has(normalizePortableLibraryPath(track.filePath))) nextTracks.push(track)
    }

    if (removedPaths.size > 0 || excludedPaths.size > 0) {
      const removedIds = tracks.value
        .filter((track) => {
          const key = normalizePortableLibraryPath(track.filePath)
          return removedPaths.has(key) || excludedPaths.has(key)
        })
        .map((track) => track.id)
      notifyLocalTracksUnavailable(removedIds, [...removedPaths, ...excludedPaths])
    }

    const changed =
      nextTracks.length !== tracks.value.length ||
      nextTracks.some((track, index) => track !== tracks.value[index])
    if (!changed) return
    rebuildScheduled = false
    setTracks(nextTracks)
    rebuildDerivedCollections()
    rebuildCount++
    void queueBackgroundMetadataEnrichment(enrichmentTracks)
  }

  async function startStartupLibraryScan(): Promise<LocalLibraryScanUpdate> {
    const update = await window.api.library.scanStartup()
    await applyLibraryScanUpdate(update)
    return update
  }

  async function startFullLibraryScan(): Promise<LocalLibraryScanUpdate> {
    const update = await window.api.library.scanFull()
    await applyLibraryScanUpdate(update)
    return update
  }

  async function resetLibrary(): Promise<number> {
    const result = await window.api.library.reset()
    libraryMetadataEnrichmentQueue?.cancel()
    pendingMetadataEnrichmentUpdates.clear()
    metadataEnrichmentFlushScheduled = false
    libraryRevision = result.library.revision
    excludedTracks.value = result.library.exclusions
    setTracks([])
    rebuildDerivedCollections()
    libraryRepairReport.value = null
    notifyLocalTracksUnavailable(result.removedTrackIds, result.removedFilePaths)
    return result.removedTrackIds.length
  }

  async function pauseLibraryScan(): Promise<boolean> {
    return await window.api.library.pauseScan()
  }

  async function resumeLibraryScan(): Promise<boolean> {
    return await window.api.library.resumeScan()
  }

  async function cancelLibraryScan(): Promise<boolean> {
    return await window.api.library.cancelScan()
  }

  function cancelLibraryMetadataEnrichment(): boolean {
    return libraryMetadataEnrichmentQueue?.cancel() ?? false
  }

  async function refreshIncrementalLibrary(): Promise<void> {
    await startStartupLibraryScan()
  }

  async function handleLibraryChange(change: LibraryChange | undefined): Promise<void> {
    if (change?.kind === 'scan') {
      await applyLibraryScanUpdate(change.update)
      return
    }
    try {
      // Single file removal
      if (change?.kind === 'remove' && change.path) {
        const track = trackByPath.get(change.path)
        if (track) {
          removeTrack(track.id)
          void scheduleSaveLibrary()
          return
        }
        // Track not found — fall through to full reload
      }

      // Single file addition or content change
      if (change?.kind === 'add' && change.path) {
        const lastSep = Math.max(change.path.lastIndexOf('\\'), change.path.lastIndexOf('/'))
        const dir = lastSep >= 0 ? change.path.slice(0, lastSep) : change.path
        const scanned = await window.api.fs.scanMusicFiles(dir)
        const newTracks = (scanned as Track[]).filter((t) => t.filePath === change.path)
        if (newTracks.length > 0) {
          // If path already exists (content change / tag edit):
          // remove old track first, then add new (remove-then-add)
          const oldTrack = trackByPath.get(change.path)
          if (oldTrack) {
            removeTrack(oldTrack.id)
          }
          await addTracks(newTracks)
          return
        }
        // No tracks found in scan — fall through to full reload
      }

      // Fallback: full reload for unknown/no-path/incremental failure
      await refreshIncrementalLibrary()
    } catch {
      // Incremental parse failed — fallback to full reload
      try {
        await refreshIncrementalLibrary()
      } catch {
        // The main-process scanner reports its failure through scan status.
      }
    }
  }

  async function addTracks(newTracks: Track[], options: AddTracksOptions = {}): Promise<void> {
    const excludedPaths = new Set(
      excludedTracks.value.map((track) => normalizePortableLibraryPath(track.filePath))
    )
    const unique: Track[] = []
    for (const track of newTracks) {
      if (excludedPaths.has(normalizePortableLibraryPath(track.filePath))) continue
      if (trackByPath.has(track.filePath)) continue
      trackByPath.set(track.filePath, track)
      trackById.set(track.id, track)
      unique.push(track)
    }
    if (unique.length === 0) return

    setTracks([...tracks.value, ...unique])
    if (!options.deferRebuild) {
      scheduleRebuild()
    }
    if (!isScanning.value) {
      void scheduleSaveLibrary()
    }
    void queueBackgroundMetadataEnrichment(unique)
  }

  function removeTrack(id: string): void {
    const track = trackById.get(id)
    if (!track) return
    trackByPath.delete(track.filePath)
    trackById.delete(id)
    setTracks(tracks.value.filter((t) => t.id !== id))
    notifyLocalTracksUnavailable([id], track.filePath ? [track.filePath] : [])
    scheduleRebuild()
  }

  async function removeLocalTracks(
    selectedTracks: Track[],
    mode: LocalLibraryRemovalMode
  ): Promise<LocalLibraryRemoveResult> {
    cancelScheduledLibrarySave()
    libraryRemovalOperations++
    try {
      return await enqueueLibraryWrite(async () => {
        const requestGeneration = libraryMutationGeneration
        if (mode === 'trash') {
          await prepareLocalTracksForRemoval(
            selectedTracks.map((track) => track.id),
            selectedTracks.map((track) => track.filePath)
          )
        }
        let result: LocalLibraryRemoveResult
        try {
          result = await window.api.library.removeTracks({
            mode,
            items: selectedTracks.map((track) => ({
              id: track.id,
              filePath: track.filePath,
              title: track.title,
              artist: track.artist
            })),
            library: librarySnapshot()
          })
        } catch (error) {
          if (mode !== 'trash') throw error
          pendingRejectedRemoval = { selectedTracks }
          const authoritative = await loadAuthoritativeLibraryDocument()
          const recovered = createRecoveredRemovalResult(authoritative, selectedTracks)
          if (!recovered) {
            pendingRejectedRemoval = null
            throw error
          }
          pendingRejectedRemoval = null
          result = recovered
        }
        const changedDuringRemoval = libraryMutationGeneration !== requestGeneration
        applySavedLibraryMetadata(result.library)
        if (result.removedFilePaths.length > 0) {
          applyLocalRemovalDelta(result)
          notifyLocalTracksUnavailable(result.removedTrackIds, result.removedFilePaths)
          resolvePendingLibrarySavesThrough(requestGeneration)
        }

        const pendingSnapshotWasNotCommitted =
          result.removedFilePaths.length === 0 &&
          pendingSaveResolvers.some((pending) => pending.generation <= requestGeneration)
        if (changedDuringRemoval || pendingSnapshotWasNotCommitted) {
          await persistCurrentLibraryUntilStable()
        }
        return result
      })
    } finally {
      libraryRemovalOperations--
      armScheduledLibrarySave()
    }
  }

  async function restoreExcludedTracks(filePaths: string[]): Promise<number> {
    const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)))
    if (uniquePaths.length === 0) return 0
    cancelScheduledLibrarySave()
    libraryRemovalOperations++
    try {
      const result = await enqueueLibraryWrite(async () => {
        const requestGeneration = libraryMutationGeneration
        const restored = await window.api.library.restoreExclusions({
          filePaths: uniquePaths,
          library: librarySnapshot()
        })
        const changedDuringRestore = libraryMutationGeneration !== requestGeneration
        applySavedLibraryMetadata(restored.library)
        if (restored.restoredFilePaths.length > 0) {
          resolvePendingLibrarySavesThrough(requestGeneration)
        }
        const pendingSnapshotWasNotCommitted =
          restored.restoredFilePaths.length === 0 &&
          pendingSaveResolvers.some((pending) => pending.generation <= requestGeneration)
        if (changedDuringRestore || pendingSnapshotWasNotCommitted) {
          await persistCurrentLibraryUntilStable()
        }
        return restored
      })

      if (result.restoredFilePaths.length > 0) {
        await startStartupLibraryScan()
      }
      return result.restoredFilePaths.length
    } finally {
      libraryRemovalOperations--
      armScheduledLibrarySave()
    }
  }

  async function clearExcludedTracks(filePaths: string[]): Promise<number> {
    const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)))
    if (uniquePaths.length === 0) return 0
    cancelScheduledLibrarySave()
    libraryRemovalOperations++
    try {
      const result = await enqueueLibraryWrite(async () => {
        const requestGeneration = libraryMutationGeneration
        const cleared: LocalLibraryClearExclusionsResult = await window.api.library.clearExclusions(
          {
            filePaths: uniquePaths,
            library: librarySnapshot()
          }
        )
        const changedDuringClear = libraryMutationGeneration !== requestGeneration
        applySavedLibraryMetadata(cleared.library)
        if (cleared.clearedFilePaths.length > 0) {
          resolvePendingLibrarySavesThrough(requestGeneration)
        }
        const pendingSnapshotWasNotCommitted =
          cleared.clearedFilePaths.length === 0 &&
          pendingSaveResolvers.some((pending) => pending.generation <= requestGeneration)
        if (changedDuringClear || pendingSnapshotWasNotCommitted) {
          await persistCurrentLibraryUntilStable()
        }
        return cleared
      })
      return result.clearedFilePaths.length
    } finally {
      libraryRemovalOperations--
      armScheduledLibrarySave()
    }
  }

  function applyLocalTagWrite(filePaths: readonly string[], patch: LocalLibraryTagPatch): number {
    const paths = new Set(filePaths.map(normalizePortableLibraryPath))
    if (paths.size === 0) return 0
    let changed = 0
    const nextTracks = tracks.value.map((track) => {
      if (!paths.has(normalizePortableLibraryPath(track.filePath))) return track
      changed++
      return {
        ...track,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.artist !== undefined ? { artist: patch.artist } : {}),
        ...(patch.album !== undefined ? { album: patch.album } : {}),
        ...(patch.albumArtist !== undefined ? { albumArtist: patch.albumArtist } : {}),
        ...(patch.genre !== undefined ? { genre: patch.genre } : {}),
        ...(patch.track !== undefined ? { trackNumber: patch.track } : {}),
        ...(patch.disc !== undefined ? { discNumber: patch.disc } : {})
      }
    })
    if (changed === 0) return 0
    setTracks(nextTracks, { rebuildIndexes: false })
    scheduleRebuild()
    void scheduleSaveLibrary()
    return changed
  }

  function applyLocalRemovalDelta(result: LocalLibraryRemoveResult): void {
    const removedIds = new Set(result.removedTrackIds)
    const removedPaths = new Set(result.removedFilePaths.map(normalizePortableLibraryPath))
    const nextTracks = tracks.value.filter(
      (track) =>
        !removedIds.has(track.id) && !removedPaths.has(normalizePortableLibraryPath(track.filePath))
    )
    if (nextTracks.length === tracks.value.length) return
    rebuildScheduled = false
    setTracks(nextTracks, { rebuildIndexes: false })
    rebuildDerivedCollections()
    rebuildCount++
  }

  function cancelScheduledLibrarySave(): boolean {
    if (saveLibraryTimer === null) return false
    clearTimeout(saveLibraryTimer)
    saveLibraryTimer = null
    return true
  }

  function resolvePendingLibrarySavesThrough(generation: number): void {
    const remaining: typeof pendingSaveResolvers = []
    for (const pending of pendingSaveResolvers) {
      if (pending.generation <= generation) pending.resolve()
      else remaining.push(pending)
    }
    pendingSaveResolvers.splice(0, pendingSaveResolvers.length, ...remaining)
  }

  function armScheduledLibrarySave(): void {
    if (
      saveLibraryTimer !== null ||
      libraryRemovalOperations > 0 ||
      pendingSaveResolvers.length === 0
    ) {
      return
    }
    saveLibraryTimer = setTimeout(() => {
      saveLibraryTimer = null
      void doSaveLibrary().catch((error) => {
        console.warn('[library] Scheduled save failed; retrying:', error)
        increaseLibrarySaveRetryDelay()
        armScheduledLibrarySave()
      })
    }, librarySaveRetryDelayMs)
  }

  function enqueueLibraryWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = librarySaveChain.then(operation)
    librarySaveChain = result.then(
      () => {},
      () => {}
    )
    return result
  }

  async function persistCurrentLibraryUntilStable(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const generation = libraryMutationGeneration
      const saved = await persistLibrarySnapshotWithRevisionRecovery()
      applySavedLibraryMetadata(saved)
      librarySaveRetryDelayMs = 500
      resolvePendingLibrarySavesThrough(generation)
      if (libraryMutationGeneration === generation) return
    }

    pendingSaveResolvers.push({
      generation: libraryMutationGeneration,
      resolve: () => {}
    })
  }

  async function persistLibrarySnapshotWithRevisionRecovery(): Promise<LocalMusicLibraryDocument> {
    try {
      return await window.api.data.saveMusicLibrary(librarySnapshot())
    } catch (error) {
      if (!isMusicLibraryRevisionConflict(error)) throw error
      const authoritative = await loadAuthoritativeLibraryDocument()
      applySavedLibraryMetadata(authoritative)
      applyPendingRejectedRemoval(authoritative)
      return await window.api.data.saveMusicLibrary(librarySnapshot())
    }
  }

  async function loadAuthoritativeLibraryDocument(): Promise<LocalMusicLibraryDocument> {
    const loaded = await window.api.data.loadMusicLibrary()
    if (Array.isArray(loaded)) {
      throw new Error('Authoritative music library does not expose a revision')
    }
    return loaded
  }

  function applySavedLibraryMetadata(document: LocalMusicLibraryDocument): void {
    libraryRevision = document.revision
    excludedTracks.value = document.exclusions
  }

  function applyPendingRejectedRemoval(document: LocalMusicLibraryDocument): void {
    const intent = pendingRejectedRemoval
    if (!intent) return
    const recovered = createRecoveredRemovalResult(document, intent.selectedTracks)
    pendingRejectedRemoval = null
    if (!recovered) return
    applyLocalRemovalDelta(recovered)
    notifyLocalTracksUnavailable(recovered.removedTrackIds, recovered.removedFilePaths)
  }

  function createRecoveredRemovalResult(
    document: LocalMusicLibraryDocument,
    selectedTracks: Track[]
  ): LocalLibraryRemoveResult | null {
    const authoritativePaths = new Set<string>()
    for (const track of document.tracks) {
      if (!track || typeof track !== 'object' || Array.isArray(track)) continue
      const filePath = (track as { filePath?: unknown }).filePath
      if (typeof filePath === 'string' && filePath) {
        authoritativePaths.add(normalizePortableLibraryPath(filePath))
      }
    }
    const removedPaths = selectedTracks
      .map((track) => track.filePath)
      .filter((filePath) => !authoritativePaths.has(normalizePortableLibraryPath(filePath)))
    if (removedPaths.length === 0) return null
    const pathKeys = new Set(removedPaths.map(normalizePortableLibraryPath))
    const removedTrackIds = tracks.value
      .filter((track) => pathKeys.has(normalizePortableLibraryPath(track.filePath)))
      .map((track) => track.id)
    return {
      mode: 'trash',
      library: document,
      removedTrackIds,
      removedFilePaths: Array.from(new Set(removedPaths)),
      failures: []
    }
  }

  function isMusicLibraryRevisionConflict(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return (
      error.name === 'MusicLibraryRevisionConflictError' ||
      /Music library changed concurrently|expected revision/i.test(error.message)
    )
  }

  function increaseLibrarySaveRetryDelay(): void {
    librarySaveRetryDelayMs = Math.min(30_000, Math.max(500, librarySaveRetryDelayMs * 2))
  }

  function clearTrackMetadataMatch(trackId: string): boolean {
    const index = trackIndexById.get(trackId) ?? -1
    if (index < 0 || !tracks.value[index].metadataMatch) return false

    const nextTrack = {
      ...tracks.value[index],
      metadataMatch: null
    }
    replaceTrackAtIndex(index, nextTrack)
    void scheduleSaveLibrary()
    return true
  }

  function applyTrackMetadataMatch(
    trackId: string,
    providerTrack: Track,
    options: ManualMetadataMatchOptions
  ): boolean {
    const index = trackIndexById.get(trackId) ?? -1
    if (index < 0 || getTrackSource(tracks.value[index]) !== 'local') return false

    const { settings } = useSettingsStore()
    const nextTrack = enrichLocalTrackMetadata(
      tracks.value[index],
      {
        track: providerTrack,
        confidence: options.confidence,
        score: options.score
      },
      settings.value.cachePolicy
    )
    replaceTrackAtIndex(index, nextTrack)
    void scheduleSaveLibrary()
    return true
  }

  function clearTracks(): void {
    libraryMetadataEnrichmentQueue?.cancel()
    pendingMetadataEnrichmentUpdates.clear()
    metadataEnrichmentFlushScheduled = false
    librarySettlementInFlight = null
    rebuildScheduled = false
    setTracks([])
    rebuildDerivedCollections()
  }

  function getLibraryMetadataEnrichmentQueue(): LibraryMetadataEnrichmentQueue {
    if (libraryMetadataEnrichmentQueue) return libraryMetadataEnrichmentQueue
    libraryMetadataEnrichmentQueue = new LibraryMetadataEnrichmentQueue({
      provider: {
        searchSongs: async (query, limit, offset) => {
          await (metadataProviderSync ?? syncPluginProviders())
          const providers = useMediaProviders()
          const result = await providers.searchAllSongs({
            query,
            localTracks: [],
            limit,
            offset
          })
          const items = result.items.map((item) => item.track)
          return { items, total: items.length }
        }
      },
      onStatus: (status) => {
        libraryMetadataEnrichmentStatus.value = status
      },
      onTrackEnriched: queueMetadataEnrichmentUpdate
    })
    return libraryMetadataEnrichmentQueue
  }

  function queueBackgroundMetadataEnrichment(inputTracks: Track[]): Promise<void> {
    if (inputTracks.length === 0) return Promise.resolve()
    const { settings } = useSettingsStore()
    const cachePolicy = settings.value.cachePolicy
    if (!cachePolicy.cover && !cachePolicy.lyrics && !cachePolicy.metadata) return Promise.resolve()

    metadataProviderSync = syncPluginProviders().catch((error) => {
      metadataProviderSync = null
      throw error
    })
    const completion = getLibraryMetadataEnrichmentQueue().enqueue(inputTracks, cachePolicy)
    librarySettlementInFlight = completion
    void completion.finally(() => {
      if (librarySettlementInFlight === completion) librarySettlementInFlight = null
    })
    return completion
  }

  function queueMetadataEnrichmentUpdate(update: LibraryMetadataEnrichmentTrackUpdate): void {
    const current = trackById.get(update.track.id)
    if (
      !current ||
      current !== update.source ||
      getTrackSource(current) !== 'local' ||
      current.filePath !== update.track.filePath
    ) {
      return
    }
    pendingMetadataEnrichmentUpdates.set(update.track.id, update)
    if (metadataEnrichmentFlushScheduled) return
    metadataEnrichmentFlushScheduled = true
    queueMicrotask(flushMetadataEnrichmentUpdates)
  }

  function flushMetadataEnrichmentUpdates(): void {
    metadataEnrichmentFlushScheduled = false
    if (pendingMetadataEnrichmentUpdates.size === 0) return
    const updates = new Map(pendingMetadataEnrichmentUpdates)
    pendingMetadataEnrichmentUpdates.clear()
    const nextTracks = tracks.value.slice()
    let changed = false
    for (const [trackId, update] of updates) {
      const index = trackIndexById.get(trackId) ?? -1
      const current = index >= 0 ? nextTracks[index] : undefined
      if (
        !current ||
        current !== update.source ||
        getTrackSource(current) !== 'local' ||
        current.filePath !== update.track.filePath
      ) {
        continue
      }
      nextTracks[index] = update.track
      trackById.set(trackId, update.track)
      trackByPath.set(update.track.filePath, update.track)
      changed = true
    }
    if (!changed) return
    setTracks(nextTracks, { rebuildIndexes: false })
    scheduleRebuild()
    void scheduleSaveLibrary()
  }

  function replaceTrackReference(oldTrackId: string, replacementTrack: Track): number {
    if (!oldTrackId || oldTrackId === replacementTrack.id) return 0
    const playlistBase = clonePlaylistSnapshot()
    let replacementCount = 0
    let libraryChanged = false
    let playlistsChanged = false

    if (trackById.has(oldTrackId)) {
      const oldTrack = trackById.get(oldTrackId)
      if (oldTrack) trackByPath.delete(oldTrack.filePath)
      trackById.delete(oldTrackId)
      trackById.set(replacementTrack.id, replacementTrack)
      trackByPath.set(replacementTrack.filePath, replacementTrack)
      setTracks(tracks.value.map((track) => (track.id === oldTrackId ? replacementTrack : track)))
      libraryChanged = true
      replacementCount++
    }

    for (const playlist of playlists.value) {
      if (!playlist.trackIds.includes(oldTrackId)) continue
      const nextTrackIds: string[] = []
      const seenTrackIds = new Set<string>()
      for (const trackId of playlist.trackIds) {
        const nextTrackId = trackId === oldTrackId ? replacementTrack.id : trackId
        if (seenTrackIds.has(nextTrackId)) continue
        seenTrackIds.add(nextTrackId)
        nextTrackIds.push(nextTrackId)
      }
      playlist.trackIds = nextTrackIds
      const snapshots = { ...(playlist.trackSnapshots ?? {}) }
      delete snapshots[oldTrackId]
      snapshots[replacementTrack.id] = toPlaylistTrackSnapshot(replacementTrack)
      playlist.trackSnapshots = nonEmptySnapshots(snapshots)
      playlistsChanged = true
      replacementCount++
    }

    if (libraryChanged) {
      scheduleRebuild()
      void scheduleSaveLibrary()
    }
    if (playlistsChanged) queuePlaylistPersistence(playlistBase)
    return replacementCount
  }

  function applyBpmAnalysis(
    trackId: string,
    filePath: string,
    analysis: Track['bpmAnalysis']
  ): boolean {
    if (!analysis) return false
    const fallbackTrackId = filePath ? trackByPath.get(filePath)?.id : undefined
    const index =
      trackIndexById.get(trackId) ??
      (fallbackTrackId ? trackIndexById.get(fallbackTrackId) : undefined) ??
      -1
    if (index < 0) return false
    if (equalBpmAnalysis(tracks.value[index].bpmAnalysis, analysis)) return false
    const nextTrack = { ...tracks.value[index], bpmAnalysis: analysis }
    replaceTrackAtIndex(index, nextTrack)

    const playlistBase = clonePlaylistSnapshot()
    let playlistsChanged = false
    for (const playlist of playlists.value) {
      const snapshot = playlist.trackSnapshots?.[trackId] ?? playlist.trackSnapshots?.[nextTrack.id]
      if (!snapshot) continue
      // 快照不再携带 bpmAnalysis；此处仍回写一次以顺带把历史重型快照瘦身。
      playlist.trackSnapshots = {
        ...(playlist.trackSnapshots ?? {}),
        [nextTrack.id]: toPlaylistTrackSnapshot(snapshot)
      }
      playlistsChanged = true
    }

    void scheduleSaveLibrary()
    if (playlistsChanged) queuePlaylistPersistence(playlistBase)
    return true
  }

  function clearBpmAnalysis(): boolean {
    let libraryChanged = false
    const nextTracks = tracks.value.map((track) => {
      if (!track.bpmAnalysis) return track
      const { bpmAnalysis: _bpmAnalysis, ...nextTrack } = track
      libraryChanged = true
      return nextTrack
    })
    if (libraryChanged) {
      setTracks(nextTracks)
      scheduleRebuild()
      void scheduleSaveLibrary()
    }

    const playlistBase = clonePlaylistSnapshot()
    let playlistsChanged = false
    for (const playlist of playlists.value) {
      if (!playlist.trackSnapshots) continue
      let snapshotChanged = false
      const nextSnapshots: Record<string, Track> = {}
      for (const [trackId, snapshot] of Object.entries(playlist.trackSnapshots)) {
        if (snapshot.bpmAnalysis) {
          const { bpmAnalysis: _bpmAnalysis, ...nextSnapshot } = snapshot
          nextSnapshots[trackId] = nextSnapshot
          snapshotChanged = true
        } else {
          nextSnapshots[trackId] = snapshot
        }
      }
      if (snapshotChanged) {
        playlist.trackSnapshots = nextSnapshots
        playlistsChanged = true
      }
    }
    if (playlistsChanged) queuePlaylistPersistence(playlistBase)
    return libraryChanged || playlistsChanged
  }

  if (!derivedCollectionsInitialized) {
    rebuildDerivedCollections()
    derivedCollectionsInitialized = true
  }

  return {
    ...playlistCommands,
    tracks,
    artists,
    albums,
    genres,
    folders,
    playlists,
    playlistPersistenceStatus,
    playlistPersistenceNotice,
    libraryRepairReport,
    excludedTracks,
    addTracks,
    removeTrack,
    removeLocalTracks,
    restoreExcludedTracks,
    clearExcludedTracks,
    applyLocalTagWrite,
    clearTrackMetadataMatch,
    applyTrackMetadataMatch,
    clearTracks,
    replaceTrackReference,
    applyBpmAnalysis,
    clearBpmAnalysis,
    aggregatePlaylists,
    localPlaylists,
    saveLibrary,
    loadLibrary,
    whenLibrarySettled,
    libraryScanStatus,
    libraryScanProgress,
    libraryMetadataEnrichmentStatus,
    startStartupLibraryScan,
    startFullLibraryScan,
    resetLibrary,
    pauseLibraryScan,
    resumeLibraryScan,
    cancelLibraryScan,
    cancelLibraryMetadataEnrichment,
    applyLibraryScanProgress,
    applyLibraryScanStatus,
    refreshLibraryIndex: rebuildDerivedCollections,
    scannedFolders,
    isScanning,
    addFolder(path: string): void {
      if (!scannedFolders.value.includes(path)) {
        scannedFolders.value.push(path)
        libraryMutationGeneration++
        rebuildDerivedCollections()
        saveLibrary()
      }
    },
    removeFolder(path: string): void {
      scannedFolders.value = scannedFolders.value.filter((f) => f !== path)
      libraryMutationGeneration++
      rebuildDerivedCollections()
      saveLibrary()
    },
    syncFolders(folders: string[]): void {
      scannedFolders.value = [...folders]
      const folderPrefixes = folders.map((f) => {
        const normalized = f.replace(/[\\/]+$/, '')
        return normalized + (normalized.includes('\\') ? '\\' : '/')
      })
      setTracks(
        tracks.value.filter((t) =>
          folderPrefixes.some(
            (prefix) => t.filePath.startsWith(prefix) || t.filePath === prefix.slice(0, -1)
          )
        )
      )
      rebuildDerivedCollections()
      saveLibrary()
    },
    flushRebuild,
    getRebuildCount: () => rebuildCount,
    getTrackById: (trackId: string) => trackById.get(trackId),
    scheduleSaveLibrary,
    flushSaveLibrary,
    handleLibraryChange
  }
}
