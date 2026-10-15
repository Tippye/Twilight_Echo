import { nativeSigned64 } from './json-integer.mjs'

const MAX_JSON_BYTES = 8 * 1024 * 1024
const STRINGS = ['openid', 'access_token', 'refresh_token', 'musickey', 'unionid',
  'refresh_key', 'encryptUin']
const INT64 = ['expired_at', 'musicid', 'musickeyCreateTime']

export class WindowsRpcError extends Error {
  constructor(code) {
    super(`QQ 音乐 Windows 接口错误（${code}）`)
    this.name = 'WindowsRpcError'
    this.code = code
  }
}

/** Preserve large integer literals without exposing response bytes in parse errors. */
export function parseWindowsJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new TypeError('QQ 音乐响应大小或类型无效')
  }
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        if (typeof context?.source !== 'string') throw new Error('Lossless JSON parsing is unavailable')
        if (/^-?\d+$/.test(context.source)) return BigInt(context.source).toString()
      }
      return value
    })
  } catch {
    throw new Error('QQ 音乐返回了无效 JSON')
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function code(value) {
  return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff
}

/** Both top-level and requested-item success are required by the adapter. */
export function parseWindowsRpcResponse(text, requestKey) {
  if (typeof requestKey !== 'string' || requestKey === 'comm' || requestKey.length === 0) {
    throw new TypeError('Windows RPC request key is invalid')
  }
  const root = parseWindowsJson(text)
  if (!object(root) || !Object.hasOwn(root, 'code') || !code(root.code)) {
    throw new Error('QQ 音乐响应缺少有效状态码')
  }
  if (root.code !== 0) throw new WindowsRpcError(root.code)
  const item = Object.hasOwn(root, requestKey) ? root[requestKey] : null
  if (!object(item) || !Object.hasOwn(item, 'code') || !code(item.code)) {
    throw new Error('QQ 音乐响应缺少请求结果')
  }
  if (item.code !== 0) throw new WindowsRpcError(item.code)
  if (!object(item.data)) throw new Error('QQ 音乐响应缺少有效数据')
  return item.data
}

/** Native 0x100cafcf fields. Stronger validation prevents partial logged-in state. */
export function extractWindowsLoginSession(data) {
  if (!object(data)) throw new TypeError('QQ 音乐登录数据无效')
  const session = {}
  for (const key of STRINGS) {
    if (!Object.hasOwn(data, key) || typeof data[key] !== 'string' || data[key].includes('\0')) {
      throw new Error('QQ 音乐登录数据字段无效')
    }
    session[key] = data[key]
  }
  for (const key of INT64) {
    const value = data[key]
    const decimal = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
    try { session[key] = nativeSigned64(decimal).rawJSON }
    catch { throw new Error('QQ 音乐登录数据整数无效') }
  }
  if (!code(data.loginType) || BigInt(session.musicid) <= 0n || session.musickey.length === 0) {
    throw new Error('QQ 音乐登录会话不完整')
  }
  session.loginType = data.loginType
  return session
}
