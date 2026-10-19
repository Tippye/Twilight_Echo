// Common GetSongLevel@1003115a (ev_504c10f5db3c477e649a6b7648aa8da31eb801c637d48dae33ac1276c133ef4a)
// maps UI quality3 -> filename6, quality6 -> filename10, quality7 -> filename12.
// Main's actual labels distinguish 5.1, Hi-Res and Dolby Atmos; no numeric domains are conflated.
const definitions = Object.freeze({
  '128': Object.freeze({ type: 1, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg', sizeKey: 'mp3_128', sizeField: 'size_128mp3' }),
  '320': Object.freeze({ type: 3, encrypted: false, codec: 'mp3', contentType: 'audio/mpeg', sizeKey: 'mp3_320', sizeField: 'size_320mp3' }),
  flac: Object.freeze({ type: 4, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'flac', sizeField: 'size_flac' }),
  surround: Object.freeze({ type: 6, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'surround', sizeField: 'size_dts' }),
  hires: Object.freeze({ type: 10, encrypted: true, codec: 'flac', contentType: 'audio/flac', sizeKey: 'hires', sizeField: 'size_hires' }),
  dolby: Object.freeze({ type: 12, encrypted: true, codec: 'mp4', contentType: 'audio/mp4', sizeKey: 'dolby', sizeField: 'size_dolby' }),
  // Protocol10045c05: size_new[0]/[8] set flags0x1000/0x2000. Common10030d90
  // selects vs[3]/vs[29] as the replacement MID. Master UI9 -> type14;
  // Galaxy UI10 with native GalaxyDetailSwitch=0 -> type15. Other detail modes
  // (type16/18) are separate native formats, not an inferred default fallback.
  master: Object.freeze({ type: 14, encrypted: true, codec: 'flac', contentType: 'audio/flac',
    sizeKey: 'master', sizeField: 'size_new', sizeIndex: 0, otherMidIndex: 3 }),
  galaxy: Object.freeze({ type: 15, encrypted: true, codec: 'flac', contentType: 'audio/flac',
    sizeKey: 'galaxy', sizeField: 'size_new', sizeIndex: 8, otherMidIndex: 29 })
})
const aliases = Object.freeze({ default: '128', high: '320', lossless: 'flac' })
// Spatial formats are separate preferences, not rungs in a shared numeric enum.
// A missing spatial source falls back to ordinary audio without trying the other
// spatial format; ordinary selections never upgrade beyond the chosen quality.
const fallbackChains = Object.freeze({
  '128': ['128'], '320': ['320', '128'], flac: ['flac', '320', '128'],
  hires: ['hires', 'flac', '320', '128'],
  dolby: ['dolby', 'hires', 'flac', '320', '128'],
  surround: ['surround', 'hires', 'flac', '320', '128'],
  master: ['master', 'hires', 'flac', '320', '128'],
  galaxy: ['galaxy', 'hires', 'flac', '320', '128']
})
export const WINDOWS_QUALITY_OPTIONS = Object.freeze([
  ['标准 MP3（128 kbps）', '128'], ['高品质 MP3（320 kbps）', '320'], ['无损 FLAC', 'flac'],
  ['Hi-Res 无损', 'hires'], ['杜比全景声', 'dolby'], ['5.1 品质', 'surround'],
  ['臻品母带', 'master'], ['臻品全景声', 'galaxy']
].map(([label, value]) => Object.freeze({ label, value })))
export const WINDOWS_FILE_QUALITY_OPTIONS = Object.freeze(WINDOWS_QUALITY_OPTIONS.filter(option =>
  Object.hasOwn(definitions, option.value)))
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
  let value = file[definition.sizeField]
  if (definition.sizeIndex !== undefined) {
    // The native size_new loop requires an array with at least six elements.
    if (!Array.isArray(value) || value.length <= 5) return null
    value = value[definition.sizeIndex]
  }
  return Number.isInteger(value) && value >= 0 && value <= 0x7fffffff ? value : null
}

/** Top-level TrackInfo vs, not file.media_mid, carries native variant identities. */
export function windowsQualityMediaMid(vs, quality) {
  const index = windowsQualityDefinition(quality)?.otherMidIndex
  if (index === undefined || !Array.isArray(vs)) return null
  const value = vs[index]
  return typeof value === 'string' && value.length === 14 && /^[a-zA-Z0-9]+$/.test(value) ? value : null
}

export function windowsQualityCandidates(file, vs) {
  return WINDOWS_QUALITY_OPTIONS.map(option => {
    const size = windowsQualityMetadataSize(file, option.value)
    const missingIdentity = windowsQualityDefinition(option.value).otherMidIndex !== undefined &&
      windowsQualityMediaMid(vs, option.value) === null
    const availability = size === 0 || missingIdentity ? 'unavailable' : size === null ? 'unknown' : 'candidate'
    const reason = missingIdentity && size !== 0 ? '当前歌曲缺少此音质的媒体标识'
      : availability === 'unavailable' ? '当前歌曲未提供该音质'
      : availability === 'unknown' ? '音质信息未知，需尝试验证'
        : '歌曲有该音质记录，播放仍需当前账号验证'
    return { ...option, availability, reason, ...(size === null ? {} : { metadataSize: size }) }
  })
}
