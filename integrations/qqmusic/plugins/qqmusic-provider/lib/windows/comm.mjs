import { nativeSigned64 } from './json-integer.mjs'

// Verified getter machine code in QQMusicCommon.dll 22.71: RVA3f0d4/3f0e6/3f0ea.
export const WINDOWS_CLIENT_VERSION = Object.freeze({ main: 22, sub: 71, full: 2271 })

export const WINDOWS_COMM_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  functionAddress: '0x1007406e',
  evidenceId: 'ev_ff2a617ca57e6530a18adace3302159fe041acdc80f0b3ddd737ae6009f83105'
})

function string(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  if (value.includes('\0')) throw new TypeError(`${name} must not contain NUL`)
  return value
}

function integer(value, name, unsigned = false) {
  const minimum = unsigned ? 0 : -0x80000000
  const maximum = unsigned ? 0xffffffff : 0x7fffffff
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a ${unsigned ? 'unsigned' : 'signed'} int32`)
  }
  return value
}

export function windowsUnsigned64(value, name) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new TypeError(`${name} must be an unsigned 64-bit decimal string`)
  }
  const result = BigInt(value)
  if (result > 0xffffffffffffffffn) throw new RangeError(`${name} exceeds uint64`)
  return result.toString()
}

/** Build from resolved Windows account/device inputs; this does not obtain them. */
export function buildWindowsComm({ uin, versionMain, versionSub, wid,
  openid, accessToken, accessTokenExpiresAt, unionId, musickey, guid,
  tmeLoginType, includeOpenUdid = false, uid, meshDevops = '',
  channelId, encodedOsVersion } = {}) {
  integer(versionMain, 'versionMain', true)
  integer(versionSub, 'versionSub', true)
  if (typeof includeOpenUdid !== 'boolean') throw new TypeError('includeOpenUdid must be a boolean')
  const result = {
    uin: windowsUnsigned64(uin, 'uin'),
    // Native IMUL/ADD is 32-bit and the formatter uses %d.
    cv: String((Math.imul(versionMain, 100) + versionSub) | 0),
    ct: '19'
  }
  if (wid !== undefined) result.wid = windowsUnsigned64(wid, 'wid')
  Object.assign(result, {
    patch: '118',
    psrf_qqopenid: string(openid, 'openid'),
    psrf_qqaccess_token: string(accessToken, 'accessToken'),
    psrf_access_token_expiresAt: nativeSigned64(accessTokenExpiresAt),
    psrf_qqunionid: string(unionId, 'unionId'),
    authst: string(musickey, 'musickey')
  })
  guid = string(guid, 'guid')
  if (includeOpenUdid) result.OpenUDID = guid
  result.guid = guid
  if (uid !== undefined) result.uid = nativeSigned64(uid)
  meshDevops = string(meshDevops, 'meshDevops')
  if (meshDevops.length > 0) result.mesh_devops = meshDevops
  result._channelid = String(integer(channelId, 'channelId'))
  // The native UTF8URLEncode helper's output is supplied by the device owner.
  result._os_version = string(encodedOsVersion, 'encodedOsVersion')
  result.tmeAppID = 'qqmusic'
  result.tmeLoginType = integer(tmeLoginType, 'tmeLoginType')
  return result
}

/** 0x100737a8 metadata; CAFcf musicid -> payload+70 -> OnLogin globals55f8/fc. */
export function buildWindowsSignatureMetadata({ fullVersion, accountIdentity, unixTime, guid } = {}) {
  return Buffer.from(`19&${integer(fullVersion, 'fullVersion', true)}&&${windowsUnsigned64(accountIdentity, 'accountIdentity')}&${nativeSigned64(unixTime).rawJSON}&${string(guid, 'guid')}&`, 'utf8')
}
