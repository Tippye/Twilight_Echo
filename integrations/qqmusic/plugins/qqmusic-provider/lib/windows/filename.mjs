export const WINDOWS_FILENAME_PROVENANCE = Object.freeze({
  artifact: 'QQMusicCommon.dll',
  artifactSha256: '4267e1c27f7251a31460613a97f5787fd7d9d0be3664e5e615251aba2780471f',
  producer: '0x100325d3',
  exportOrdinal: 1046,
  evidenceId: 'ev_a1101715d11a77d67d3e4fca0838f29d5cad54814da02945c00b8ea5bb513f10'
})

// Numeric native types. Display quality names and server DTO mapping are separate contracts.
const FIXED = new Map([
  [6, ['D00A', '.flac', 'D0MA', '.mflac']],
  [10, ['RS01', '.flac', 'RSM1', '.mflac']],
  [12, ['D001', '.mp4', 'D0M1', '.mmp4']],
  [13, ['O800', '.ogg', 'O8M0', '.mgg']],
  [14, ['AI00', '.flac', 'AIM0', '.mflac']],
  [15, ['Q000', '.flac', 'Q0M0', '.mflac']],
  [16, ['Q001', '.flac', 'Q0M1', '.mflac']],
  [17, ['O801', '.ogg', 'O8M1', '.mgg']],
  [18, ['Q003', '.ogg', 'Q0M3', '.mgg']],
  [19, ['TL01', '.nac', 'TLM1', '.mnac']],
  [20, ['AI01', '.ogg', 'AIM1', '.mgg']],
  [21, ['AI03', '.ogg', 'AIM3', '.mgg']],
  [22, ['AI05', '.ogg', 'AIM5', '.mgg']],
  [23, ['AI04', '.ogg', 'AIM4', '.mgg']],
  [24, ['AI02', '.ogg', 'AIM2', '.mgg']],
  [25, ['AI06', '.ogg', 'AIM6', '.mgg']],
  [26, ['AI07', '.ogg', 'AIM7', '.mgg']],
  [27, ['AI08', '.ogg', 'AIM8', '.mgg']],
  [28, ['AI09', '.ogg', 'AIM9', '.mgg']],
  [29, ['A200', '.ogg', 'A2M0', '.mgg']],
  [30, ['AA01', '.ogg', 'AAM1', '.mgg']],
  [31, ['V000', '.flac', 'V0M0', '.mflac']]
])
const TYPES = new Set([1, 2, 3, 4, 5, 8, 9, ...FIXED.keys()])
const SOURCE_MODES = new Set([1, 2, 111, 112, 113])

function string(value, name, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || (required && !value)) {
    throw new TypeError(`${name} must be ${required ? 'a nonempty' : 'a'} string without NUL`)
  }
  return value
}

/**
 * Native filename leaf after the caller resolves its media MID and optional suffix.
 * auxiliaryFlag is the leaf's seventh argument; type 8 derives it from SongItem bit 0x40000.
 * All context is explicit. This function does not resolve song IDs or claim format support.
 */
export function buildWindowsMediaFilename({ mediaMid, type, sourceMode, encrypted,
  suffix, auxiliaryFlag } = {}) {
  mediaMid = string(mediaMid, 'mediaMid', true)
  suffix = string(suffix, 'suffix')
  if (!SOURCE_MODES.has(sourceMode)) throw new RangeError('sourceMode has no verified Windows filename rule')
  if (!TYPES.has(type) && !(sourceMode === 113 && type === 11)) {
    throw new RangeError('type has no verified Windows filename rule')
  }
  for (const [name, value] of [['encrypted', encrypted], ['auxiliaryFlag', auxiliaryFlag]]) {
    if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`)
  }

  let prefix
  let extension
  let appendSuffix = false
  if (sourceMode === 112) {
    prefix = 'R500'
    extension = '.mp3'
  } else if (sourceMode === 113) {
    prefix = type === 3 ? 'KC80' : type === 11 ? 'KC40' : 'KC50'
    extension = '.tkm'
  } else if (type === 1 || type === 3) {
    prefix = type === 1 ? (sourceMode === 111 ? 'M5L0' : 'M500')
      : (sourceMode === 111 ? 'M8L0' : 'M800')
    extension = '.mp3'
  } else if (type === 2) {
    prefix = encrypted ? 'O6M0' : sourceMode === 111 ? 'O6L0' : 'O600'
    extension = encrypted ? '.mgg' : '.ogg'
  } else if (type === 4 || type === 5) {
    prefix = encrypted ? 'F0M0' : sourceMode === 111 ? 'F0L0' : 'F000'
    extension = encrypted ? '.mflac' : '.flac'
  } else if (type === 8) {
    prefix = auxiliaryFlag ? 'VAM0' : 'RS02'
    extension = auxiliaryFlag ? '.mflac' : '.mp3'
    appendSuffix = true
  } else if (type === 9) {
    prefix = encrypted ? 'O4M0' : sourceMode === 111 ? 'M500' : 'O400'
    extension = encrypted ? '.mgg' : sourceMode === 111 ? '.mp3' : '.ogg'
  } else {
    const template = FIXED.get(type)
    const offset = encrypted ? 2 : 0
    prefix = template[offset]
    extension = template[offset + 1]
    appendSuffix = type >= 14
  }
  return prefix + mediaMid + (appendSuffix ? suffix : '') + extension
}
