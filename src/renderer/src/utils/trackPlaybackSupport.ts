export const UNSUPPORTED_TRACK_PLAYBACK_MESSAGE = '当前音源尚不支持这首歌曲'

/** An omitted status preserves the existing playback behavior. */
export function isTrackPlaybackSupported(track: { playbackStatus?: 'unsupported' }): boolean {
  return track.playbackStatus !== 'unsupported'
}

export function filterPlaybackSupportedTracks<T extends { playbackStatus?: 'unsupported' }>(
  tracks: T[]
): T[]
export function filterPlaybackSupportedTracks<T extends { playbackStatus?: 'unsupported' }>(
  tracks: readonly T[]
): readonly T[]
export function filterPlaybackSupportedTracks<T extends { playbackStatus?: 'unsupported' }>(
  tracks: readonly T[]
): readonly T[] {
  return tracks.every(isTrackPlaybackSupported) ? tracks : tracks.filter(isTrackPlaybackSupported)
}

export function unsupportedTracksNotice(count: number): string {
  return `已跳过 ${count} 首当前音源尚不支持的歌曲`
}
