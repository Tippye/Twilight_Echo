export const LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION = 2 as const

export type LocalLibraryRemovalMode = 'library' | 'trash'

export interface LocalLibraryExclusion {
  filePath: string
  title: string
  artist: string
  excludedAt: string
}

export interface LocalMusicLibraryDocument {
  version: typeof LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION
  revision: number
  tracks: unknown[]
  folders: string[]
  exclusions: LocalLibraryExclusion[]
}

export interface LocalLibraryTrackSelection {
  id: string
  filePath: string
  title: string
  artist: string
}

export interface LocalLibrarySnapshotInput {
  revision: number
  tracks: unknown[]
  folders: string[]
}

export interface LocalLibraryRemoveRequest {
  mode: LocalLibraryRemovalMode
  items: LocalLibraryTrackSelection[]
  library: LocalLibrarySnapshotInput
}

export interface LocalLibraryMutationFailure {
  filePath: string
  message: string
}

export interface LocalLibraryRemoveResult {
  mode: LocalLibraryRemovalMode
  library: LocalMusicLibraryDocument
  removedTrackIds: string[]
  removedFilePaths: string[]
  failures: LocalLibraryMutationFailure[]
}

export interface LocalLibraryRestoreRequest {
  filePaths: string[]
  library: LocalLibrarySnapshotInput
}

export interface LocalLibraryRestoreResult {
  library: LocalMusicLibraryDocument
  restoredFilePaths: string[]
}

export interface LocalLibraryClearExclusionsRequest {
  filePaths: string[]
  library: LocalLibrarySnapshotInput
}

export interface LocalLibraryClearExclusionsResult {
  library: LocalMusicLibraryDocument
  clearedFilePaths: string[]
}

export interface LocalLibraryResetResult {
  library: LocalMusicLibraryDocument
  removedTrackIds: string[]
  removedFilePaths: string[]
}
