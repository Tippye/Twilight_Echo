import type { Ref } from 'vue'
import type { Track } from '../../types/music'
import type {
  Playlist,
  PlaylistBatchMoveResult,
  PlaylistImportApplyResult,
  PlaylistPersistenceNotice
} from './musicStoreTypes.ts'
import type { PlaylistPersistenceStatus } from '../playlistPersistence.ts'
import { isAggregatePlaylist } from '../../utils/aggregatePlaylistView.ts'
import {
  getRecordingTrackKey as getLogicalTrackKey,
  canShareTrackIdentity,
  getTrackSource
} from '../../utils/logicalTrackModel.ts'
import {
  exportPlaylistDocument,
  findPlaylistRelocations,
  parsePlaylistDocument,
  reorderStableIds,
  type PlaylistFileFormat,
  type PlaylistImportEntry,
  type PlaylistRelocationResult
} from '../../utils/playlistLifecycle.ts'
import {
  clonePlaylist,
  normalizePortableLibraryPath,
  playlistDataEqual,
  nonEmptySnapshots,
  toPlaylistTrackSnapshot
} from './musicStoreData.ts'
import { createPlaylistState } from './playlistState.ts'
import { createPlaylistTrackResolver } from './playlistTrackResolver.ts'

const DEFAULT_FAVORITE_PLAYLIST_NAME = '我收藏的音乐'

