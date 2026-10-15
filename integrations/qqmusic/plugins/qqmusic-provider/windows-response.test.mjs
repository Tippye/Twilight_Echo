import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractWindowsLoginSession, parseWindowsJson, parseWindowsRpcResponse,
  WindowsRpcError } from './lib/windows/response.mjs'

const key = 'music.login.LoginServer.Login'
const publicData = { openid: 'public-openid', access_token: 'public-access',
  expired_at: 1770000000, refresh_token: 'public-refresh', musicid: 10000,
  musickey: 'public-key', unionid: '', musickeyCreateTime: 1760000000,
  refresh_key: 'public-refresh-key', encryptUin: 'public-encrypted-id', loginType: 2 }
const envelope = (data = publicData) => JSON.stringify({ code: 0, [key]: { code: 0, data } })

test('login response keeps the exact native fields, names and time roles', () => {
  const session = extractWindowsLoginSession(parseWindowsRpcResponse(envelope(), key))
  assert.deepEqual(session, { ...publicData, expired_at: '1770000000', musicid: '10000', musickeyCreateTime: '1760000000' })
  assert.equal(Object.hasOwn(session, 'musickeyExpiresAt'), false)
})

test('large native integer literals survive response parsing and session extraction', () => {
  const text = envelope().replace('"musicid":10000', '"musicid":9007199254740993')
    .replace('"expired_at":1770000000', '"expired_at":9223372036854775807')
  const session = extractWindowsLoginSession(parseWindowsRpcResponse(text, key))
  assert.equal(session.musicid, '9007199254740993')
  assert.equal(session.expired_at, '9223372036854775807')
  assert.equal(parseWindowsJson('{"id":18446744073709551615}').id, '18446744073709551615')
})

test('top-level and item errors never commit otherwise valid session data', () => {
  for (const text of [JSON.stringify({ code: 1000, [key]: { code: 0, data: publicData } }),
    JSON.stringify({ code: 0, [key]: { code: 104401, data: publicData } })]) {
    assert.throws(() => parseWindowsRpcResponse(text, key), WindowsRpcError)
  }
})

test('success-shaped malformed responses are rejected instead of reporting login', () => {
  for (const text of ['null', '[]', '{}', '{"code":"0"}', '{"code":0}',
    JSON.stringify({ code: 0, [key]: { data: publicData } }),
    JSON.stringify({ code: 0, [key]: { code: 0, data: null } }),
    JSON.stringify({ code: 0, [key]: { code: 0, data: [] } })]) {
    assert.throws(() => parseWindowsRpcResponse(text, key))
  }
})

test('partial or invalid login data cannot become a session', () => {
  for (const override of [{ musickey: '' }, { musicid: 0 }, { expired_at: 1.5 },
    { expired_at: '9223372036854775808' }, { refresh_key: undefined },
    { access_token: 'public\0access' }, { loginType: '2' }]) {
    assert.throws(() => extractWindowsLoginSession({ ...publicData, ...override }))
  }
})

test('parse and business errors contain no upstream strings or credentials', () => {
  assert.throws(() => parseWindowsJson('{"secret":"PRIVATE_VALUE"'),
    (error) => !error.message.includes('PRIVATE_VALUE'))
  const text = JSON.stringify({ code: 0, [key]: { code: 1000, data: { errtip: 'PRIVATE_VALUE' } } })
  assert.throws(() => parseWindowsRpcResponse(text, key),
    (error) => error.code === 1000 && !error.message.includes('PRIVATE_VALUE'))
})
