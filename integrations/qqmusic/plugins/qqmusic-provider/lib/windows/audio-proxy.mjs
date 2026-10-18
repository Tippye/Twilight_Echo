import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { WindowsMediaStream } from './media-stream.mjs'

const MAX_UINT64 = 0xffffffffffffffffn
const RANGE_BLOCK_BYTES = 512 * 1024
const RANGE_WINDOW = 4
const PARALLEL_MIN_BYTES = BigInt(RANGE_BLOCK_BYTES * RANGE_WINDOW)
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

// A permit covers one streaming/buffered block until consumption or discard,
// including blocks shared by simultaneous probes/seeks on different leases.
function rangeSlots(limit) {
  let available = limit
  const queue = []
  const pump = () => {
    while (available > 0 && queue.length) {
      const ticket = queue.shift()
      ticket.signal.removeEventListener('abort', ticket.cancel)
      available -= 1
      let released = false
      ticket.resolve(() => {
        if (released) return
        released = true
        available += 1
        pump()
      })
    }
  }
  return (signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return }
    const ticket = { signal, resolve, cancel() {
      const index = queue.indexOf(ticket)
      if (index !== -1) queue.splice(index, 1)
      reject(aborted())
    } }
    queue.push(ticket)
    signal.addEventListener('abort', ticket.cancel, { once: true })
    pump()
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
  #slot = rangeSlots(8)

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
        lease.transportRevision += 1
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
    const lease = { resolve, controller: parent, tasks: new Set(), refreshing: null, transportRevision: 0 }
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

  async #transport(lease, source, controller) {
    // A later-resolving old snapshot can carry a longer URL expiry. Once a
    // refresh is published, its live transport wins over that stale snapshot.
    const published = lease.transportRevision > 0 && lease.transport?.expiresAt > this.#now()
    let transport = published || lease.transport?.expiresAt > source.transport.expiresAt
      ? lease.transport : source.transport
    if (transport.expiresAt <= this.#now()) transport = await wait(this.#refresh(lease), controller.signal)
    // Stamp the transport in the same turn as selection. An await in the caller
    // must not attach a newer refresh revision to an already selected old URL.
    return { transport, revision: lease.transportRevision }
  }

  async #fetchRange(lease, source, selected, controller) {
    let { transport, revision } = await this.#transport(lease, source, controller)
    let upstream = await this.#upstream(transport, selected, controller)
    if (REFRESH_CODES.has(upstream.status)) {
      cancelBody(upstream)
      // A delayed rejection from an older wave uses the identity-checked
      // transport already published by its sibling instead of refreshing again.
      transport = lease.transportRevision !== revision && lease.transport?.expiresAt > this.#now()
        ? lease.transport : await wait(this.#refresh(lease), controller.signal)
      upstream = await this.#upstream(transport, selected, controller)
    }
    return upstream
  }

  async #endOfRange(reader, controller) {
    const part = await timedWait(reader.read(), controller, this.#timeout)
    if (!part.done) throw failure('UPSTREAM_LENGTH')
  }

  #position(upstream, source, selected, allowWhole = true) {
    const encoding = upstream.headers.get('content-encoding')
    if (encoding && encoding !== 'identity') throw failure('ENCODING')
    if (upstream.status === 206) {
      const expected = `bytes ${selected.start}-${selected.end}/${source.upstreamLength}`
      if (upstream.headers.get('content-range') !== expected) throw failure('UPSTREAM_RANGE')
      const length = upstream.headers.get('content-length')
      if (length !== null && uint64(length) !== selected.end - selected.start + 1n) throw failure('UPSTREAM_LENGTH')
    } else if (upstream.status === 200 && allowWhole) {
      if (uint64(upstream.headers.get('content-length')) !== source.upstreamLength) throw failure('UPSTREAM_LENGTH')
    } else throw failure('UPSTREAM_STATUS')
    if (!upstream.body?.getReader) throw failure('BODY')
    return upstream.status === 206 ? selected.start : 0n
  }

  async #write(response, source, cipher, data, first, signal) {
    for (let offset = 0; offset < data.length; offset += 65536) {
      if (signal.aborted) throw aborted()
      const bytes = Buffer.from(data.subarray(offset, offset + 65536))
      const absoluteOffset = (first + BigInt(offset)).toString()
      const transformed = cipher ? cipher.transform(bytes, absoluteOffset) : source.kind === 'mode1'
        ? source.input.decoder.transform(bytes, absoluteOffset) : bytes
      if (!(transformed instanceof Uint8Array) || transformed.length !== bytes.length) throw failure('DECODER')
      if (!response.write(transformed)) await drain(response, signal)
    }
  }

  #bufferBlock(lease, selected, controller) {
    const block = { selected, release: null, bytes: null }
    block.done = (async () => {
      let source, upstream, reader
      const child = childController(controller.signal)
      try {
        block.release = await this.#slot(child.controller.signal)
        source = await this.#resolve(lease, false, child.controller)
        upstream = await this.#fetchRange(lease, source, selected, child.controller)
        this.#position(upstream, source, selected, false)
        // Each subrequest verifies the session and identity, then immediately
        // releases its extra decoder. The response owns the ordered transform.
        await this.#dispose(source)
        source = null
        reader = upstream.body.getReader()
        block.bytes = Buffer.alloc(Number(selected.end - selected.start + 1n))
        let filled = 0
        while (filled < block.bytes.length) {
          const part = await timedWait(reader.read(), child.controller, this.#timeout)
          if (part.done || !(part.value instanceof Uint8Array)) throw failure('TRUNCATED')
          if (part.value.length > block.bytes.length - filled) throw failure('UPSTREAM_LENGTH')
          block.bytes.set(part.value, filled)
          filled += part.value.length
        }
        await this.#endOfRange(reader, child.controller)
      } finally {
        child.controller.abort()
        child.cleanup()
        await this.#dispose(source)
        if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}) } catch {} }
        else cancelBody(upstream)
      }
    })().catch((error) => { controller.abort(); throw error })
    block.done.catch(() => {}) // A later block may fail before ordered consumption.
    return block
  }

  async #parallel(response, lease, source, selected, controller, reader, cipher, releaseFirst) {
    const blocks = new Set()
    const queue = []
    const firstEnd = selected.start + BigInt(RANGE_BLOCK_BYTES) - 1n
    let next = firstEnd + 1n
    let complete = false
    const schedule = () => {
      if (next > selected.end) return
      const end = next + BigInt(RANGE_BLOCK_BYTES) - 1n
      const block = this.#bufferBlock(lease, { start: next, end: end < selected.end ? end : selected.end }, controller)
      next = block.selected.end + 1n
      blocks.add(block)
      queue.push(block)
    }
    const discard = (block) => {
      block.bytes?.fill(0)
      block.bytes = null
      block.release?.()
      blocks.delete(block)
    }
    try {
      for (let index = 1; index < RANGE_WINDOW; index += 1) schedule()
      let position = selected.start
      while (position <= firstEnd) {
        const part = await timedWait(reader.read(), controller, this.#timeout)
        if (part.done || !(part.value instanceof Uint8Array)) throw failure('TRUNCATED')
        if (BigInt(part.value.length) > firstEnd - position + 1n) throw failure('UPSTREAM_LENGTH')
        await this.#write(response, source, cipher, part.value, position, controller.signal)
        position += BigInt(part.value.length)
      }
      await this.#endOfRange(reader, controller)
      releaseFirst()
      schedule()
      while (queue.length) {
        const block = queue.shift()
        await block.done
        await this.#write(response, source, cipher, block.bytes, block.selected.start, controller.signal)
        discard(block)
        schedule()
      }
      complete = true
    } finally {
      if (!complete) controller.abort()
      await Promise.allSettled([...blocks].map((block) => block.done))
      for (const block of blocks) discard(block)
      releaseFirst()
    }
  }

  async #serve(request, response, lease, selected, controller) {
    const { signal } = controller
    let source
    let upstream
    let reader
    let cipher
    let releaseFirst
    try {
      const count = selected.end - selected.start + 1n
      const parallel = request.method === 'GET' && count >= PARALLEL_MIN_BYTES
      if (parallel) releaseFirst = await this.#slot(signal)
      source = await this.#resolve(lease, false, controller)
      if (request.method === 'HEAD' || source.length === 0n) {
        await this.#transport(lease, source, controller)
        responseHeaders(response, source, selected)
        response.end(); return
      }
      const initial = parallel ? { start: selected.start, end: selected.start + BigInt(RANGE_BLOCK_BYTES) - 1n } : selected
      upstream = await this.#fetchRange(lease, source, initial, controller)
      let position = this.#position(upstream, source, initial)
      if (source.kind === 'mode2') {
        cipher = new WindowsMediaStream(source.key)
        source.key.fill(0)
      }
      reader = upstream.body.getReader()
      responseHeaders(response, source, selected)
      if (parallel && upstream.status === 206) {
        await this.#parallel(response, lease, source, selected, controller, reader, cipher, releaseFirst)
        response.end(); return
      }
      // A server ignoring the first bounded Range supplies the original serial
      // stream once. Never issue four requests for the whole upstream file.
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
        await this.#write(response, source, cipher, data, first, signal)
        delivered += BigInt(data.length)
      }
      response.end()
    } finally {
      try {
        cipher?.dispose()
        await this.#dispose(source)
      } finally {
        // The large 200 fallback keeps its permit through consumption/discard.
        // An unresponsive cancel promise must not retain the request or slot.
        if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}) } catch {} }
        else cancelBody(upstream)
        releaseFirst?.()
      }
    }
  }
}

export function createWindowsAudioProxy(options) {
  return new WindowsAudioProxy(options)
}
