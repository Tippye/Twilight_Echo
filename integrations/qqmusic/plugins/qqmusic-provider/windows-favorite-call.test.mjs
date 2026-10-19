import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsFavoriteSongCall, decodeWindowsFavoriteSongResponse, WINDOWS_ADD_FAVORITE_SONG_REQUEST_KEY,
  WINDOWS_REMOVE_FAVORITE_SONG_REQUEST_KEY } from './lib/windows/favorite-call.mjs'

const input = { dirid: '201', disstid: '0', directoryName: '我喜欢',
  songId: '42', songType: 0, liked: true }

test('normal-song Add and Del emit the native directory fields and exact types', () => {
  const call = buildWindowsFavoriteSongCall(input)
  assert.equal(WINDOWS_ADD_FAVORITE_SONG_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.equal(JSON.stringify(call), '{"module":"music.musicasset.PlaylistDetailWrite","method":"AddSonglist","param":{"dirId":201,"dirName":"我喜欢","tid":0,"bFmtUtf8":true,"v_songInfo":[{"songType":0,"songId":42}]}}')
  const remove = buildWindowsFavoriteSongCall({ ...input, liked: false })
  assert.equal(WINDOWS_REMOVE_FAVORITE_SONG_REQUEST_KEY, `${remove.module}.${remove.method}`)
  assert.deepEqual(remove.param, call.param)
  assert.equal(remove.method, 'DelSonglist')
  assert.deepEqual(Object.keys(call.param), ['dirId', 'dirName', 'tid', 'bFmtUtf8', 'v_songInfo'])
})

test('tid remains an exact unsigned 64-bit JSON number and songId remains UInt32', () => {
  const result = buildWindowsFavoriteSongCall({ ...input, dirid: '00201',
    disstid: '18446744073709551615', songId: '4294967295' })
  assert.match(JSON.stringify(result), /"tid":18446744073709551615,/)
  assert.equal(result.param.v_songInfo[0].songId, 4294967295)
  assert.match(JSON.stringify(buildWindowsFavoriteSongCall({ ...input, disstid: '00001', songId: '00042' })),
    /"tid":1,.*"songId":42/)
})

test('builder preserves validated UTF8 text and does not retain caller-owned objects', () => {
  const source = { ...input, directoryName: '  Fixture ✓  ' }
  const first = buildWindowsFavoriteSongCall(source)
  const second = buildWindowsFavoriteSongCall(source)
  source.directoryName = 'Changed'
  first.param.v_songInfo[0].songId = 1
  assert.equal(second.param.dirName, '  Fixture ✓  ')
  assert.equal(second.param.v_songInfo[0].songId, 42)
})

test('invalid identifiers and unsupported directories/types reject without leaking inputs', () => {
  for (const value of [undefined, null, 1, 1n, {}, [], '', '+1', '-1', '1.0', ' 1', '1\n', '1\0', '0'.repeat(21)]) {
    for (const field of ['dirid', 'disstid', 'songId']) {
      assert.throws(() => buildWindowsFavoriteSongCall({ ...input, [field]: value }), TypeError)
    }
  }
  for (const [field, value] of [['dirid', '200'], ['dirid', '4294967296'],
    ['disstid', '18446744073709551616'], ['songId', '0'], ['songId', '4294967296'],
    ['songType', undefined], ['songType', '0'], ['songType', 21], ['songType', 1]]) {
    assert.throws(() => buildWindowsFavoriteSongCall({ ...input, [field]: value }), RangeError)
  }
  const privateValue = 'PRIVATE_INVALID_IDENTIFIER'
  assert.throws(() => buildWindowsFavoriteSongCall({ ...input, disstid: privateValue }),
    error => !error.message.includes(privateValue))
  assert.throws(() => buildWindowsFavoriteSongCall(), TypeError)
})

test('text and target state require explicit valid values before dispatch', () => {
  for (const name of [undefined, null, 0, {}, [], 'x\0', '\ud800', 'x'.repeat(4097)]) {
    assert.throws(() => buildWindowsFavoriteSongCall({ ...input, directoryName: name }), TypeError)
  }
  for (const liked of [undefined, null, 0, 1, 'false', {}, []]) {
    assert.throws(() => buildWindowsFavoriteSongCall({ ...input, liked }), TypeError)
  }
})

function addReply() {
  return { msg: '', result: { dirId: '201', tid: '0', updateTime: 1,
    songlist: [{ backendSongId: 42, songType: 0, loc: 0 }] } }
}

test('native Add acknowledgement validates directory and one exact submitted song', () => {
  assert.deepEqual(decodeWindowsFavoriteSongResponse(addReply(), input), { refreshRequired: true, updateTime: 1 })
  const numericIds = addReply()
  numericIds.result.dirId = 201
  numericIds.result.tid = 0
  assert.deepEqual(decodeWindowsFavoriteSongResponse(numericIds, input), { refreshRequired: true, updateTime: 1 })
  const wideId = addReply()
  wideId.result.tid = '18446744073709551615'
  assert.deepEqual(decodeWindowsFavoriteSongResponse(wideId,
    { ...input, disstid: '18446744073709551615' }), { refreshRequired: true, updateTime: 1 })
})

test('Add partial commits, ambiguous loc, wrong song/type and directory identity reject', () => {
  const invalid = [null, [], {}, { msg: '' }, { msg: '', result: {} }]
  for (const data of invalid) assert.throws(() => decodeWindowsFavoriteSongResponse(data, input))
  for (const [field, value] of [['dirId', '202'], ['tid', '1'], ['tid', 18446744073709551616],
    ['updateTime', -1], ['updateTime', '1'], ['updateTime', 4294967296],
    ['songlist', []], ['songlist', Array(1)], ['songlist', [{ backendSongId: 42, songType: 0, loc: 0 }, {}]]]) {
    const reply = addReply()
    reply.result[field] = value
    assert.throws(() => decodeWindowsFavoriteSongResponse(reply, input))
  }
  for (const [field, value] of [['loc', 1], ['loc', -1], ['loc', '0'], ['songType', 1],
    ['songType', '0'], ['backendSongId', 0], ['backendSongId', 41], ['backendSongId', '42']]) {
    const reply = addReply()
    reply.result.songlist[0][field] = value
    assert.throws(() => decodeWindowsFavoriteSongResponse(reply, input))
  }
})

test('native Del has no membership acknowledgement and always requires a fresh read', () => {
  const remove = { ...input, liked: false }
  for (const result of [undefined, null, {}, { dirId: '201', tid: '0' }]) {
    assert.deepEqual(decodeWindowsFavoriteSongResponse({ msg: '', result }, remove), { refreshRequired: true })
  }
  for (const result of [[], 'ok', { dirId: '202' }, { tid: '1' }]) {
    assert.throws(() => decodeWindowsFavoriteSongResponse({ msg: '', result }, remove))
  }
  for (const msg of [undefined, null, 0, 'x\0', '\ud800', 'x'.repeat(4097)]) {
    assert.throws(() => decodeWindowsFavoriteSongResponse({ msg }, remove))
  }
})
