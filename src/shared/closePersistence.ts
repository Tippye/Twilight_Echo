export type RendererClosePersistenceOutcome =
  | { status: 'saved' }
  | { status: 'failed'; error: string }

/**
 * Options for the renderer-side flush triggered before the window closes or
 * before Afterglow unloads it. `includeQueue` forces the playback queue
 * snapshot into the persisted session so the main process can rebuild the UI
 * from it later without asking the renderer.
 */
export interface PlaybackSessionSaveOptions {
  includeQueue?: boolean
}

export const normalizePlaybackSessionSaveOptions = (value: unknown): PlaybackSessionSaveOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return (value as Record<string, unknown>).includeQueue === true ? { includeQueue: true } : {}
}