/** Playlist commands share one resolver and persistence owner across store consumers. */
export function createPlaylistController(options: {
  playlists: Ref<Playlist[]>
  tracks: Ref<Track[]>
  trackById: ReadonlyMap<string, Track>
  getTracksRevision: () => number
  playlistPersistenceStatus: Ref<PlaylistPersistenceStatus>
  playlistPersistenceNotice: Ref<PlaylistPersistenceNotice | null>
}) {
  const { playlists, tracks, trackById } = options
  const resolver = createPlaylistTrackResolver(options)
  const state = createPlaylistState({ ...options, onChange: resolver.invalidate })
  const { clonePlaylistSnapshot, queuePlaylistPersistence } = state
  const { getPlaylistTrackSnapshot, getPlaylistIdentity, resolvePlaylistTracks } = resolver

  /**
   * 按名字查找歌单时一律排除聚合歌单。聚合歌单只能通过 id 访问，所以它和普通
   * 歌单可以同名，而所有既有的 by-name API 都不会被它劫持。
   */
  function findLocalPlaylistByName(name: string): Playlist | undefined {
    return playlists.value.find((item) => !isAggregatePlaylist(item) && item.name === name)
  }

  /** 重名校验只在同一类歌单内进行——两类是两个命名空间。 */
  function hasSiblingPlaylistName(playlist: Playlist, name: string): boolean {
    return playlists.value.some(
      (item) =>
        item.id !== playlist.id &&
        isAggregatePlaylist(item) === isAggregatePlaylist(playlist) &&
        item.name === name
    )
  }

  function ensurePlaylist(name: string, options: { isDefault?: boolean } = {}): Playlist {
    const existing = findLocalPlaylistByName(name)
    if (existing) return existing
    const playlist: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      trackIds: [],
      ...(options.isDefault ? { isDefault: true } : {}),
      createdAt: new Date().toISOString()
    }
    playlists.value = [...playlists.value, playlist]
    return playlist
  }

  function createPlaylist(name: string): string {
    const existing = findLocalPlaylistByName(name)
    if (existing) return existing.id
    const base = clonePlaylistSnapshot()
    const playlist = ensurePlaylist(name)
    queuePlaylistPersistence(base)
    return playlist.id
  }

  function createPlaylistWithTracks(name: string, playlistTracks: Track[]): string {
    const base = clonePlaylistSnapshot()
    const existing = findLocalPlaylistByName(name)
    const playlist = existing ?? ensurePlaylist(name)
    const changed = appendTracksToPlaylist(playlist, playlistTracks)
    if (!existing || changed) queuePlaylistPersistence(base)
    return playlist.id
  }

  function normalizePlaylistName(value: string): string {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) throw new Error('歌单名称不能为空')
    if (normalized.length > 80) throw new Error('歌单名称不能超过 80 个字符')
    return normalized
  }

  function touchPlaylist(playlist: Playlist): void {
    playlist.updatedAt = new Date().toISOString()
  }

  function updatePlaylist(playlist: Playlist, patch: Partial<Playlist>): boolean {
    const base = clonePlaylistSnapshot()
    Object.assign(playlist, patch)
    touchPlaylist(playlist)
    queuePlaylistPersistence(base)
    return true
  }

  function renamePlaylist(playlistId: string, name: string): boolean {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist) return false
    const normalizedName = normalizePlaylistName(name)
    if (playlist.name === normalizedName) return false
    if (hasSiblingPlaylistName(playlist, normalizedName)) {
      throw new Error('已存在同名歌单')
    }
    return updatePlaylist(playlist, { name: normalizedName })
  }

  function setPlaylistCover(playlistId: string, cover: string | null): boolean {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist) return false
    const nextCover = cover?.trim() || null
    if (nextCover && nextCover.length > 8 * 1024 * 1024) {
      throw new Error('歌单封面数据超过 8 MiB 上限')
    }
    if (nextCover && !/^(data:image\/(?:png|jpeg|webp);base64,|cover:\/\/)/i.test(nextCover)) {
      throw new Error('歌单封面必须是受支持的图片数据')
    }
    if ((playlist.cover ?? null) === nextCover) return false
    return updatePlaylist(playlist, { cover: nextCover })
  }

  function copyPlaylist(playlistId: string, name: string): string | null {
    const source = playlists.value.find((item) => item.id === playlistId)
    if (!source) return null
    const normalizedName = normalizePlaylistName(name)
    if (hasSiblingPlaylistName(source, normalizedName)) {
      throw new Error('已存在同名歌单')
    }
    const base = clonePlaylistSnapshot()
    const now = new Date().toISOString()
    const copy: Playlist = {
      ...clonePlaylist(source),
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      isDefault: false,
      createdAt: now,
      updatedAt: now
    }
    playlists.value = [...playlists.value, copy]
    queuePlaylistPersistence(base)
    return copy.id
  }

  function reorderPlaylistTracks(
    playlistName: string,
    trackIds: Iterable<string>,
    targetIndex: number
  ): boolean {
    const playlist = findLocalPlaylistByName(playlistName)
    if (!playlist || !Number.isInteger(targetIndex)) return false
    const nextTrackIds = reorderStableIds(playlist.trackIds, trackIds, targetIndex)
    if (playlistDataEqual(nextTrackIds, playlist.trackIds)) return false
    return updatePlaylist(playlist, { trackIds: nextTrackIds })
  }

  function movePlaylistTracks(
    sourcePlaylistName: string,
    targetPlaylistName: string,
    trackIds: Iterable<string>
  ): PlaylistBatchMoveResult {
    const source = findLocalPlaylistByName(sourcePlaylistName)
    const target = findLocalPlaylistByName(targetPlaylistName)
    if (!source || !target || source === target) return { moved: 0, sourceRemoved: 0 }
    const selected = new Set(trackIds)
    if (selected.size === 0) return { moved: 0, sourceRemoved: 0 }
    const sourceIds = source.trackIds.filter((id) => selected.has(id))
    if (sourceIds.length === 0) return { moved: 0, sourceRemoved: 0 }
    const base = clonePlaylistSnapshot()
    const targetKnown = new Set(target.trackIds)
    const nextTargetIds = target.trackIds.slice()
    const nextTargetSnapshots = { ...(target.trackSnapshots ?? {}) }
    let moved = 0
    for (const id of sourceIds) {
      if (!targetKnown.has(id)) {
        targetKnown.add(id)
        nextTargetIds.push(id)
        moved++
      }
      const snapshot = source.trackSnapshots?.[id] ?? trackById.get(id)
      if (snapshot && !nextTargetSnapshots[id])
        nextTargetSnapshots[id] = toPlaylistTrackSnapshot(snapshot)
    }
    source.trackIds = source.trackIds.filter((id) => !selected.has(id))
    if (source.trackSnapshots) {
      const nextSourceSnapshots = { ...source.trackSnapshots }
      for (const id of selected) delete nextSourceSnapshots[id]
      source.trackSnapshots = nonEmptySnapshots(nextSourceSnapshots)
    }
    target.trackIds = nextTargetIds
    target.trackSnapshots = nonEmptySnapshots(nextTargetSnapshots)
    touchPlaylist(source)
    touchPlaylist(target)
    queuePlaylistPersistence(base)
    return { moved, sourceRemoved: sourceIds.length }
  }

  function importPlaylistDocument(
    name: string,
    fileName: string,
    contents: string
  ): PlaylistImportApplyResult {
    const parsed = parsePlaylistDocument(contents, fileName)
    return applyPlaylistEntries(name, parsed.entries, parsed.warnings)
  }

  /**
   * The shared tail of every import path: match entries against the live
   * library, create-or-extend the playlist, and queue persistence. Plugins reach
   * it through `importPlaylistPaths` without going through playlist *text*.
   */
  function applyPlaylistEntries(
    name: string,
    entries: readonly PlaylistImportEntry[],
    warnings: string[] = []
  ): PlaylistImportApplyResult {
    return applyPlaylistEntryBatch([{ name, entries, warnings }])[0]
  }

  function applyPlaylistEntryBatch(
    batch: readonly {
      name: string
      entries: readonly PlaylistImportEntry[]
      warnings?: string[]
    }[]
  ): PlaylistImportApplyResult[] {
    if (batch.length === 0) return []
    // Validate all names before mutating, and share the index and transaction
    // snapshots across the whole batch rather than copying every growing prefix.
    const normalizedNames = batch.map((item) => normalizePlaylistName(item.name))
    const byPath = new Map<string, Track>()
    for (const track of tracks.value)
      byPath.set(normalizePortableLibraryPath(track.filePath), track)
    const base = clonePlaylistSnapshot()
    let batchChanged = false
    const results = batch.map(({ entries, warnings = [] }, index) => {
      const imported: Track[] = []
      let unresolvedEntries = 0
      for (const entry of entries) {
        const normalizedPath = normalizePortableLibraryPath(entry.path)
        let matched = byPath.get(normalizedPath)
        if (!matched && !/^[a-zA-Z]:\\/.test(normalizedPath) && !normalizedPath.startsWith('\\')) {
          const suffix = `\\${normalizedPath}`
          const candidates = tracks.value.filter((track) =>
            normalizePortableLibraryPath(track.filePath).endsWith(suffix)
          )
          if (candidates.length === 1) matched = candidates[0]
        }
        if (matched) imported.push(matched)
        else unresolvedEntries++
      }
      const normalizedName = normalizedNames[index]
      const existing = findLocalPlaylistByName(normalizedName)
      const playlist = existing ?? ensurePlaylist(normalizedName)
      const changed = appendTracksToPlaylist(playlist, imported)
      if (changed || !existing) {
        touchPlaylist(playlist)
        batchChanged = true
      }
      return {
        playlistId: playlist.id,
        importedCount: imported.length,
        unresolvedEntries,
        warnings
      }
    })
    if (batchChanged) queuePlaylistPersistence(base)
    return results
  }

  /**
   * Entry point for plugin-supplied playlists (see `shared/pluginPlaylistImport`).
   * Paths are matched against the library exactly like a `#EXTINF` entry would
   * be, so a plugin never has to know local track ids.
   */
  function importPlaylistPaths(name: string, paths: readonly string[]): PlaylistImportApplyResult {
    return applyPlaylistEntries(
      name,
      paths.map((path) => ({ path }))
    )
  }

  function importPlaylistPathBatch(
    batch: readonly { name: string; paths: readonly string[] }[]
  ): PlaylistImportApplyResult[] {
    return applyPlaylistEntryBatch(
      batch.map(({ name, paths }) => ({
        name,
        entries: paths.map((path) => ({ path }))
      }))
    )
  }

  function exportPlaylistDocumentForStore(
    playlistName: string,
    format: PlaylistFileFormat
  ): string | null {
    const playlist = findLocalPlaylistByName(playlistName)
    if (!playlist) return null
    return exportPlaylistDocument(getPlaylistTracks(playlistName), format)
  }

  function repairPlaylistMissingTracks(
    playlistName: string,
    candidates: Track[]
  ): PlaylistRelocationResult {
    const playlist = findLocalPlaylistByName(playlistName)
    if (!playlist) return { relocations: [], unresolvedTrackIds: [], ambiguousTrackIds: [] }
    const missing = playlist.trackIds
      .filter((id) => !trackById.has(id))
      .map((id) => playlist.trackSnapshots?.[id])
      .filter((track): track is Track => !!track && getTrackSource(track) === 'local')
    const result = findPlaylistRelocations(missing, candidates)
    if (result.relocations.length === 0) return result
    const base = clonePlaylistSnapshot()
    const replacements = new Map(result.relocations.map((item) => [item.trackId, item.toTrack]))
    const nextTrackIds: string[] = []
    const snapshots: Record<string, Track> = { ...(playlist.trackSnapshots ?? {}) }
    const seen = new Set<string>()
    for (const id of playlist.trackIds) {
      const replacement = replacements.get(id)
      const nextId = replacement?.id ?? id
      if (seen.has(nextId)) continue
      seen.add(nextId)
      nextTrackIds.push(nextId)
      if (replacement) {
        delete snapshots[id]
        snapshots[nextId] = toPlaylistTrackSnapshot(replacement)
      }
    }
    playlist.trackIds = nextTrackIds
    playlist.trackSnapshots = nonEmptySnapshots(snapshots)
    touchPlaylist(playlist)
    queuePlaylistPersistence(base)
    return result
  }

  function deletePlaylist(playlistId: string): void {
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (!pl || pl.isDefault) return
    const base = clonePlaylistSnapshot()
    playlists.value = playlists.value.filter((p) => p.id !== playlistId)
    queuePlaylistPersistence(base)
  }

  function addToPlaylist(playlistName: string, trackId: string, trackSnapshot?: Track): void {
    const track = trackSnapshot ?? trackById.get(trackId)
    if (track) {
      addTracksToPlaylist(playlistName, [track])
      return
    }
    const playlist = findLocalPlaylistByName(playlistName)
    if (!playlist || playlist.trackIds.includes(trackId)) return
    const base = clonePlaylistSnapshot()
    playlist.trackIds = [...playlist.trackIds, trackId]
    queuePlaylistPersistence(base)
  }

  function appendTracksToPlaylist(playlist: Playlist, playlistTracks: Track[]): boolean {
    const knownIds = new Set(playlist.trackIds)
    const nextTrackIds = playlist.trackIds.slice()
    const nextSnapshots = { ...(playlist.trackSnapshots ?? {}) }
    let changed = false
    for (const track of playlistTracks) {
      if (!knownIds.has(track.id)) {
        knownIds.add(track.id)
        nextTrackIds.push(track.id)
        changed = true
      }
      const snapshot = toPlaylistTrackSnapshot(track)
      if (!nextSnapshots[track.id]) {
        nextSnapshots[track.id] = snapshot
        changed = true
      }
    }
    if (!changed) return false
    playlist.trackIds = nextTrackIds
    playlist.trackSnapshots = nonEmptySnapshots(nextSnapshots)
    return true
  }

  function addTracksToPlaylistRecord(playlist: Playlist, playlistTracks: Track[]): number {
    if (playlistTracks.length === 0) return 0
    const base = clonePlaylistSnapshot()
    const beforeCount = playlist.trackIds.length
    const changed = appendTracksToPlaylist(playlist, playlistTracks)
    if (changed) queuePlaylistPersistence(base)
    return playlist.trackIds.length - beforeCount
  }

  function addTracksToPlaylist(playlistName: string, playlistTracks: Track[]): number {
    const playlist = findLocalPlaylistByName(playlistName)
    return playlist ? addTracksToPlaylistRecord(playlist, playlistTracks) : 0
  }

  function addTracksToPlaylistById(playlistId: string, playlistTracks: Track[]): number {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    return playlist ? addTracksToPlaylistRecord(playlist, playlistTracks) : 0
  }

  function removeFromPlaylist(playlistName: string, trackId: string): void {
    removeTracksFromPlaylist(playlistName, [trackId])
  }

  function removeTracksFromPlaylistRecord(playlist: Playlist, trackIds: Iterable<string>): number {
    const removedIds = new Set(trackIds)
    if (removedIds.size === 0) return 0
    const nextTrackIds = playlist.trackIds.filter((trackId) => !removedIds.has(trackId))
    const removedCount = playlist.trackIds.length - nextTrackIds.length
    if (removedCount === 0) return 0
    const base = clonePlaylistSnapshot()
    playlist.trackIds = nextTrackIds
    if (playlist.trackSnapshots) {
      const nextSnapshots = { ...playlist.trackSnapshots }
      for (const trackId of removedIds) delete nextSnapshots[trackId]
      playlist.trackSnapshots = nonEmptySnapshots(nextSnapshots)
    }
    queuePlaylistPersistence(base)
    return removedCount
  }

  function removeTracksFromPlaylist(playlistName: string, trackIds: Iterable<string>): number {
    const playlist = findLocalPlaylistByName(playlistName)
    return playlist ? removeTracksFromPlaylistRecord(playlist, trackIds) : 0
  }

  function removeTracksFromPlaylistById(playlistId: string, trackIds: Iterable<string>): number {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    return playlist ? removeTracksFromPlaylistRecord(playlist, trackIds) : 0
  }

  function getDefaultFavoritePlaylist(): Playlist | null {
    return (
      playlists.value.find((playlist) => playlist.isDefault) ??
      findLocalPlaylistByName(DEFAULT_FAVORITE_PLAYLIST_NAME) ??
      null
    )
  }

  function isFavoriteTrack(track: Track): boolean {
    const playlist = getDefaultFavoritePlaylist()
    if (!playlist) return false
    const identity = getPlaylistIdentity(playlist)
    if (identity.ids.has(track.id)) return true
    const candidates = identity.snapshotsByLogicalKey.get(getLogicalTrackKey(track))
    return candidates?.some((candidate) => canShareTrackIdentity(candidate, track)) ?? false
  }

  function addFavoriteTrack(track: Track): boolean {
    return setFavoriteTracks([track], true) > 0
  }

  function removeFavoriteTrack(track: Track): boolean {
    return setFavoriteTracks([track], false) > 0
  }

  function setFavoriteTracks(favoriteTracks: Track[], favorite: boolean): number {
    if (favoriteTracks.length === 0) return 0
    const playlist = getDefaultFavoritePlaylist()
    if (favorite) {
      const base = clonePlaylistSnapshot()
      const target = playlist ?? ensurePlaylist(DEFAULT_FAVORITE_PLAYLIST_NAME, { isDefault: true })
      const identity = getPlaylistIdentity(target)
      const knownIds = new Set(identity.ids)
      // Copy the buckets: the map above is cached and must not be mutated.
      const knownByLogicalKey = new Map<string, Track[]>()
      for (const [key, snapshots] of identity.snapshotsByLogicalKey) {
        knownByLogicalKey.set(key, [...snapshots])
      }
      const toAdd = favoriteTracks.filter((track) => {
        if (knownIds.has(track.id)) return false
        const logicalKey = getLogicalTrackKey(track)
        const known = knownByLogicalKey.get(logicalKey)
        if (known?.some((candidate) => canShareTrackIdentity(candidate, track))) return false
        knownIds.add(track.id)
        if (known) known.push(track)
        else knownByLogicalKey.set(logicalKey, [track])
        return true
      })
      const created = !playlist
      const added = appendTracksToPlaylist(target, toAdd)
      if (created || added) queuePlaylistPersistence(base)
      return toAdd.length
    }

    if (!playlist) return 0
    const ids = new Set(favoriteTracks.map((track) => track.id))
    // Mirror the add/query rule: drop the entries that are this recording, and
    // leave a same-titled neighbour alone.
    const requestedByLogicalKey = new Map<string, Track[]>()
    for (const track of favoriteTracks) {
      const key = getLogicalTrackKey(track)
      const bucket = requestedByLogicalKey.get(key)
      if (bucket) bucket.push(track)
      else requestedByLogicalKey.set(key, [track])
    }
    const nextTrackIds = playlist.trackIds.filter((trackId) => {
      if (ids.has(trackId)) return false
      const snapshot = getPlaylistTrackSnapshot(playlist, trackId)
      if (!snapshot) return true
      const requested = requestedByLogicalKey.get(getLogicalTrackKey(snapshot))
      return !requested?.some((track) => canShareTrackIdentity(track, snapshot))
    })
    const removedCount = playlist.trackIds.length - nextTrackIds.length
    if (removedCount === 0) return 0
    const base = clonePlaylistSnapshot()
    const keptTrackIds = new Set(nextTrackIds)
    playlist.trackIds = nextTrackIds
    if (playlist.trackSnapshots) {
      const snapshots = { ...playlist.trackSnapshots }
      for (const trackId of Object.keys(snapshots)) {
        if (!keptTrackIds.has(trackId)) delete snapshots[trackId]
      }
      playlist.trackSnapshots = nonEmptySnapshots(snapshots)
    }
    queuePlaylistPersistence(base)
    return removedCount
  }

  function getPlaylistTracks(playlistName: string): Track[] {
    const pl = findLocalPlaylistByName(playlistName)
    return pl ? resolvePlaylistTracks(pl) : []
  }

  function getPlaylistTracksById(playlistId: string): Track[] {
    const pl = playlists.value.find((p) => p.id === playlistId)
    if (!pl) return []
    return resolvePlaylistTracks(pl, isAggregatePlaylist(pl))
  }

  function createAggregatePlaylist(name: string): string {
    const normalizedName = normalizePlaylistName(name)
    // 聚合歌单与普通歌单是两个命名空间，所以只在聚合歌单里查重——用户不该因为
    // 某个普通歌单占了名字而没法这么叫自己的聚合歌单。
    const existing = playlists.value.find(
      (playlist) => isAggregatePlaylist(playlist) && playlist.name === normalizedName
    )
    if (existing) return existing.id
    const base = clonePlaylistSnapshot()
    const playlist: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      trackIds: [],
      kind: 'aggregate',
      createdAt: new Date().toISOString()
    }
    playlists.value = [...playlists.value, playlist]
    queuePlaylistPersistence(base)
    return playlist.id
  }

  function setPlaylistPinned(playlistId: string, pinned: boolean): boolean {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist) return false
    // 重复置顶不刷新时间戳，否则同一个按钮点两下会让列表无意义地重排。
    if (pinned === !!playlist.pinnedAt) return false
    return updatePlaylist(playlist, { pinnedAt: pinned ? new Date().toISOString() : null })
  }

  function setPlaylistHiddenSources(playlistId: string, sources: string[]): boolean {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist) return false
    const normalized = Array.from(new Set(sources.map((source) => source.trim()).filter(Boolean)))
    const nextValue = normalized.length > 0 ? normalized : undefined
    if (playlistDataEqual(playlist.hiddenSources, nextValue)) return false
    return updatePlaylist(playlist, { hiddenSources: nextValue })
  }

  function setPlaylistVariantPreference(
    playlistId: string,
    anchorTrackId: string,
    source: string | null
  ): boolean {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist || !anchorTrackId) return false
    const current = playlist.variantPreferences ?? {}
    const normalizedSource = source?.trim() || null
    if ((current[anchorTrackId] ?? null) === normalizedSource) return false
    const next = { ...current }
    if (normalizedSource) next[anchorTrackId] = normalizedSource
    else delete next[anchorTrackId]
    return updatePlaylist(playlist, {
      variantPreferences: Object.keys(next).length > 0 ? next : undefined
    })
  }
  return {
    ...state,
    createPlaylist,
    createPlaylistWithTracks,
    renamePlaylist,
    setPlaylistCover,
    copyPlaylist,
    reorderPlaylistTracks,
    movePlaylistTracks,
    importPlaylistDocument,
    importPlaylistPaths,
    importPlaylistPathBatch,
    exportPlaylistDocument: exportPlaylistDocumentForStore,
    repairPlaylistMissingTracks,
    deletePlaylist,
    addToPlaylist,
    addTracksToPlaylist,
    addTracksToPlaylistById,
    removeFromPlaylist,
    removeTracksFromPlaylist,
    removeTracksFromPlaylistById,
    isFavoriteTrack,
    addFavoriteTrack,
    removeFavoriteTrack,
    setFavoriteTracks,
    getPlaylistTracks,
    getPlaylistTracksById,
    createAggregatePlaylist,
    setPlaylistPinned,
    setPlaylistHiddenSources,
    setPlaylistVariantPreference
  }
}
