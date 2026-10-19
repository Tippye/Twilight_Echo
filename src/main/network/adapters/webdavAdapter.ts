import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { isIPv6 } from 'node:net'
import { buildNetworkEntryId, normalizeRemotePath } from '../networkPath.ts'
import { NetworkResumeUnsupported, NetworkSourceFailure } from '../errors.ts'
import { entryKind } from '../entryKinds.ts'
import type { NetworkEntry, NetworkSourceProfile } from '../../../shared/networkSources.ts'
import type { NetworkAuth, NetworkSourceAdapter, NetworkSourceSession } from './types.ts'

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const DEFAULT_RESPONSE_LIMIT_BYTES = 8 * 1024 * 1024

function isCollectionBlock(block: string): boolean {
  return /<(?:[\w.-]+:)?collection\s*\/?\s*>/i.test(block)
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(String.raw`<(?:[\w.-]+:)?${tag}[^>]*>([^<]*)<`, 'i'))
  return match ? match[1].trim() : null
}

/** 解码 XML 文本实体：WebDAV 的 href 中 `&` 等必须转义为 `&amp;`。 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 孤立代理项无法百分号编码，会在请求阶段抛 URIError。 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/**
 * 把 DAV:href 归一化为与请求一致的远程路径：
 * - 兼容绝对 URI（反向代理与部分服务端会返回完整 URL）；
 * - 先解 XML 实体，再解百分号编码；
 * - 非法、穿越或含控制字符的 href 返回 null 并丢弃，避免一条坏记录中断整个目录。
 */
function hrefToPath(href: string): string | null {
  const unescaped = decodeXmlEntities(href.trim())
  let raw = unescaped
  if (/^[a-z][a-z0-9+.-]*:/i.test(unescaped)) {
    try {
      raw = new URL(unescaped).pathname
    } catch {
      // 保留原始值交给 normalizeRemotePath 判定
    }
  }
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // 保留原始百分号编码，至少不因单个坏 href 抛 URIError
  }
  // 数字 XML 实体可以造出孤立代理项（如 &#xD800;），必须丢弃。
  if (LONE_SURROGATE.test(decoded)) return null
  try {
    return normalizeRemotePath(decoded)
  } catch {
    return null
  }
}

function parseMultistatus(
  xml: string
): Array<{ path: string; directory: boolean; size?: number; mime?: string; mtimeMs?: number }> {
  const blocks: string[] = []
  const pattern = /<(?:[\w.-]+:)?response[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) blocks.push(match[1])

  const entries: Array<{
    path: string
    directory: boolean
    size?: number
    mime?: string
    mtimeMs?: number
  }> = []
  for (const block of blocks) {
    const href = extractTag(block, 'href')
    if (!href) continue
    const path = hrefToPath(href)
    if (!path) continue
    const sizeText = extractTag(block, 'getcontentlength')
    const size = sizeText ? Number.parseInt(sizeText, 10) : undefined
    const mime = extractTag(block, 'getcontenttype') ?? undefined
    const mtimeText = extractTag(block, 'getlastmodified')
    const mtimeMs = mtimeText ? Date.parse(mtimeText) : undefined
    entries.push({
      path,
      directory: isCollectionBlock(block),
      size: Number.isFinite(size) ? size : undefined,
      mime,
      mtimeMs: Number.isFinite(mtimeMs as number) ? mtimeMs : undefined
    })
  }
  return entries
}

function nameOf(path: string): string {
  if (path === '/') return '/'
  return path.split('/').pop() ?? ''
}

function authHeader(auth: NetworkAuth): string | undefined {
  // 只要用户显式选择了口令认证就发送 Basic，即便口令为空；
  // 空口令在部分服务端是合法配置，不能因为 falsy 而静默降级为匿名。
  if (auth.kind !== 'password') return undefined
  const username = auth.username ?? ''
  return `Basic ${Buffer.from(`${username}:${auth.password}`).toString('base64')}`
}

/** IPv6 字面量必须加方括号，否则无法拼进 URL。 */
function hostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[') && isIPv6(host)) return `[${host}]`
  return host
}

/**
 * 逐段做百分号编码并保留 `/` 分隔符。`encodeURI` 不会编码 `#`、`?`，
 * 会让含这些字符的文件名把路径截断成片段/查询串，必须用 `encodeURIComponent`。
 */
function encodeRemotePath(remotePath: string): string {
  const normalized = normalizeRemotePath(remotePath)
  if (normalized === '/') return '/'
  try {
    return normalized
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
  } catch {
    throw new NetworkSourceFailure('network', '远程路径包含无法编码的字符')
  }
}

