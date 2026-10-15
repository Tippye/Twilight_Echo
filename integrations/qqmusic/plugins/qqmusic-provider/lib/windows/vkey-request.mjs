// QQMusic_Protocol.dll 22.71 FUN_10062e5b constructs this service call.
// The outer Musicu envelope, authentication and transport are separate owners.
export const WINDOWS_VKEY_REQUEST_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  version: '22.71',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  functionAddress: '0x10062e5b',
  evidenceId: 'ev_c0290d900ba243d73d49bf210dc9a8c14d4b260988d241234418b5df54369554'
})

const SERVICES = Object.freeze({
  playback: ['music.vkey.GetVkey', 'UrlGetVkey'],
  encryptedPlayback: ['music.vkey.GetEVkey', 'CgiGetEVkey'],
  download: ['music.vkey.GetDownUrl', 'CgiGetDownUrl'],
  encryptedDownload: ['music.vkey.GetEDownUrl', 'CgiGetEDownUrl']
})

/**
 * Build the observed Windows service call from already resolved client inputs.
 * This does not generate a device GUID, obtain credentials or send a request.
 */
export function buildWindowsVkeyCall({
  songs,
  guid,
  uin,
  downloadFrom,
  encrypted = false,
  download = false,
  downloadSource = ''
} = {}) {
  if (!isJsonObject(songs)) {
    throw new TypeError('songs must be a plain JSON object')
  }
  if (typeof guid !== 'string') throw new TypeError('guid must be a string')
  if (typeof uin !== 'string' || !/^\d+$/.test(uin) || BigInt(uin) > 0xffffffffffffffffn) {
    throw new TypeError('uin must be an unsigned 64-bit decimal string')
  }
  if (!Number.isInteger(downloadFrom) || downloadFrom < -0x80000000 || downloadFrom > 0x7fffffff) {
    throw new RangeError('downloadFrom must be a signed int32')
  }
  if (typeof encrypted !== 'boolean' || typeof download !== 'boolean') {
    throw new TypeError('encrypted and download must be booleans')
  }
  if (typeof downloadSource !== 'string') {
    throw new TypeError('downloadSource must be a string')
  }

  const service = download
    ? encrypted ? SERVICES.encryptedDownload : SERVICES.download
    : encrypted ? SERVICES.encryptedPlayback : SERVICES.playback
  const param = {
    guid,
    downloadfrom: downloadFrom,
    ctx: 1,
    referer: 'y.qq.com',
    scene: 0,
    checklimit: download ? 1 : 0,
    uin: BigInt(uin).toString(),
    nettype: ''
  }
  for (const key of ['filename', 'musicfile', 'songmid', 'songtype']) {
    // JsonCpp's const member lookup yields null for a missing source member.
    const descriptor = Object.getOwnPropertyDescriptor(songs, key)
    if (descriptor && !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('song fields must be JSON data properties')
    }
    param[key] = descriptor ? cloneJsonValue(descriptor.value) : null
  }
  if (downloadSource.length > 0) param.source = 'mp3download'
  return { module: service[0], method: service[1], param }
}

function isJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const array = Array.isArray(value)
  if ((!array && !isJsonObject(value)) || ancestors.has(value)) {
    throw new TypeError('song fields must contain finite, acyclic JSON values')
  }
  ancestors.add(value)
  const clone = array ? [] : {}
  const keys = array ? Array.from({ length: value.length }, (_, i) => String(i)) : Object.keys(value)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('song fields must contain JSON data properties without array holes')
    }
    Object.defineProperty(clone, key, {
      value: cloneJsonValue(descriptor.value, ancestors),
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  ancestors.delete(value)
  return clone
}
