// Common GetSongLevel@1003115a (ev_504c10f5db3c477e649a6b7648aa8da31eb801c637d48dae33ac1276c133ef4a)
// maps UI quality3 -> filename6, quality6 -> filename10, quality7 -> filename12.
// Main's actual labels distinguish 5.1, Hi-Res and Dolby Atmos; no numeric domains are conflated.
const definitions = Object.freeze({
  '128': Object.freeze({ type: 1, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg', sizeKey: 'mp3_128', sizeField: 'size_128mp3' }),
  '320': Object.freeze({ type: 3, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg', sizeKey: 'mp3_320', sizeField: 'size_320mp3' }),
  flac: Object.freeze({ type: 4, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'flac', sizeField: 'size_flac' }),
  surround: Object.freeze({ type: 6, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'surround', sizeField: 'size_dts' }),
  hires: Object.freeze({ type: 10, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'hires', sizeField: 'size_hires' }),
  dolby: Object.freeze({ type: 12, encrypted: true, codec: 'mp4', contentType: 'audio/mp4', sizeKey: 'dolby', sizeField: 'size_dolby' })
})
const aliases = Object.freeze({ default: '128', high: '320', lossless: 'flac' })
// Spatial formats are separate preferences, not rungs in a shared numeric enum.
// A missing spatial source falls back to ordinary audio without trying the other
// spatial format; ordinary selections never upgrade beyond the chosen quality.
const fallbackChains = Object.freeze({
  '128': ['128'], '320': ['320', '128'], flac: ['flac', '320', '128'],
  hires: ['hires', 'flac', '320', '128'],
  dolby: ['dolby', 'hires', 'flac', '320', '128'],
  surround: ['surround', 'hires', 'flac', '320', '128']
})
export const WINDOWS_QUALITY_OPTIONS = Object.freeze([
  ['标准 MP3（128 kbps）', '128'], ['高品质 MP3（320 kbps）', '320'], ['无损 FLAC', 'flac'],
  ['Hi-Res 无损', 'hires'], ['杜比全景声', 'dolby'], ['5.1 品质', 'surround']
].map(([label, value]) => Object.freeze({ label, value })))
export function windowsQualityDefinition(value) {
  if (typeof value !== 'string') return null
  const key = Object.hasOwn(aliases, value) ? aliases[value] : value
  return Object.hasOwn(definitions, key) ? definitions[key] : null
}

export function windowsQualityFallbacks(value) {
  if (!windowsQualityDefinition(value)) return []
  const key = Object.hasOwn(aliases, value) ? aliases[value] : value
  return [...fallbackChains[key]]
}

/** Native file-size flags identify candidates, independently of account permission.
 * Only an explicit nonnegative int32 is proved by the Windows TrackInfo parser.
 */
export function windowsQualityMetadataSize(file, quality) {
  const definition = windowsQualityDefinition(quality)
  if (!definition || !file || typeof file !== 'object' || Array.isArray(file)) return null
  const value = file[definition.sizeField]
  return Number.isInteger(value) && value >= 0 && value <= 0x7fffffff ? value : null
}

export function windowsQualityCandidates(file) {
  return WINDOWS_QUALITY_OPTIONS.map(option => {
    const size = windowsQualityMetadataSize(file, option.value)
    const availability = size === null ? 'unknown' : size === 0 ? 'unavailable' : 'candidate'
    const reason = availability === 'unavailable' ? '当前歌曲未提供该音质'
      : availability === 'unknown' ? '音质信息未知，需尝试验证'
        : '歌曲有该音质记录，播放仍需当前账号验证'
    return { ...option, availability, reason, ...(size === null ? {} : { metadataSize: size }) }
  })
}
