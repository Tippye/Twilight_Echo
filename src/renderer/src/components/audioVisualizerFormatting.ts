import { getTrackSource } from '@renderer/utils/trackSourceIdentity.ts'

export function formatVisualizerBitrateValue(bitrate?: number): number | null {
  if (typeof bitrate !== 'number' || !Number.isFinite(bitrate) || bitrate <= 0) return null
  return Math.round(bitrate >= 10000 ? bitrate / 1000 : bitrate)
}

export function formatVisualizerBitrate(bitrate?: number): string {
  const value = formatVisualizerBitrateValue(bitrate)
  return value === null ? '' : `${value} kbps`
}

export function buildVisualizerQualityString(track: {
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}): string {
  const parts: string[] = []
  const bitrate = formatVisualizerBitrateValue(track.bitrate)
  if (track.format) parts.push(track.format.toUpperCase())
  if (track.bitDepth) parts.push(`${track.bitDepth}-bit`)
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)}kHz`)
  if (bitrate !== null) parts.push(`${bitrate}kbps`)
  return parts.join(' / ')
}

export function formatVisualizerSource(track: { id: string; source?: string }): string {
  const source = getTrackSource(track)
  switch (source) {
    case 'local':
      return 'LOCAL'
    case 'ncm':
      return 'NCM'
    case 'network':
      return 'NETWORK'
    case 'radio':
      return 'RADIO'
    case 'podcast':
      return 'PODCAST'
    default:
      return source.toUpperCase()
  }
}

interface VisualizerTrackMetadata {
  id: string
  source?: string
  filePath: string
  fileName: string
  streamUrl?: string | null
  size: number
  format?: string
  sampleRate?: number
  bitrate?: number
  bitDepth?: number
}

interface VisualizerPlaybackMetadata {
  source: string
  rendererSource?: string
  sourceBytes?: number
  codec: string
  sourceSampleRate: number
  sourceChannels?: number
  sourceBitDepth: number
  bitrate: number
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function formatCodec(codec: string, fileName: string): string {
  const normalized = codec.trim().toLowerCase()
  if (normalized.startsWith('mp3')) return 'MP3'
  if (normalized.startsWith('pcm_')) {
    const extension = fileName.match(/\.(wav|wave|aif|aiff)$/i)?.[1]?.toUpperCase()
    return extension === 'WAVE' ? 'WAV' : (extension ?? 'PCM')
  }
  if (normalized && normalized !== '未知') return normalized.toUpperCase()
  return (
    fileName.match(/\.(flac|mp3|m4a|aac|ogg|opus|wav|aiff|ape|wv|dsf|dff)$/i)?.[1]?.toUpperCase() ??
    ''
  )
}

export function resolveVisualizerAudioMetadata(
  track: VisualizerTrackMetadata,
  playbackInfo?: VisualizerPlaybackMetadata | null
): {
  quality: string
  samplerate: string
  bitdepth: string
  channels: string
  bitrate: string
  filesize: string
  format: string
} {
  const sourceMatches =
    !!playbackInfo?.source &&
    [playbackInfo.rendererSource, playbackInfo.source].some(
      (source) => !!source && (source === track.streamUrl || source === track.filePath)
    )
  const source = sourceMatches ? playbackInfo : null
  const codec = source?.codec.trim().toLowerCase() ?? ''
  const losslessCodec = /^(flac|alac|ape|wavpack|tta|dsd|dst|pcm_)/.test(codec)
  const sampleRate = source
    ? positiveNumber(source.sourceSampleRate)
    : positiveNumber(track.sampleRate)
  const bitDepth = source
    ? losslessCodec
      ? positiveNumber(source.sourceBitDepth)
      : undefined
    : positiveNumber(track.bitDepth)
  const bitrate = source ? positiveNumber(source.bitrate) : positiveNumber(track.bitrate)
  const channels = positiveNumber(source?.sourceChannels)
  const format = source
    ? formatCodec(source.codec, track.fileName)
    : track.format?.trim() || formatCodec('', track.fileName)
  const sourceBytes = source?.sourceBytes
  const size =
    sourceBytes !== undefined && Number.isSafeInteger(sourceBytes) && sourceBytes > 0
      ? sourceBytes
      : getTrackSource(track) === 'local'
        ? positiveNumber(track.size)
        : undefined

  return {
    quality: buildVisualizerQualityString({ format, sampleRate, bitDepth, bitrate }),
    samplerate: sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : '',
    bitdepth: bitDepth ? `${bitDepth}-bit` : '',
    channels:
      channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : channels ? `${channels} channels` : '',
    bitrate: formatVisualizerBitrate(bitrate),
    filesize: size ? `${(size / (1024 * 1024)).toFixed(1)} MB` : '',
    format
  }
}
