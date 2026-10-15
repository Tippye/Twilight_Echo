import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsTrackInfoCall, WINDOWS_TRACK_INFO_REQUEST_KEY } from './lib/windows/song-detail-call.mjs'

const options = { ids: [97773], types: [0], ctx: 0, scene: 1 }

test('native TrackInfo preserves the request key, module and four typed fields', () => {
  assert.equal(WINDOWS_TRACK_INFO_REQUEST_KEY, 'Protocol_UpdateSongInfo')
  assert.deepEqual(buildWindowsTrackInfoCall(options), {
    module: 'music.trackInfo.UniformRuleCtrl', method: 'CgiGetTrackInfo',
    param: { ids: [97773], types: [0], ctx: 0, scene: 1 }
  })
})

test('UInt32 IDs and signed Int32 caller fields preserve their boundaries in JSON', () => {
  const call = buildWindowsTrackInfoCall({ ids: [0, 0xffffffff], types: [-0x80000000, 0x7fffffff], ctx: -0x80000000, scene: 0 })
  assert.deepEqual(JSON.parse(JSON.stringify(call)).param,
    { ids: [0, 4294967295], types: [-2147483648, 2147483647], ctx: -2147483648, scene: 0 })
})

test('builder owns its arrays and emits no unresolved or Android fields', () => {
  const input = { ...options, ids: [...options.ids], types: [...options.types] }
  const call = buildWindowsTrackInfoCall(input)
  input.ids[0] = 1
  input.types.push(1)
  assert.deepEqual(call.param.ids, [97773])
  assert.deepEqual(call.param.types, [0])
  assert.deepEqual(Object.keys(call.param), ['ids', 'types', 'ctx', 'scene'])
})

test('provider rejects malformed parallel arrays instead of dropping unmatched IDs', () => {
  for (const input of [{}, { ...options, ids: [] }, { ...options, types: [] },
    { ...options, ids: '97773' }, { ...options, types: [0, 1] },
    { ...options, ids: [97773, 1] }]) {
    assert.throws(() => buildWindowsTrackInfoCall(input), TypeError)
  }
  assert.throws(() => buildWindowsTrackInfoCall({ ...options, ids: new Array(1) }), RangeError)
})

test('MID strings, overflow, fractions and missing caller values reject before serialization', () => {
  for (const id of ['0039MnYb0qxYhV', '97773', -1, 0x100000000, 1.5, NaN, Infinity, undefined]) {
    assert.throws(() => buildWindowsTrackInfoCall({ ...options, ids: [id] }), RangeError)
  }
  for (const field of ['ctx', 'type']) {
    for (const value of ['0', -0x80000001, 0x80000000, 0.1, undefined, NaN]) {
      assert.throws(() => buildWindowsTrackInfoCall({ ...options,
        ...(field === 'type' ? { types: [value] } : { ctx: value }) }), RangeError)
    }
  }
  for (const scene of [-1, 2, 0.5, '1', true, undefined]) {
    assert.throws(() => buildWindowsTrackInfoCall({ ...options, scene }), RangeError)
  }
})
