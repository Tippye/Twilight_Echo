import type { CueRange, ParsedCueSheet } from './cue.ts'
import type { BpmAnalysisResult } from './audioEngineTypes.ts'
import type { NcmPlaybackQuality } from './appSettings.ts'

export type BuiltInTrackSource = 'local' | 'ncm'
export type TrackSource = BuiltInTrackSource | (string & {})
export type MetadataMatchConfidence = 'high' | 'medium'

/** Entries remain aligned with the artist display string even when an id is unknown. */
export interface TrackArtistRef {
  id?: string | number
  name: string
}

export function isTrackReferenceString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 8192 &&
    value.trim().length > 0 &&
    !value.includes('\0')
  )
}

export function isTrackArtistRefs(value: unknown): value is TrackArtistRef[] {
  return (
    Array.isArray(value) &&
    value.length <= 128 &&
    Array.from(value).every(
      (artist) =>
        artist &&
        typeof artist === 'object' &&
        !Array.isArray(artist) &&
        typeof artist.name === 'string' &&
        artist.name.length <= 8192 &&
        !artist.name.includes('\0') &&
        (artist.id === undefined ||
          isTrackReferenceString(artist.id) ||
          (typeof artist.id === 'number' && Number.isSafeInteger(artist.id)))
    )
  )
}

export function cloneTrackArtistRefs(value: unknown): TrackArtistRef[] | undefined {
  return isTrackArtistRefs(value)
    ? value.map((artist) => ({
        name: artist.name,
        ...(artist.id !== undefined ? { id: artist.id } : {})
      }))
    : undefined
}

export interface TrackMetadataMatch {
  providerId: string
  trackId: string
  confidence: MetadataMatchConfidence
  score: number
}

export interface TrackData {
  id: string
  /** Metadata remains visible when the current source cannot play the track. */
  playbackStatus?: 'unsupported'
  title: string
  artist: string
  artists?: TrackArtistRef[]
  album: string
  albumId?: string
  filePath: string
  fileName: string
  dir?: string
  subTrack?: string
  /** Logical source segment for a single-file CUE track. */
  cueRange?: CueRange
  cueSheetPath?: string
  cueEncoding?: ParsedCueSheet['encoding']
  duration: number
  size: number
  cover: string | null
  lyrics: string | null
  translatedLyrics?: string | null
  metadataMatch?: TrackMetadataMatch | null
  source?: TrackSource
  ncmSongId?: number
  streamUrl?: string | null
  streamQuality?: NcmPlaybackQuality
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
  bpm?: number
  bpmAnalysis?: BpmAnalysisResult
  discNumber?: number
  trackNumber?: number
  replayGainTrackGainDb?: number
  replayGainAlbumGainDb?: number
  replayGainTrackPeak?: number
  replayGainAlbumPeak?: number
  r128TrackGainDb?: number
  r128AlbumGainDb?: number
}
