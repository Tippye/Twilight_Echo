import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWindowsVkeyCall } from './vkey-request.mjs'

// Golden fields and branch names come from native FUN_10062e5b, not Android.
const INPUT = {
  songs: {
    filename: ['F000example-media.flac'],
    musicfile: ['example-media'],
    songmid: ['example-song'],
    songtype: [0],
    unexpected: 'must not be forwarded'
  },
  guid: 'example-client-guid',
  uin: '9007199254740993',
  downloadFrom: 0
}

test('preserves the Windows playback parameter contract and uint64 UIN precision', () => {
  assert.deepEqual(buildWindowsVkeyCall(INPUT), {
    module: 'music.vkey.GetVkey',
    method: 'UrlGetVkey',
    param: {
      guid: 'example-client-guid', downloadfrom: 0, ctx: 1, referer: 'y.qq.com',
      scene: 0, checklimit: 0, uin: '9007199254740993', nettype: '',
      filename: ['F000example-media.flac'], musicfile: ['example-media'],
      songmid: ['example-song'], songtype: [0]
    }
  })
})

test('selects all four observed service branches without an Android fallback', () => {
  const cases = [
    [false, false, 'music.vkey.GetVkey', 'UrlGetVkey'],
    [true, false, 'music.vkey.GetEVkey', 'CgiGetEVkey'],
    [false, true, 'music.vkey.GetDownUrl', 'CgiGetDownUrl'],
    [true, true, 'music.vkey.GetEDownUrl', 'CgiGetEDownUrl']
  ]
  for (const [encrypted, download, module, method] of cases) {
    const call = buildWindowsVkeyCall({ ...INPUT, encrypted, download, downloadFrom: 7 })
    assert.equal(call.module, module)
    assert.equal(call.method, method)
    assert.equal(call.param.checklimit, download ? 1 : 0)
    assert.equal(call.param.downloadfrom, 7)
    assert.equal(call.param.ctx, 1)
    assert.equal(Object.hasOwn(call.param, 'source'), false)
  }
})

test('maps any nonempty native download source to the observed fixed literal', () => {
  const call = buildWindowsVkeyCall({ ...INPUT, downloadSource: 'native-caller-source' })
  assert.equal(call.param.source, 'mp3download')
})

test('copies only native song fields and detaches them from caller mutation', () => {
  const songs = structuredClone(INPUT.songs)
  const call = buildWindowsVkeyCall({ ...INPUT, songs })
  songs.filename[0] = 'changed'
  call.param.songmid[0] = 'other'
  assert.equal(call.param.filename[0], 'F000example-media.flac')
  assert.equal(songs.songmid[0], 'example-song')
  assert.equal(Object.hasOwn(call.param, 'unexpected'), false)
  assert.deepEqual(buildWindowsVkeyCall({ ...INPUT, songs: {} }).param.filename, null)
})

test('rejects lossy account identifiers and invalid native control inputs', () => {
  for (const uin of [9007199254740992, '-1', '1.5', '18446744073709551616']) {
    assert.throws(() => buildWindowsVkeyCall({ ...INPUT, uin }), TypeError)
  }
  for (const downloadFrom of [NaN, 1.5, 2147483648, -2147483649]) {
    assert.throws(() => buildWindowsVkeyCall({ ...INPUT, downloadFrom }), RangeError)
  }
  assert.throws(() => buildWindowsVkeyCall({ ...INPUT, encrypted: 1 }), TypeError)
  assert.throws(() => buildWindowsVkeyCall({ ...INPUT, songs: [] }), TypeError)
  assert.equal(buildWindowsVkeyCall({ ...INPUT, uin: '00000123' }).param.uin, '123')
  assert.equal(buildWindowsVkeyCall({ ...INPUT, uin: '18446744073709551615' }).param.uin,
    '18446744073709551615')
})

test('rejects values JSON serialization would silently change and ignores inherited members', () => {
  const cycle = {}
  cycle.self = cycle
  for (const filename of [NaN, Infinity, undefined, () => 'file', new Date(0), new Uint8Array(2),
    [undefined], [() => 'file'], Array(1), cycle]) {
    assert.throws(() => buildWindowsVkeyCall({ ...INPUT, songs: { filename } }), TypeError)
  }
  assert.throws(() => buildWindowsVkeyCall({ ...INPUT, songs: Object.create({ filename: ['inherited'] }) }), TypeError)
  const songs = Object.create(null)
  songs.filename = ['own-file']
  assert.deepEqual(buildWindowsVkeyCall({ ...INPUT, songs }).param.filename, ['own-file'])
})

test('does not execute accessors and safely copies JSON __proto__ properties', () => {
  let getterCalls = 0
  const songs = { get filename() { getterCalls += 1; return ['file'] } }
  assert.throws(() => buildWindowsVkeyCall({ ...INPUT, songs }), TypeError)
  assert.equal(getterCalls, 0)
  const value = JSON.parse('{"__proto__":{"polluted":true},"value":1}')
  const call = buildWindowsVkeyCall({ ...INPUT, songs: { musicfile: value } })
  assert.equal(Object.getPrototypeOf(call.param.musicfile), Object.prototype)
  assert.equal(Object.hasOwn(call.param.musicfile, '__proto__'), true)
  assert.equal(call.param.musicfile.polluted, undefined)
  assert.equal({}.polluted, undefined)
})
