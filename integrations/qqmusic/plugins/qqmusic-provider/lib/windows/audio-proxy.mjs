import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { WindowsMediaStream } from './media-stream.mjs'

const MAX_UINT64 = 0xffffffffffffffffn
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const REFRESH_CODES = new Set([401, 403, 410])
const OWNED_HEADERS = new Set(['host', 'range', 'accept-encoding', 'content-length',
  'connection', 'transfer-encoding', 'proxy-authorization'])

function failure(code = 'SOURCE') {
  const error = new Error('QQ 音乐音频代理请求失败')
  error.name = 'WindowsAudioProxyError'
  error.code = code
  return error
}

function aborted() {
  const error = new Error('QQ 音乐音频请求已取消')
  error.name = 'AbortError'
  return error
}

function uint64(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw failure('LENGTH')
  const number = BigInt(value)
  if (number > MAX_UINT64) throw failure('LENGTH')
  return number
}

function wait(promise, signal, discard) {
  if (signal.aborted) {
    Promise.resolve(promise).then(discard, () => {}).catch(() => {})
    return Promise.reject(aborted())
  }
  return new Promise((resolve, reject) => {
    let finished = false
    const cancel = () => {
      if (finished) return
      finished = true
      reject(aborted())
    }
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve(promise).then((value) => {
      signal.removeEventListener('abort', cancel)
      if (finished) {
        Promise.resolve(discard?.(value)).catch(() => {})
        return
      }
      finished = true
      resolve(value)
    }, (error) => {
      signal.removeEventListener('abort', cancel)
      if (finished) return
      finished = true
      reject(error)
    })
  })
}

function childController(parent) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (parent.aborted) cancel()
  else parent.addEventListener('abort', cancel, { once: true })
  return { controller, cleanup() { parent.removeEventListener('abort', cancel) } }
}

async function timedWait(promise, controller, timeoutMs, discard) {
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try { return await wait(promise, controller.signal, discard) }
  finally { clearTimeout(timer) }
}

function range(value, length) {
  if (!value) return { start: 0n, end: length - 1n, partial: false }
  if (typeof value !== 'string' || value.length > 100) throw failure('RANGE')
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || length === 0n) throw failure('RANGE')
  let start
  let end
  if (!match[1]) {
    const size = uint64(match[2])
    if (size === 0n) throw failure('RANGE')
    start = size >= length ? 0n : length - size
    end = length - 1n
  } else {
    start = uint64(match[1])
    end = match[2] ? uint64(match[2]) : length - 1n
    if (start >= length || end < start) throw failure('RANGE')
    if (end >= length) end = length - 1n
  }
  return { start, end, partial: true }
}

function responseHeaders(response, source, selected) {
  const count = selected.end - selected.start + 1n
  response.statusCode = selected.partial ? 206 : 200
  response.setHeader('Content-Type', source.contentType)
  response.setHeader('Content-Length', count.toString())
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', 'private, no-store')
  if (selected.partial) response.setHeader('Content-Range',
    `bytes ${selected.start}-${selected.end}/${source.length}`)
}

function cancelBody(response) {
  try { Promise.resolve(response?.body?.cancel()).catch(() => {}) } catch {}
}

async function drain(response, signal) {
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      response.removeListener('drain', done)
      response.removeListener('error', cancel)
      signal.removeEventListener('abort', cancel)
    }
    const done = () => { cleanup(); resolve() }
    const cancel = () => { cleanup(); reject(aborted()) }
    if (signal.aborted || response.destroyed) return cancel()
    response.once('drain', done)
    response.once('error', cancel)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

/**
 * An authorization lease contains metadata only. Each resolve transfers a new owned
 * internal key or mode1 transform owner, released after that connection or cancellation.
 * The caller establishes container boundaries and stable content identity.
 */
export class WindowsAudioProxy {
  #fetch
  #origins
  #now
  #ttl
  #timeout
  #server
  #listening
  #closing = false
  #closePromise
  #leases = new Map()
  #opening = new Set()
  #disposed = new WeakSet()

