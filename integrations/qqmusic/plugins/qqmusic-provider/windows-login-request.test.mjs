import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeSigned64 } from './lib/windows/json-integer.mjs'
import { buildWindowsQrLoginCall, buildWindowsQQCodeLoginCall,
  buildWindowsQQTokenLoginCall, buildWindowsQQTokenRefreshCall,
  buildWindowsQQMusicKeyRefreshCall, WINDOWS_LOGIN_REQUEST_KEY,
  WINDOWS_QQ_TOKEN_REFRESH_REQUEST_KEY, WINDOWS_QQ_MUSIC_KEY_REFRESH_REQUEST_KEY } from './lib/windows/login-request.mjs'

test('actual Windows QR producer has exactly three fields and preserves numeric ID precision', () => {
  const result = buildWindowsQrLoginCall({ musicId: '9007199254740993', token: 'public-fake-token', qrCodeId: 'public-fake-qr' })
  assert.equal(WINDOWS_LOGIN_REQUEST_KEY, 'music.login.LoginServer.Login')
  assert.equal(result.module, 'music.login.LoginServer')
  assert.equal(result.method, 'Login')
  assert.deepEqual(Object.keys(result.param), ['musicid', 'token', 'qrCodeID'])
  assert.equal(JSON.stringify(result.param), '{"musicid":9007199254740993,"token":"public-fake-token","qrCodeID":"public-fake-qr"}')
})

test('QQ code branch keeps native integer flags, default appid and caller device name', () => {
  const result = buildWindowsQQCodeLoginCall({ code: 'public-fake-code', deviceName: '测试设备' })
  assert.deepEqual(result.param, { code: 'public-fake-code', onlyNeedAccessToken: 0,
    forceRefreshToken: 0, appid: 100497308, deviceName: '测试设备' })
  assert.equal(buildWindowsQQCodeLoginCall({ code: '', deviceName: '', appid: 42 }).param.appid, 42)
})

test('QQ restore request retains native misspelling and all server fields', () => {
  const result = buildWindowsQQTokenLoginCall({ openid: 'public-openid', musickey: 'public-key',
    expiredIn: '9223372036854775807', musicId: '-9223372036854775808', refreshKey: 'public-refresh-key',
    accessToken: 'public-access', refreshToken: 'public-refresh', deviceName: 'public-device' })
  const wire = JSON.stringify(result.param)
  assert.ok(wire.includes('"expired_in":9223372036854775807'))
  assert.ok(wire.includes('"musicid":-9223372036854775808'))
  const parsed = JSON.parse(wire)
  assert.equal(parsed.deviceType, 'Widnows')
  assert.equal(parsed.refresh_key, 'public-refresh-key')
  assert.equal(parsed.access_token, 'public-access')
  assert.equal(parsed.refresh_token, 'public-refresh')
  assert.equal(parsed.onlyNeedAccessToken, 0)
  assert.equal(parsed.forceRefreshToken, 0)
})

test('native signed64 JSON numbers normalize decimals and reject lossy inputs', () => {
  assert.equal(JSON.stringify({ value: nativeSigned64('-000') }), '{"value":0}')
  assert.equal(JSON.stringify({ value: nativeSigned64('00123') }), '{"value":123}')
  for (const value of [1, 1n, null, '1.5', '+1', ' 1', '1e2', '', {}]) {
    assert.throws(() => nativeSigned64(value), TypeError)
  }
  for (const value of ['9223372036854775808', '-9223372036854775809']) {
    assert.throws(() => nativeSigned64(value), RangeError)
  }
})

test('builders reject wrong DTO types without including private values in errors', () => {
  assert.throws(() => buildWindowsQrLoginCall({ musicId: '1', token: {}, qrCodeId: '' }), /token must be a string/)
  assert.throws(() => buildWindowsQQCodeLoginCall({ code: 'fake', deviceName: {}, appid: 1 }), TypeError)
  for (const appid of [-1, 0x100000000, 1.5, '100497308']) {
    assert.throws(() => buildWindowsQQCodeLoginCall({ code: 'fake', deviceName: '', appid }), RangeError)
  }
})

test('C-string fields reject silent native truncation and preserve empty values', () => {
  assert.throws(() => buildWindowsQrLoginCall({ musicId: '1', token: 'fake\0token', qrCodeId: '' }), /token must not contain NUL/)
  assert.throws(() => buildWindowsQrLoginCall({ musicId: '1', token: '', qrCodeId: 'fake\0id' }), /qrCodeId must not contain NUL/)
  assert.throws(() => buildWindowsQQCodeLoginCall({ code: 'fake\0code', deviceName: '' }), /code must not contain NUL/)
  assert.equal(JSON.stringify(buildWindowsQrLoginCall({ musicId: '0', token: '', qrCodeId: '' }).param), '{"musicid":0,"token":"","qrCodeID":""}')
})

test('exact native refresh builders use Login with distinct request keys and token flags', () => {
  const options = { openid: 'public-openid', musickey: 'public-key', expiredIn: '1800000000',
    musicId: '9007199254740993', refreshKey: 'public-refresh-key', accessToken: 'public-access',
    refreshToken: 'public-refresh', deviceName: 'public-device' }
  assert.equal(WINDOWS_QQ_TOKEN_REFRESH_REQUEST_KEY, 'QQRefreshToken')
  assert.equal(WINDOWS_QQ_MUSIC_KEY_REFRESH_REQUEST_KEY, 'QQRefreshKey')
  const token = buildWindowsQQTokenRefreshCall(options)
  assert.equal(token.module, 'music.login.LoginServer')
  assert.equal(token.method, 'Login')
  assert.equal(token.param.onlyNeedAccessToken, 1)
  assert.equal(Object.hasOwn(token.param, 'forceRefreshToken'), false)
  assert.ok(JSON.stringify(token).includes('"musicid":9007199254740993'))
  assert.deepEqual(buildWindowsQQMusicKeyRefreshCall(options), buildWindowsQQTokenLoginCall(options))
  assert.throws(() => buildWindowsQQTokenRefreshCall({ ...options, refreshToken: '' }), /must not be empty/)
})
