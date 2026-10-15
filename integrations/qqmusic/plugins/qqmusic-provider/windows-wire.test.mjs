import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildWindowsComm, buildWindowsSignatureMetadata } from './lib/windows/comm.mjs'
import { buildWindowsSignedRequest } from './lib/windows/wire.mjs'

const publicProfile = {
  uin: '10000', versionMain: 22, versionSub: 71, openid: '', accessToken: '',
  accessTokenExpiresAt: '0', unionId: '', musickey: '', guid: 'public-guid',
  tmeLoginType: 2, channelId: 0, encodedOsVersion: 'public-encoded-os'
}

test('Windows comm uses the recorded desktop types and excludes Android device fields', () => {
  const wire = JSON.stringify(buildWindowsComm(publicProfile))
  assert.deepEqual(JSON.parse(wire), {
    uin: '10000', cv: '2271', ct: '19', patch: '118',
    psrf_qqopenid: '', psrf_qqaccess_token: '', psrf_access_token_expiresAt: 0,
    psrf_qqunionid: '', authst: '', guid: 'public-guid', _channelid: '0',
    _os_version: 'public-encoded-os', tmeAppID: 'qqmusic', tmeLoginType: 2
  })
})

test('optional native fields preserve unsigned text and signed64 JSON numbers', () => {
  const wire = JSON.stringify(buildWindowsComm({ ...publicProfile, uin: '0010000',
    wid: '18446744073709551615', includeOpenUdid: true, uid: '9007199254740993',
    accessTokenExpiresAt: '9223372036854775807', meshDevops: 'public-mesh' }))
  assert.ok(wire.includes('"uid":9007199254740993'))
  assert.ok(wire.includes('"psrf_access_token_expiresAt":9223372036854775807'))
  const parsed = JSON.parse(wire)
  assert.equal(parsed.uin, '10000')
  assert.equal(parsed.wid, '18446744073709551615')
  assert.equal(parsed.OpenUDID, parsed.guid)
  assert.equal(parsed.mesh_devops, 'public-mesh')
})

test('native version int32 formatting retains arithmetic wrapping', () => {
  assert.equal(buildWindowsComm({ ...publicProfile, versionMain: 0xffffffff, versionSub: 0 }).cv, '-100')
  assert.equal(buildWindowsComm({ ...publicProfile, channelId: -1 })._channelid, '-1')
})

test('signature metadata preserves native delimiters, UTF8 and 64-bit precision', () => {
  const bytes = buildWindowsSignatureMetadata({ fullVersion: 4294967295,
    accountIdentity: '18446744073709551615', unixTime: '-9223372036854775808', guid: '公开设备' })
  assert.equal(bytes.toString('utf8'), '19&4294967295&&18446744073709551615&-9223372036854775808&公开设备&')
})

test('wire signatures match original DLL vectors and own the bytes they sign', () => {
  const fixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-signature-native-v2.json', import.meta.url)))
  for (const vector of fixture.vectors) {
    const body = Buffer.from(vector.bodyHex, 'hex')
    let index = 0
    const result = buildWindowsSignedRequest(body, Buffer.from(vector.metadataHex, 'hex'), {
      randomInt: () => fixture.sampledRandStream[index++]
    })
    assert.equal(result.method, 'POST')
    assert.equal(result.url, 'https://u6.y.qq.com/cgi-bin/musics.fcg')
    assert.equal(Buffer.from(`${result.headers.Sign}\0`).toString('hex'), vector.signHex)
    assert.equal(Buffer.from(`${result.headers.Mask}\0`).toString('hex'), vector.maskHex)
    body.fill(0)
    assert.equal(result.body.toString('hex'), vector.bodyHex)
    assert.deepEqual(Object.keys(result.headers), ['Sign', 'Mask'])
  }
})

test('profile and metadata reject lossy values and C-string truncation without exposing inputs', () => {
  for (const invalid of [{ versionMain: -1 }, { versionSub: 1.5 }, { channelId: '0' },
    { tmeLoginType: 0x80000000 }, { uin: '18446744073709551616' },
    { accessTokenExpiresAt: 1 }, { guid: 'private\0guid' }, { includeOpenUdid: 1 }]) {
    assert.throws(() => buildWindowsComm({ ...publicProfile, ...invalid }), (error) => !error.message.includes('private'))
  }
  assert.throws(() => buildWindowsSignatureMetadata({ fullVersion: 0x100000000,
    accountIdentity: '1', unixTime: '0', guid: '' }), RangeError)
  assert.throws(() => buildWindowsSignedRequest(Buffer.alloc(0), Buffer.from('public')), TypeError)
})