  constructor({ allowedOrigins, fetch = globalThis.fetch, now = Date.now,
    leaseTtlMs = 600000, requestTimeoutMs = 15000 } = {}) {
    if (!Array.isArray(allowedOrigins) || !allowedOrigins.length || typeof fetch !== 'function' ||
      typeof now !== 'function' || !Number.isSafeInteger(leaseTtlMs) || leaseTtlMs <= 0 ||
      leaseTtlMs > 0x7fffffff || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 ||
      requestTimeoutMs > 0x7fffffff) throw failure('CONFIG')
    this.#origins = new Set(allowedOrigins.map((origin) => {
      const url = new URL(origin)
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash) throw failure('ORIGIN')
      return url.origin
    }))
    this.#fetch = fetch
    this.#now = now
    this.#ttl = leaseTtlMs
    this.#timeout = requestTimeoutMs
  }

  #url(value, base) {
    let url
    try { url = new URL(value, base) } catch { throw failure('URL') }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !this.#origins.has(url.origin)) throw failure('ORIGIN')
    return url.href
  }

  async #disposeInput(input) {
    const decoder = input?.decoder
    if (!decoder || typeof decoder !== 'object' || this.#disposed.has(decoder)) return
    this.#disposed.add(decoder)
    if (decoder.key instanceof Uint8Array) decoder.key.fill(0)
    if (decoder.kind === 'mode1' && typeof decoder.dispose === 'function') {
      try { await decoder.dispose() } catch {}
    }
  }

  async #adopt(input) {
    let key
    try {
      if (!input || typeof input.sourceId !== 'string' || !input.sourceId || input.sourceId.length > 512 ||
        input.sourceId.includes('\0') ||
        typeof input.contentType !== 'string' || !input.contentType || input.contentType.length > 128 ||
        /[\x00-\x1f\x7f]/.test(input.contentType) || !Number.isSafeInteger(input.expiresAt)) throw failure('SOURCE')
      const decoder = input.decoder
      if (!decoder || this.#disposed.has(decoder) || !['plain', 'mode1', 'mode2'].includes(decoder.kind)) {
        throw failure('DECODER')
      }
      const length = uint64(decoder.length)
      const tail = uint64(decoder.tailBytes)
      const upstreamLength = uint64(input.upstreamLength)
      if (length + tail !== upstreamLength) throw failure('LENGTH')
      const url = this.#url(input.url)
      const headers = {}
      if (input.headers !== undefined && (!input.headers || Object.getPrototypeOf(input.headers) !== Object.prototype ||
        Object.keys(input.headers).length > 32)) throw failure('HEADERS')
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || typeof value !== 'string' ||
          /[\r\n]/.test(value) || OWNED_HEADERS.has(name.toLowerCase())) throw failure('HEADERS')
        headers[name] = value
      }
      let keyDigest = ''
      if (decoder.kind === 'mode2') {
        if (!(decoder.key instanceof Uint8Array) || !decoder.key.length || decoder.key.length > 8192) {
          throw failure('KEY')
        }
        key = Buffer.from(decoder.key)
        keyDigest = createHash('sha256').update(key).digest('hex')
        decoder.key.fill(0)
      } else if (decoder.kind === 'mode1' &&
        (typeof decoder.transform !== 'function' || typeof decoder.dispose !== 'function')) {
        throw failure('DECODER')
      }
      return { input, key, length, tail, upstreamLength, contentType: input.contentType,
        kind: decoder.kind, sourceId: input.sourceId, keyDigest,
        transport: { url, headers, expiresAt: input.expiresAt } }
    } catch (error) {
      key?.fill(0)
      await this.#disposeInput(input)
      throw error
    }
  }

  async #dispose(source) {
    source?.key?.fill(0)
    await this.#disposeInput(source?.input)
  }

  #identity(source) {
    return [source.sourceId, source.kind, source.length.toString(), source.tail.toString(),
      source.upstreamLength.toString(), source.contentType, source.keyDigest].join('\0')
  }

  async #resolve(lease, refresh, controller) {
    const { signal } = controller
    const pending = Promise.resolve().then(() => lease.resolve({ signal, refresh }))
      .then((input) => this.#adopt(input))
    const source = await timedWait(pending, controller, this.#timeout, (late) => this.#dispose(late))
    if (signal.aborted) { await this.#dispose(source); throw aborted() }
    if (lease.identity !== undefined && this.#identity(source) !== lease.identity) {
      await this.#dispose(source)
      throw failure('IDENTITY')
    }
    return source
  }

  async #refresh(lease) {
    if (lease.refreshing) return lease.refreshing
    const child = childController(lease.controller.signal)
    lease.refreshing = (async () => {
      let source
      try {
        source = await this.#resolve(lease, true, child.controller)
        if (source.transport.expiresAt <= this.#now()) throw failure('EXPIRED')
        lease.transport = source.transport
        return source.transport
      } finally {
        await this.#dispose(source)
        child.cleanup()
      }
    })()
    try { return await lease.refreshing } finally { lease.refreshing = null }
  }

  async #listen() {
    if (!this.#listening) {
      const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
        response.on('error', () => {})
        this.#handle(request, response).catch(() => {
          if (response.headersSent) response.destroy()
          else { response.statusCode = 502; response.end('QQ audio stream failed') }
        })
      })
      server.maxHeadersCount = 32
      server.on('clientError', (_error, socket) => socket.destroy())
      this.#server = server
      this.#listening = new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject)
          server.unref()
          resolve(server.address().port)
        })
      })
    }
    return this.#listening
  }

  async open({ resolve, signal } = {}) {
    if (this.#closing || typeof resolve !== 'function') throw failure('CLOSED')
    const parent = new AbortController()
    const cancel = () => parent.abort()
    if (signal?.aborted) throw aborted()
    signal?.addEventListener('abort', cancel, { once: true })
    const child = childController(parent.signal)
    this.#opening.add(parent)
    const lease = { resolve, controller: parent, tasks: new Set(), refreshing: null }
    let source
    try {
      source = await this.#resolve(lease, false, child.controller)
      lease.identity = this.#identity(source)
      lease.length = source.length
      lease.transport = source.transport
      if (source.transport.expiresAt <= this.#now()) await wait(this.#refresh(lease), child.controller.signal)
      await this.#dispose(source)
      source = null
      const port = await wait(this.#listen(), child.controller.signal)
      if (this.#closing || parent.signal.aborted) throw aborted()
      const path = `/audio/${randomBytes(24).toString('hex')}`
      lease.path = path
      lease.expiresAt = this.#now() + this.#ttl
      lease.detach = () => signal?.removeEventListener('abort', cancel)
      lease.timer = setTimeout(() => this.#revoke(lease), this.#ttl)
      lease.timer.unref?.()
      this.#leases.set(path, lease)
      parent.signal.addEventListener('abort', () => this.#revoke(lease), { once: true })
      // Internal Range offsets remain uint64. Omit public byte metadata when it
      // cannot be represented exactly, rather than narrowing the stream support.
      return { url: `http://127.0.0.1:${port}${path}`, expiresAt: lease.expiresAt,
        ...(lease.length <= BigInt(Number.MAX_SAFE_INTEGER) ? { bytes: Number(lease.length) } : {}),
        release: () => this.#revoke(lease) }
    } catch (error) {
      parent.abort()
      signal?.removeEventListener('abort', cancel)
      throw error
    } finally {
      await this.#dispose(source)
      child.cleanup()
      this.#opening.delete(parent)
    }
  }

  async #revoke(lease) {
    if (lease.closed) return lease.revoking ?? Promise.resolve()
    lease.closed = true
    clearTimeout(lease.timer)
    lease.detach?.()
    this.#leases.delete(lease.path)
    lease.controller.abort()
    lease.revoking = Promise.allSettled([...lease.tasks, ...(lease.refreshing ? [lease.refreshing] : [])])
      .then(() => { lease.transport = null; lease.identity = null })
    return lease.revoking
  }

  async revokeAll() {
    for (const opening of this.#opening) opening.abort()
    await Promise.all([...this.#leases.values()].map((lease) => this.#revoke(lease)))
  }

  close() {
    if (this.#closePromise) return this.#closePromise
    this.#closing = true
    this.#closePromise = (async () => {
      await this.revokeAll()
      if (!this.#server) return
      try { await this.#listening } catch { return }
      await new Promise((resolve) => {
        this.#server.close(resolve)
        this.#server.closeAllConnections?.()
      })
    })()
    return this.#closePromise
  }

  async #handle(request, response) {
    const port = this.#server.address()?.port
    if (request.headers.host !== `127.0.0.1:${port}`) { response.statusCode = 403; response.end(); return }
    const lease = this.#leases.get(request.url)
    if (!lease || lease.closed) { response.statusCode = 404; response.end(); return }
    if (lease.expiresAt <= this.#now()) {
      await this.#revoke(lease)
      response.statusCode = 410; response.end(); return
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.statusCode = 405; response.setHeader('Allow', 'GET, HEAD'); response.end(); return
    }
    let selected
    try { selected = range(request.headers.range, lease.length) } catch {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${lease.length}`)
      response.end(); return
    }
    const child = childController(lease.controller.signal)
    const cancel = () => child.controller.abort()
    request.once('aborted', cancel)
    response.once('close', cancel)
    const task = this.#serve(request, response, lease, selected, child.controller)
    lease.tasks.add(task)
    try { await task } finally {
      lease.tasks.delete(task)
      request.removeListener('aborted', cancel)
      response.removeListener('close', cancel)
      child.controller.abort()
      child.cleanup()
    }
  }

  async #upstream(transport, selected, controller) {
    const { signal } = controller
    let url = transport.url
    let headers = { ...transport.headers, Range: `bytes=${selected.start}-${selected.end}`,
      'Accept-Encoding': 'identity' }
    for (let redirects = 0; ; redirects += 1) {
      const response = await timedWait(this.#fetch(this.#url(url), {
        method: 'GET', redirect: 'manual', headers, signal
      }), controller, this.#timeout, cancelBody)
      if (!REDIRECTS.has(response.status)) return response
      try {
        if (redirects >= 3 || !response.headers.get('location')) throw failure('REDIRECT')
        const next = this.#url(response.headers.get('location'), url)
        if (new URL(next).origin !== new URL(url).origin) {
          headers = Object.fromEntries(Object.entries(headers)
            .filter(([name]) => !['authorization', 'cookie'].includes(name.toLowerCase())))
        }
        url = next
      } finally { await cancelBody(response) }
    }
  }

  async #serve(request, response, lease, selected, controller) {
    const { signal } = controller
    let source
    let upstream
    let reader
    let cipher
    try {
      source = await this.#resolve(lease, false, controller)
      let transport = lease.transport?.expiresAt > source.transport.expiresAt
        ? lease.transport : source.transport
      if (transport.expiresAt <= this.#now()) transport = await wait(this.#refresh(lease), signal)
      if (request.method === 'HEAD' || source.length === 0n) {
        responseHeaders(response, source, selected)
        response.end(); return
      }
      upstream = await this.#upstream(transport, selected, controller)
      if (REFRESH_CODES.has(upstream.status)) {
        await cancelBody(upstream)
        transport = await wait(this.#refresh(lease), signal)
        upstream = await this.#upstream(transport, selected, controller)
      }
      const encoding = upstream.headers.get('content-encoding')
      if (encoding && encoding !== 'identity') throw failure('ENCODING')
      let position
      const count = selected.end - selected.start + 1n
      if (upstream.status === 206) {
        const expected = `bytes ${selected.start}-${selected.end}/${source.upstreamLength}`
        if (upstream.headers.get('content-range') !== expected) throw failure('UPSTREAM_RANGE')
        const length = upstream.headers.get('content-length')
        if (length !== null && uint64(length) !== count) throw failure('UPSTREAM_LENGTH')
        position = selected.start
      } else if (upstream.status === 200) {
        if (uint64(upstream.headers.get('content-length')) !== source.upstreamLength) {
          throw failure('UPSTREAM_LENGTH')
        }
        position = 0n
      } else throw failure('UPSTREAM_STATUS')
      if (!upstream.body?.getReader) throw failure('BODY')
      if (source.kind === 'mode2') {
        cipher = new WindowsMediaStream(source.key)
        source.key.fill(0)
      }
      reader = upstream.body.getReader()
      responseHeaders(response, source, selected)
      let delivered = 0n
      while (delivered < count) {
        const part = await timedWait(reader.read(), controller, this.#timeout)
        if (part.done || !(part.value instanceof Uint8Array)) throw failure('TRUNCATED')
        const begin = position
        position += BigInt(part.value.length)
        if (upstream.status === 206 && position > selected.end + 1n) throw failure('UPSTREAM_LENGTH')
        const first = selected.start > begin ? selected.start : begin
        const last = selected.end + 1n < position ? selected.end + 1n : position
        if (last <= first) continue
        const data = part.value.subarray(Number(first - begin), Number(last - begin))
        for (let offset = 0; offset < data.length; offset += 65536) {
          if (signal.aborted) throw aborted()
          const bytes = Buffer.from(data.subarray(offset, offset + 65536))
          const absoluteOffset = (first + BigInt(offset)).toString()
          const transformed = cipher ? cipher.transform(bytes, absoluteOffset) : source.kind === 'mode1'
            ? source.input.decoder.transform(bytes, absoluteOffset) : bytes
          if (!(transformed instanceof Uint8Array) || transformed.length !== bytes.length) throw failure('DECODER')
          if (!response.write(transformed)) await drain(response, signal)
          delivered += BigInt(bytes.length)
        }
      }
      response.end()
    } finally {
      cipher?.dispose()
      await this.#dispose(source)
      // An unresponsive upstream cancel promise must not retain a request or its key.
      if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}) } catch {} }
      else cancelBody(upstream)
    }
  }
}

export function createWindowsAudioProxy(options) {
  return new WindowsAudioProxy(options)
}
