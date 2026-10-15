import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsPlaylistDetailCall, buildWindowsUserPlaylistsCall, buildWindowsFavoritePlaylistsCall,
  WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
  WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY } from './lib/windows/playlist-call.mjs'

const detail = { loginUin: '0', hostUin: '0', disstid: '1234567890' }
const serialize = call => JSON.stringify(call)

test('native public detail branch emits the exact RPC and three numeric fields', () => {
  assert.equal(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo')
  assert.equal(serialize(buildWindowsPlaylistDetailCall(detail)),
    '{"module":"music.srfDissInfo.DissInfoForPc","method":"uniform_get_Dissinfo","param":{"login_uin":0,"host_uin":0,"disstid":1234567890}}')
})

test('native directory branch emits dirid and requires the session UIN as host', () => {
  assert.equal(serialize(buildWindowsPlaylistDetailCall({ ...detail, loginUin: '001', hostUin: '1', dirid: '003' })),
    '{"module":"music.srfDissInfo.DissInfoForPc","method":"uniform_get_Dissinfo","param":{"login_uin":1,"dirid":3,"host_uin":1,"disstid":1234567890}}')
  assert.throws(() => buildWindowsPlaylistDetailCall({ ...detail, hostUin: '1', dirid: '0' }), TypeError)
  assert.deepEqual(Object.keys(buildWindowsPlaylistDetailCall(detail).param), ['login_uin', 'host_uin', 'disstid'])
})

test('UInt64 and Int64 wire numbers preserve all decimal digits at their boundaries', () => {
  assert.equal(serialize(buildWindowsPlaylistDetailCall({
    loginUin: '18446744073709551615', hostUin: '18446744073709551615',
    dirid: '18446744073709551615', disstid: '-9223372036854775808'
  })), '{"module":"music.srfDissInfo.DissInfoForPc","method":"uniform_get_Dissinfo","param":{"login_uin":18446744073709551615,"dirid":18446744073709551615,"host_uin":18446744073709551615,"disstid":-9223372036854775808}}')
  assert.match(serialize(buildWindowsPlaylistDetailCall({ ...detail, disstid: '9223372036854775807' })),
    /"disstid":9223372036854775807}/)
})

test('user playlist producer emits one string field, with no inferred paging or favorites', () => {
  assert.equal(WINDOWS_USER_PLAYLISTS_REQUEST_KEY, 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin')
  assert.deepEqual(buildWindowsUserPlaylistsCall({ uin: '000123' }), {
    module: 'music.musicasset.PlaylistBaseRead', method: 'GetPlaylistByUin', param: { uin: '123' }
  })
  assert.deepEqual(buildWindowsUserPlaylistsCall({ uin: '18446744073709551615' }).param,
    { uin: '18446744073709551615' })
  const input = { uin: '123' }
  const result = buildWindowsUserPlaylistsCall(input)
  input.uin = '456'
  assert.equal(result.param.uin, '123')
})

test('native favorite producer uses its module-only outer key and one string UIN field', () => {
  const call = buildWindowsFavoritePlaylistsCall({ uin: '000123' })
  assert.equal(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY, 'music.musicasset.PlaylistFavRead')
  assert.equal(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY, call.module)
  assert.notEqual(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.equal(serialize({ [WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY]: call }),
    '{"music.musicasset.PlaylistFavRead":{"module":"music.musicasset.PlaylistFavRead","method":"GetPlaylistFavInfo","param":{"uin":"123"}}}')
})

test('favorite UIN stays a bounded exact string without retaining caller input', () => {
  const input = { uin: '18446744073709551615' }
  const result = buildWindowsFavoritePlaylistsCall(input)
  input.uin = '1'
  assert.deepEqual(result.param, { uin: '18446744073709551615' })
  assert.equal(typeof result.param.uin, 'string')
  assert.deepEqual(buildWindowsFavoritePlaylistsCall({ uin: '0' }).param, { uin: '0' })
  const privateValue = 'NOT_A_VALID_PRIVATE_UIN'
  assert.throws(() => buildWindowsFavoritePlaylistsCall({ uin: privateValue }),
    error => !error.message.includes(privateValue))
})

test('wrong types, whitespace, NUL, oversized input and missing values reject without leaking IDs', () => {
  const invalid = [undefined, null, 0, 1n, [], {}, '', '+1', '1.0', '1e2', ' 1', '1\n', '1\0', '0'.repeat(21)]
  for (const value of invalid) {
    for (const field of ['loginUin', 'hostUin', 'disstid', 'dirid']) {
      if (field === 'dirid' && value === undefined) continue
      assert.throws(() => buildWindowsPlaylistDetailCall({ ...detail, [field]: value }), TypeError)
    }
    assert.throws(() => buildWindowsUserPlaylistsCall({ uin: value }), TypeError)
    assert.throws(() => buildWindowsFavoritePlaylistsCall({ uin: value }), TypeError)
  }
  assert.throws(() => buildWindowsPlaylistDetailCall(), TypeError)
  assert.throws(() => buildWindowsUserPlaylistsCall(), TypeError)
  assert.throws(() => buildWindowsFavoritePlaylistsCall(), TypeError)
  const secret = 'not-a-public-user-id'
  assert.throws(() => buildWindowsUserPlaylistsCall({ uin: secret }), error => !error.message.includes(secret))
})

test('unsigned negatives and integer overflow reject before creating any wire body', () => {
  for (const field of ['loginUin', 'hostUin', 'dirid']) {
    assert.throws(() => buildWindowsPlaylistDetailCall({ ...detail, [field]: '-1' }), TypeError)
    assert.throws(() => buildWindowsPlaylistDetailCall({ ...detail, [field]: '18446744073709551616' }), RangeError)
  }
  for (const disstid of ['9223372036854775808', '-9223372036854775809']) {
    assert.throws(() => buildWindowsPlaylistDetailCall({ ...detail, disstid }), RangeError)
  }
  assert.throws(() => buildWindowsUserPlaylistsCall({ uin: '-1' }), TypeError)
  assert.throws(() => buildWindowsUserPlaylistsCall({ uin: '18446744073709551616' }), RangeError)
  assert.throws(() => buildWindowsFavoritePlaylistsCall({ uin: '-1' }), TypeError)
  assert.throws(() => buildWindowsFavoritePlaylistsCall({ uin: '18446744073709551616' }), RangeError)
})
