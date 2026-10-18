import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsMediaFilename } from './lib/windows/filename.mjs'

const mediaMid = '00000000000001'
const input = { mediaMid, type: 4, sourceMode: 1, encrypted: false,
  otherMediaMid: '', auxiliaryFlag: false }
const output = (prefix, extension, selectedMid = mediaMid) => prefix + selectedMid + extension

// Golden templates read from the hash-pinned native export's dossier, not Android fixtures.
const vectors = [
  [1, 'M500', '.mp3', 'M500', '.mp3'],
  [2, 'O600', '.ogg', 'O6M0', '.mgg'],
  [3, 'M800', '.mp3', 'M800', '.mp3'],
  [4, 'F000', '.flac', 'F0M0', '.mflac'],
  [5, 'F000', '.flac', 'F0M0', '.mflac'],
  [6, 'D00A', '.flac', 'D0MA', '.mflac'],
  [8, 'RS02', '.mp3', 'RS02', '.mp3'],
  [9, 'O400', '.ogg', 'O4M0', '.mgg'],
  [10, 'RS01', '.flac', 'RSM1', '.mflac'],
  [12, 'D001', '.mp4', 'D0M1', '.mmp4'],
  [13, 'O800', '.ogg', 'O8M0', '.mgg'],
  [14, 'AI00', '.flac', 'AIM0', '.mflac'],
  [15, 'Q000', '.flac', 'Q0M0', '.mflac'],
  [16, 'Q001', '.flac', 'Q0M1', '.mflac'],
  [17, 'O801', '.ogg', 'O8M1', '.mgg'],
  [18, 'Q003', '.ogg', 'Q0M3', '.mgg'],
  [19, 'TL01', '.nac', 'TLM1', '.mnac'],
  [20, 'AI01', '.ogg', 'AIM1', '.mgg'],
  [21, 'AI03', '.ogg', 'AIM3', '.mgg'],
  [22, 'AI05', '.ogg', 'AIM5', '.mgg'],
  [23, 'AI04', '.ogg', 'AIM4', '.mgg'],
  [24, 'AI02', '.ogg', 'AIM2', '.mgg'],
  [25, 'AI06', '.ogg', 'AIM6', '.mgg'],
  [26, 'AI07', '.ogg', 'AIM7', '.mgg'],
  [27, 'AI08', '.ogg', 'AIM8', '.mgg'],
  [28, 'AI09', '.ogg', 'AIM9', '.mgg'],
  [29, 'A200', '.ogg', 'A2M0', '.mgg'],
  [30, 'AA01', '.ogg', 'AAM1', '.mgg'],
  [31, 'V000', '.flac', 'V0M0', '.mflac']
]

test('both ordinary source modes match every recovered plain and encrypted template', () => {
  for (const sourceMode of [1, 2]) {
    for (const [type, plainPrefix, plainExtension, encPrefix, encExtension] of vectors) {
      assert.equal(buildWindowsMediaFilename({ ...input, type, sourceMode }),
        output(plainPrefix, plainExtension), `mode ${sourceMode} type ${type} plain`)
      assert.equal(buildWindowsMediaFilename({ ...input, type, sourceMode, encrypted: true }),
        output(encPrefix, encExtension), `mode ${sourceMode} type ${type} encrypted`)
    }
  }
})

test('mode 111 has its native prefixes while preserving encrypted branches', () => {
  for (const [type, prefix, extension] of [[1, 'M5L0', '.mp3'], [2, 'O6L0', '.ogg'],
    [3, 'M8L0', '.mp3'], [4, 'F0L0', '.flac'], [5, 'F0L0', '.flac'], [9, 'M500', '.mp3']]) {
    assert.equal(buildWindowsMediaFilename({ ...input, type, sourceMode: 111 }), output(prefix, extension))
  }
  assert.equal(buildWindowsMediaFilename({ ...input, sourceMode: 111, encrypted: true }), output('F0M0', '.mflac'))
})

test('source modes 112 and 113 override templates independently of encrypted flag and OtherMID', () => {
  for (const encrypted of [false, true]) {
    assert.equal(buildWindowsMediaFilename({ ...input, encrypted, sourceMode: 112, otherMediaMid: 'extra' }),
      output('R500', '.mp3'))
    for (const [type, prefix] of [[3, 'KC80'], [11, 'KC40'], [4, 'KC50']]) {
      assert.equal(buildWindowsMediaFilename({ ...input, type, encrypted, sourceMode: 113, otherMediaMid: 'extra' }),
        output(prefix, '.tkm'))
    }
  }
})

