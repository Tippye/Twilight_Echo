import type { Track } from '../types/music.ts'

export interface PlaybackQueueRemovalState {
  currentTrack: Track | null
  queue: Track[]
  originalQueue: Track[]
  queueIndex: number
}

export interface PlaybackQueueRemovalResult extends PlaybackQueueRemovalState {
  activeTrackRemoved: boolean
}

type LocalTracksUnavailableListener = (trackIds: string[], filePaths: string[]) => void
type LocalTracksRemovalRequestedListener = (
  trackIds: string[],
  filePaths: string[]
) => void | Promise<void>

const unavailableListeners = new Set<LocalTracksUnavailableListener>()
const removalRequestedListeners = new Set<LocalTracksRemovalRequestedListener>()

export function onLocalTracksUnavailable(listener: LocalTracksUnavailableListener): () => void {
  unavailableListeners.add(listener)
  return () => unavailableListeners.delete(listener)
}

/**
 * Gives playback and other local-file consumers a chance to close their
 * handles before the main process asks the operating system to trash a file.
 * The listeners are intentionally awaited in registration order so a caller
 * never races the following library mutation with an in-flight release.
 */
export function onLocalTracksRemovalRequested(
  listener: LocalTracksRemovalRequestedListener
): () => void {
  removalRequestedListeners.add(listener)
  return () => removalRequestedListeners.delete(listener)
}

export async function prepareLocalTracksForRemoval(
  trackIds: string[],
  filePaths: string[]
): Promise<void> {
  for (const listener of removalRequestedListeners) {
    try {
      await listener(trackIds, filePaths)
    } catch (error) {
      console.error('[library] Failed to release a local track before trashing:', error)
    }
  }
}

export function notifyLocalTracksUnavailable(trackIds: string[], filePaths: string[]): void {
  if (trackIds.length === 0 && filePaths.length === 0) return
  for (const listener of unavailableListeners) {
    try {
      listener(trackIds, filePaths)
    } catch (error) {
      console.error('[library] Failed to clean an unavailable playback reference:', error)
    }
  }
}

export function selectLocalLibraryActionTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => getTrackSource(track) === 'local')
}

export function pruneUnavailableLocalTracks(
  state: PlaybackQueueRemovalState,
  removedTrackIds: Iterable<string>,
  removedFilePaths: Iterable<string>
): PlaybackQueueRemovalResult {
  const ids = new Set(removedTrackIds)
  const paths = new Set(Array.from(removedFilePaths, normalizePortablePath))
  const isRemoved = (track: Track): boolean =>
    ids.has(track.id) || paths.has(normalizePortablePath(track.filePath))
  const activeTrackRemoved = !!state.currentTrack && isRemoved(state.currentTrack)
  const currentTrack = activeTrackRemoved ? null : state.currentTrack
  const queue = state.queue.filter((track) => !isRemoved(track))
  const originalQueue = state.originalQueue.filter((track) => !isRemoved(track))
  const queueIndex = currentTrack
    ? queue.findIndex(
        (track) =>
          track.id === currentTrack.id ||
          normalizePortablePath(track.filePath) === normalizePortablePath(currentTrack.filePath)
      )
    : -1

  return {
    currentTrack,
    queue,
    originalQueue,
    queueIndex,
    activeTrackRemoved
  }
}

function normalizePortablePath(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\').replace(/\\+/g, '\\')
  return /^[a-zA-Z]:\\/.test(normalized) ? normalized.toLocaleLowerCase('en-US') : normalized
}

function getTrackSource(track: Pick<Track, 'id' | 'source'>): string {
  if (track.source) return track.source
  if (/^[a-zA-Z]:[\\/]/.test(track.id) || /^[\\/]/.test(track.id)) return 'local'
  const separatorIndex = track.id.indexOf(':')
  return separatorIndex > 0 ? track.id.slice(0, separatorIndex) : 'local'
}