export function createWebDavAdapter(): NetworkSourceAdapter {
  return {
    protocol: 'webdav',
    async createSession(
      profile: NetworkSourceProfile,
      auth: NetworkAuth
    ): Promise<NetworkSourceSession> {
      const scheme = profile.webdavScheme ?? (profile.port === 443 ? 'https' : 'http')
      const cleanHost = hostForUrl(profile.host.trim().replace(/^https?:\/\//i, ''))
      const authorization = authHeader(auth)
      const timeoutMs = profile.options.transferTimeoutMs
      const connectTimeoutMs = profile.options.connectTimeoutMs

      function buildUrl(remotePath: string): string {
        let base: URL
        try {
          base = new URL(`${scheme}://${cleanHost}`)
        } catch {
          throw new NetworkSourceFailure('network', '网络地址不合法')
        }
        // 仅在显式配置了 port 时覆盖：否则保留 host 内嵌端口，
        // 避免把 `nas:5001` 静默改写成协议默认端口。
        if (profile.port != null) base.port = String(profile.port)
        // host 里误带的路径/查询/片段不应进入每个请求的 URL。
        base.pathname = encodeRemotePath(remotePath)
        base.search = ''
        base.hash = ''
        return base.toString()
      }

      function createRequest(
        method: string,
        url: string,
        headers: Record<string, string>,
        signal: AbortSignal | undefined,
        body: string | undefined,
        includeAuth: boolean
      ): Promise<IncomingMessage> {
        return new Promise((resolve, reject) => {
          let parsed: URL
          try {
            parsed = new URL(url)
          } catch {
            reject(new NetworkSourceFailure('network', '网络地址不合法'))
            return
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            reject(new NetworkSourceFailure('network', '远程服务器返回了不支持的重定向协议'))
            return
          }
          const requestFn: typeof httpRequest =
            parsed.protocol === 'https:' ? httpsRequest : httpRequest
          const finalHeaders: Record<string, string> = {
            ...(includeAuth && authorization ? { Authorization: authorization } : {}),
            ...headers
          }
          // PROPFIND 带 body；显式 Content-Length 兼容不接受 chunked 的旧服务端。
          if (body !== undefined) {
            finalHeaders['Content-Length'] = String(Buffer.byteLength(body, 'utf8'))
          }
          const req = requestFn(url, { method, headers: finalHeaders, signal }, (res) =>
            resolve(res)
          )
          // Socket timeouts only start after connection. A separate deadline
          // also bounds DNS lookup, TCP/TLS setup and waiting for headers.
          const onTimeout = (): void => {
            req.destroy(new NetworkSourceFailure('timeout', '网络请求超时'))
          }
          const connectTimer = setTimeout(onTimeout, connectTimeoutMs)
          const clearConnectTimer = (): void => clearTimeout(connectTimer)
          req.once('close', clearConnectTimer)
          req.on('timeout', onTimeout)
          req.once('response', () => {
            clearConnectTimer()
            // Once headers arrive, active transfers have only an idle timeout.
            req.setTimeout(timeoutMs)
          })
          req.on('error', (err) => {
            clearConnectTimer()
            if (err instanceof NetworkSourceFailure) {
              reject(err)
            } else if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
              reject(new NetworkSourceFailure('timeout', '网络请求超时'))
            } else {
              reject(new NetworkSourceFailure('network', `网络请求失败：${err.message}`))
            }
          })
          if (body !== undefined) req.write(body)
          req.end()
        })
      }

      async function perform(
        method: string,
        remotePath: string,
        headers: Record<string, string>,
        signal?: AbortSignal,
        body?: string
      ): Promise<{ res: IncomingMessage; url: string }> {
        let url = buildUrl(remotePath)
        let currentMethod = method
        let currentBody = body
        let includeAuth = true
        for (let redirect = 0; ; redirect += 1) {
          const res = await createRequest(
            currentMethod,
            url,
            headers,
            signal,
            currentBody,
            includeAuth
          )
          const status = res.statusCode ?? 0
          const location = res.headers.location
          if (!location || !REDIRECT_STATUSES.has(status)) return { res, url }
          // Drain the redirect body so the keep-alive socket can be reused.
          res.resume()
          if (redirect >= MAX_REDIRECTS) {
            throw new NetworkSourceFailure('network', '远程服务器重定向次数过多')
          }
          let next: URL
          try {
            next = new URL(location, url)
          } catch {
            throw new NetworkSourceFailure('network', '远程服务器返回了无效的重定向地址')
          }
          const current = new URL(url)
          // 同主机同端口的 http→https 升级可继续带凭据；
          // 主机/端口变化或降级到 http 时丢弃，避免凭据泄露或明文传输。
          const hostUnchanged = next.host === current.host
          const notDowngraded = next.protocol === 'https:' || current.protocol === 'http:'
          if (!hostUnchanged || !notDowngraded) includeAuth = false
          if (status === 303) {
            currentMethod = 'GET'
            currentBody = undefined
          }
          url = next.toString()
        }
      }

      /** 重定向后的有效路径，用于正确过滤自身条目（如补斜杠 301）。 */
      function effectivePath(url: string, fallback: string): string {
        try {
          return hrefToPath(new URL(url).pathname) ?? normalizeRemotePath(fallback)
        } catch {
          return normalizeRemotePath(fallback)
        }
      }

      function throwForStatus(res: IncomingMessage, remotePath: string): void {
        const status = res.statusCode
        if (!status || (status >= 200 && status < 300)) return
        // 消费/丢弃错误响应体，避免 keep-alive 连接被挂起的 body 卡住。
        res.resume()
        if (status === 401) {
          const challenge = res.headers['www-authenticate']
          const text = Array.isArray(challenge) ? challenge.join(', ') : (challenge ?? '')
          // 服务端只提供 Digest 时，Basic 凭据本身可能是对的，提示要准确。
          // 匹配 challenge 首令牌，避免 Basic realm 里恰好含 “Digest” 时误判。
          if (/(?:^|,\s*)Digest\s+(?:realm|nonce|algorithm|qop)\s*=/i.test(text)) {
            throw new NetworkSourceFailure('auth', '服务器要求 Digest 认证，当前仅支持 Basic')
          }
          throw new NetworkSourceFailure('auth', '认证失败，请检查用户名或密码')
        }
        if (status === 403) throw new NetworkSourceFailure('denied', '没有权限访问该目录')
        if (status === 404)
          throw new NetworkSourceFailure('notFound', `远程路径不存在：${remotePath}`)
        throw new NetworkSourceFailure('network', `远程服务器返回错误状态 ${status}`)
      }

      async function collectBody(
        res: IncomingMessage,
        limitBytes = DEFAULT_RESPONSE_LIMIT_BYTES
      ): Promise<string> {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of res) {
          const buffer = Buffer.from(chunk)
          total += buffer.length
          if (total > limitBytes) throw new NetworkSourceFailure('network', '目录响应过大')
          chunks.push(buffer)
        }
        return Buffer.concat(chunks).toString('utf8')
      }

      function entriesFromMultistatus(
        xml: string,
        requestedPath: string,
        includeSelf = false
      ): NetworkEntry[] {
        const requested = normalizeRemotePath(requestedPath)
        return parseMultistatus(xml)
          .filter((item) => includeSelf || item.path !== requested)
          .map((item) => {
            const name = nameOf(item.path)
            return {
              id: buildNetworkEntryId(profile.protocol, profile.id, item.path),
              profileId: profile.id,
              name,
              kind: entryKind(name, { mime: item.mime, directory: item.directory }),
              path: item.path,
              sizeBytes: item.size,
              mtimeMs: item.mtimeMs,
              mimeType: item.mime
            }
          })
      }

      const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`

      return {
        protocol: profile.protocol,
        async list(remotePath: string, signal?: AbortSignal): Promise<NetworkEntry[]> {
          const { res, url } = await perform(
            'PROPFIND',
            remotePath,
            { Depth: '1', 'Content-Type': 'application/xml' },
            signal,
            propfindBody
          )
          throwForStatus(res, remotePath)
          return entriesFromMultistatus(await collectBody(res), effectivePath(url, remotePath))
        },
        async stat(remotePath: string, signal?: AbortSignal): Promise<NetworkEntry | null> {
          const { res, url } = await perform(
            'PROPFIND',
            remotePath,
            { Depth: '0', 'Content-Type': 'application/xml' },
            signal,
            propfindBody
          )
          throwForStatus(res, remotePath)
          const requested = effectivePath(url, remotePath)
          const entries = entriesFromMultistatus(await collectBody(res), requested, true)
          return entries.find((entry) => entry.path === requested) ?? entries[0] ?? null
        },
        async readStream(
          remotePath: string,
          signal?: AbortSignal,
          options?: { start?: number }
        ): Promise<NodeJS.ReadableStream> {
          const headers: Record<string, string> =
            options?.start != null && options.start > 0 ? { Range: `bytes=${options.start}-` } : {}
          const { res } = await perform('GET', remotePath, headers, signal)
          if (options?.start != null && options.start > 0) {
            const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(res.headers['content-range'] ?? '')
            if (
              res.statusCode === 200 ||
              res.statusCode === 416 ||
              (res.statusCode === 206 &&
                (!range || Number(range[1]) !== options.start || Number(range[2]) < options.start))
            ) {
              res.destroy()
              throw new NetworkResumeUnsupported()
            }
          }
          throwForStatus(res, remotePath)
          return res
        },
        async resolvePlaybackUrl(remotePath: string): Promise<string | null> {
          // 匿名 WebDAV 可直接 URL 播放；带认证时 URL 无法携带凭据，必须走缓存下载。
          if (auth.kind !== 'anonymous') return null
          return buildUrl(remotePath)
        },
        async close(): Promise<void> {
          // HTTP 无状态会话，无需清理。
        }
      }
    }
  }
}