test('type 8 uses its auxiliary bit branch regardless of encrypted flag', () => {
  for (const encrypted of [false, true]) {
    assert.equal(buildWindowsMediaFilename({ ...input, type: 8, encrypted, auxiliaryFlag: true, otherMediaMid: 'other' }),
      output('VAM0', '.mflac', 'other'))
    assert.equal(buildWindowsMediaFilename({ ...input, type: 8, encrypted, auxiliaryFlag: false, otherMediaMid: 'other' }),
      output('RS02', '.mp3', 'other'))
  }
})

test('nonempty OtherMID replaces the main MID only on the native extended branches', () => {
  // Common10032ac3 ->10007234 replaces the CString buffer pointer at1000726a.
  // This instruction proof corrects the old suffix-concatenation inference.
  for (const sourceMode of [1, 2, 111]) {
    for (const [type, plainPrefix, plainExtension, encPrefix, encExtension] of vectors) {
      if (type !== 8 && type < 14) continue
      for (const encrypted of [false, true]) {
        assert.equal(buildWindowsMediaFilename({ ...input, type, sourceMode, encrypted,
          otherMediaMid: '00000000000002' }), output(encrypted ? encPrefix : plainPrefix,
          encrypted ? encExtension : plainExtension, '00000000000002'))
      }
    }
  }
  assert.equal(buildWindowsMediaFilename({ ...input, encrypted: true, otherMediaMid: 'other' }), output('F0M0', '.mflac'))
  assert.equal(buildWindowsMediaFilename({ ...input, type: 12, encrypted: true, otherMediaMid: 'other' }), output('D0M1', '.mmp4'))
  assert.equal(buildWindowsMediaFilename({ ...input, mediaMid: 'ResolvedMediaID', type: 3 }), 'M800ResolvedMediaID.mp3')
})

test('public One Last Kiss variant identifiers produce the four native premium filenames without base-MID duplication', () => {
  // Fixed public input from TrackInfo, cross-checked with the hash-pinned native
  // OtherMID index switch (ev_3c9f31585c10436fc6e48302c2b6dbbf326a592bd8fdc48e83bbebd57a6a264a).
  for (const [type, otherMediaMid, plain, encrypted] of [
    [14, '003xkcSf3NBRlX', 'AI00003xkcSf3NBRlX.flac', 'AIM0003xkcSf3NBRlX.mflac'],
    [15, '004astzo2Y5HDU', 'Q000004astzo2Y5HDU.flac', 'Q0M0004astzo2Y5HDU.mflac'],
    [16, '001GZ6wJ0gJaEG', 'Q001001GZ6wJ0gJaEG.flac', 'Q0M1001GZ6wJ0gJaEG.mflac'],
    [18, '000Eobd13nwHGJ', 'Q003000Eobd13nwHGJ.ogg', 'Q0M3000Eobd13nwHGJ.mgg']
  ]) {
    for (const sourceMode of [1, 2, 111]) {
      const args = { ...input, mediaMid: '000zwUDf0KftQv', type, sourceMode, otherMediaMid }
      assert.equal(buildWindowsMediaFilename(args), plain)
      assert.equal(buildWindowsMediaFilename({ ...args, encrypted: true }), encrypted)
    }
  }
})

test('unresolved MID, missing context and unverified fallback types are rejected explicitly', () => {
  for (const name of Object.keys(input)) {
    assert.throws(() => buildWindowsMediaFilename({ ...input, [name]: undefined }))
  }
  for (const mediaMid of ['', 123, 'a\0b']) {
    assert.throws(() => buildWindowsMediaFilename({ ...input, mediaMid }), TypeError)
  }
  for (const type of [0, 7, 11, 32, '4', -1]) {
    assert.throws(() => buildWindowsMediaFilename({ ...input, type }), RangeError)
  }
  for (const sourceMode of [0, 3, 110, 114, '1']) {
    assert.throws(() => buildWindowsMediaFilename({ ...input, sourceMode }), RangeError)
  }
})
