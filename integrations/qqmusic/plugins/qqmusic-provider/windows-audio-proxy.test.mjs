import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { WindowsAudioProxy } from './lib/windows/audio-proxy.mjs'
import { WindowsMediaStream } from './lib/windows/media-stream.mjs'

const origin = 'https://official-cdn.example'
const future = Date.now() + 3600000
const plain = Buffer.from('0123456789abcdef')
const tail = Buffer.from('verified-tail')
const native = JSON.parse(readFileSync(new URL('./test/fixtures/windows-media-stream-native-v1.json', import.meta.url)))
function source(overrides = {}) {
  return { sourceId: 'public-content-sha', url: `${origin}/public-file?vkey=public-transport-value`,
    expiresAt: future, contentType: 'audio/mpeg', upstreamLength: String(plain.length + tail.length),
    decoder: { kind: 'plain', length: String(plain.length), tailBytes: String(tail.length) }, ...overrides }
}
function bytesResponse(bytes, status, headers) {
  return new Response(bytes, { status, headers })
}
function serving(bytes, total = bytes.length) {
  return async (_url, options) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
    const start = Number(match[1])
    const end = Number(match[2])
    return bytesResponse(bytes.subarray(start, end + 1), 206, {
      'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1)
    })
  }
}
function streamedRange(length, options, pull) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
  const start = BigInt(match[1]), end = BigInt(match[2])
  let position = start
  return new Response(new ReadableStream({
    pull(controller) {
      pull?.()
      const size = Number(end - position + 1n < 65536n ? end - position + 1n : 65536n)
      controller.enqueue(Buffer.alloc(size, 1))
      position += BigInt(size)
      if (position > end) controller.close()
    }
  }), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${length}`,
    'Content-Length': String(end - start + 1n) } })
}
async function harness(t, options = {}) {
  const proxy = new WindowsAudioProxy({ allowedOrigins: [origin], fetch: serving(Buffer.concat([plain, tail])), ...options })
  t.after(() => proxy.close())
  return proxy
}
function rawRequest(url, { method = 'GET', headers = {}, consume = true, onData } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (response) => {
      if (!consume) return resolve({ req, response })
      const chunks = []
      response.on('data', (chunk) => { chunks.push(chunk); onData?.(chunk) })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function within(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

test('loopback leases use opaque paths and expose logical bytes, GET, HEAD and byte ranges', async (t) => {
  const proxy = await harness(t)
  let resolutions = 0
  const lease = await proxy.open({ resolve: () => { resolutions += 1; return source() } })
  assert.match(lease.url, /^http:\/\/127\.0\.0\.1:\d+\/audio\/[a-f0-9]{48}$/)
  assert.equal(lease.bytes, plain.length)
  assert.equal(lease.url.includes('vkey'), false)
  const full = await rawRequest(lease.url)
  assert.equal(full.status, 200)
  assert.deepEqual(full.body, plain)
  assert.equal(full.headers['content-length'], '16')
  assert.equal(full.headers['cache-control'], 'private, no-store')
  assert.equal(full.headers['accept-ranges'], 'bytes')
  const head = await rawRequest(lease.url, { method: 'HEAD', headers: { Range: 'bytes=3-6' } })
  assert.equal(head.status, 206)
  assert.equal(head.headers['content-range'], 'bytes 3-6/16')
  assert.equal(head.body.length, 0)
  const suffix = await rawRequest(lease.url, { headers: { Range: 'bytes=-4' } })
  assert.deepEqual(suffix.body, plain.subarray(12))
  const clipped = await rawRequest(lease.url, { headers: { Range: 'bytes=13-999' } })
  assert.equal(clipped.headers['content-range'], 'bytes 13-15/16')
  assert.deepEqual(clipped.body, plain.subarray(13))
  assert.equal(resolutions, 5)
  await lease.release()
  assert.equal((await rawRequest(lease.url)).status, 404)
})

test('whole upstream 200 bodies are clipped before the caller-verified tail and can supply a range', async (t) => {
  const payload = Buffer.concat([plain, tail])
  const proxy = await harness(t, { fetch: () => bytesResponse(payload, 200, { 'Content-Length': String(payload.length) }) })
  const lease = await proxy.open({ resolve: source })
  const result = await rawRequest(lease.url, { headers: { Range: 'bytes=9-' } })
  assert.deepEqual(result.body, plain.subarray(9))
  assert.equal(result.headers['content-length'], '7')
  assert.equal(result.headers['content-range'], 'bytes 9-15/16')
})

test('invalid range, unknown path, wrong Host and methods never reach the upstream', async (t) => {
  let calls = 0
  const proxy = await harness(t, { fetch: () => { calls += 1; throw Error('unexpected fetch') } })
  const lease = await proxy.open({ resolve: source })
  for (const value of ['bytes=16-', 'bytes=8-4', 'bytes=-0', 'bytes=1-2,4-5', 'bytes=18446744073709551616-']) {
    const response = await rawRequest(lease.url, { headers: { Range: value } })
    assert.equal(response.status, 416)
    assert.equal(response.headers['content-range'], 'bytes */16')
  }
  assert.equal((await rawRequest(lease.url + '?credential=x')).status, 404)
  assert.equal((await rawRequest(lease.url, { headers: { Host: 'example.test' } })).status, 403)
  assert.equal((await rawRequest(lease.url, { method: 'POST' })).status, 405)
  assert.equal(calls, 0)
})

test('mode2 Range uses exact uint64 offsets and original native oracle bytes, with owned keys wiped', async (t) => {
  const vector = native.vectors.find((value) => value.case_id === 7)
  const start = BigInt(vector.offset_unsigned_decimal)
  const count = 8
  const encrypted = Buffer.from(vector.input_hex, 'hex').subarray(0, count)
  const expected = Buffer.from(vector.output_hex, 'hex').subarray(0, count)
  const keys = []
  const total = 18446744073709551615n
  const logical = total - 3n
  const proxy = await harness(t, { fetch: (_url, options) => {
    assert.equal(options.headers.Range, `bytes=${start}-${start + 7n}`)
    return bytesResponse(encrypted, 206, { 'Content-Range': `bytes ${start}-${start + 7n}/${total}`, 'Content-Length': '8' })
  } })
  const lease = await proxy.open({ resolve: () => {
    const key = Buffer.from(vector.key_hex, 'hex'); keys.push(key)
    return source({ upstreamLength: total.toString(), decoder: { kind: 'mode2', key,
      length: logical.toString(), tailBytes: '3' } })
  } })
  assert.equal(Object.hasOwn(lease, 'bytes'), false)
  const result = await rawRequest(lease.url, { headers: { Range: `bytes=${start}-${start + 7n}` } })
  assert.equal(result.status, 206)
  assert.equal(result.headers['content-range'], `bytes ${start}-${start + 7n}/${logical}`)
  assert.deepEqual(result.body, expected)
  assert.equal(keys.length, 2)
  assert.ok(keys.every((key) => key.every((byte) => byte === 0)))
})

test('mode1 owners are per-resolution, disposed for open, HEAD and completed GET', async (t) => {
  let disposed = 0
  const offsets = []
  const proxy = await harness(t)
  const lease = await proxy.open({ resolve: () => source({ decoder: {
    kind: 'mode1', length: '16', tailBytes: String(tail.length),
    transform(bytes, offset) { offsets.push(offset); return bytes },
    dispose() { disposed += 1 }
  } }) })
  assert.equal(disposed, 1)
  await rawRequest(lease.url, { method: 'HEAD' })
  await rawRequest(lease.url, { headers: { Range: 'bytes=3-6' } })
  assert.equal(disposed, 3)
  assert.deepEqual(offsets, ['3'])
})

test('expiry and denied upstream refresh the same lease without changing its content identity', async (t) => {
  let time = 1000
  let refreshed = 0
  let version = 'old'
  let fetches = 0
  const proxy = await harness(t, { now: () => time, fetch: (url, options) => {
    fetches += 1
    if (url.includes('/old')) return bytesResponse('', 403, {})
    return serving(Buffer.concat([plain, tail]))(url, options)
  } })
  const lease = await proxy.open({ resolve: ({ refresh }) => {
    if (refresh) { refreshed += 1; version = 'new' }
    return source({ url: `${origin}/${version}`, expiresAt: version === 'old' ? 2000 : 5000 })
  } })
  assert.deepEqual((await rawRequest(lease.url)).body, plain)
  assert.equal(refreshed, 1)
  assert.equal(fetches, 2)
  time = 6000
  const failed = await rawRequest(lease.url)
  assert.equal(failed.status, 502)
  assert.equal(failed.body.toString(), 'QQ audio stream failed')
  assert.equal(refreshed, 2)
})

test('refresh cannot switch sourceId, key, dimensions or content type', async (t) => {
  for (const change of [
    { sourceId: 'different-content' }, { contentType: 'audio/flac' },
    { upstreamLength: '30', decoder: { kind: 'plain', length: '17', tailBytes: '13' } }
  ]) {
    const proxy = await harness(t, { fetch: () => bytesResponse('', 401, {}) })
    const lease = await proxy.open({ resolve: ({ refresh }) => source(refresh ? change : {}) })
    assert.equal((await rawRequest(lease.url)).status, 502)
  }
  let index = 0
  const keys = []
  const proxy = await harness(t, { fetch: () => bytesResponse('', 410, {}) })
  const lease = await proxy.open({ resolve: ({ refresh }) => {
    const key = Buffer.alloc(16, refresh ? 2 : 1); keys.push(key); index += 1
    return source({ decoder: { kind: 'mode2', key, length: '16', tailBytes: String(tail.length) } })
  } })
  assert.equal((await rawRequest(lease.url)).status, 502)
  assert.equal(index, 3)
  assert.ok(keys.every((key) => key.every((byte) => byte === 0)))
})

test('every redirect hop obeys the exact HTTPS origin allowlist and strips cross-origin credentials', async (t) => {
  for (const target of ['http://official-cdn.example/file', 'https://elsewhere.example/file',
    'https://user:pass@official-cdn.example/file', 'https://official-cdn.example:444/file', 'file:///C:/file']) {
    let calls = 0
    const proxy = await harness(t, { fetch: () => { calls += 1; return bytesResponse('', 302, { Location: target }) } })
    const lease = await proxy.open({ resolve: source })
    assert.equal((await rawRequest(lease.url)).status, 502)
    assert.equal(calls, 1)
  }
  const second = 'https://second-official.example'
  let hops = 0
  const proxy = await harness(t, { allowedOrigins: [origin, second], fetch: (url, options) => {
    hops += 1
    if (hops === 1) return bytesResponse('', 302, { Location: `${second}/next` })
    assert.equal(url, `${second}/next`)
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false)
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false)
    return serving(Buffer.concat([plain, tail]))(url, options)
  } })
  const lease = await proxy.open({ resolve: () => source({ headers: { Authorization: 'public-header', Cookie: 'public-cookie' } }) })
  assert.deepEqual((await rawRequest(lease.url)).body, plain)
  assert.equal(hops, 2)
})

test('inconsistent boundaries, headers, compressed and truncated upstreams fail without publishing wrong lengths', async (t) => {
  const invalid = await harness(t)
  await assert.rejects(invalid.open({ resolve: () => source({ upstreamLength: '999' }) }))
  for (const response of [
    () => bytesResponse(plain, 206, { 'Content-Range': 'bytes 0-15/999' }),
    () => bytesResponse(plain, 206, { 'Content-Range': `bytes 0-15/${plain.length + tail.length}`, 'Content-Length': '17' }),
    () => bytesResponse(plain, 200, { 'Content-Length': '999' }),
    () => bytesResponse(plain, 206, { 'Content-Range': `bytes 0-15/${plain.length + tail.length}`, 'Content-Encoding': 'gzip' })
  ]) {
    const proxy = await harness(t, { fetch: response })
    const lease = await proxy.open({ resolve: source })
    assert.equal((await rawRequest(lease.url)).status, 502)
  }
  const proxy = await harness(t, { fetch: () => bytesResponse(plain.subarray(0, 5), 206,
    { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` }) })
  const lease = await proxy.open({ resolve: source })
  await assert.rejects(rawRequest(lease.url))
})

test('revokeAll aborts active readers, disposes request owners and leaves released paths unauthorized', async (t) => {
  const reading = deferred()
  let canceled = 0
  let disposed = 0
  const proxy = await harness(t, { fetch: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('first')) },
    cancel() { canceled += 1 }
  }), { status: 206, headers: { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` } }) })
  const lease = await proxy.open({ resolve: () => source({ decoder: { kind: 'mode1', length: '16',
    tailBytes: String(tail.length), transform: (bytes) => bytes, dispose() { disposed += 1 } } }) })
  const pending = rawRequest(lease.url, { onData: () => reading.resolve() })
  pending.catch(() => {})
  await reading.promise
  await proxy.revokeAll()
  await assert.rejects(pending)
  assert.equal(disposed, 2)
  assert.equal(canceled, 1)
  assert.equal((await rawRequest(lease.url)).status, 404)
})

test('late resolution after cancellation releases transferred owners without creating a usable lease', async (t) => {
  const pending = deferred()
  let disposed = 0
  const proxy = await harness(t)
  const controller = new AbortController()
  const opening = proxy.open({ signal: controller.signal, resolve: () => pending.promise })
  controller.abort()
  await assert.rejects(opening, { name: 'AbortError' })
  pending.resolve(source({ decoder: { kind: 'mode1', length: '16', tailBytes: String(tail.length),
    transform: (bytes) => bytes, dispose() { disposed += 1 } } }))
  await new Promise((done) => setImmediate(done))
  assert.equal(disposed, 1)
})

test('simultaneous denied requests coalesce refresh while retaining independent decoder owners', async (t) => {
  const denied = deferred()
  const refreshGate = deferred()
  let oldCalls = 0
  let refreshed = 0
  let current = 'old'
  let disposed = 0
  const proxy = await harness(t, { fetch: (url, options) => {
    if (url.endsWith('/old')) {
      oldCalls += 1
      if (oldCalls === 2) denied.resolve()
      return bytesResponse('', 403, {})
    }
    return serving(Buffer.concat([plain, tail]))(url, options)
  } })
  const lease = await proxy.open({ resolve: async ({ refresh }) => {
    if (refresh) { refreshed += 1; await refreshGate.promise; current = 'new' }
    return source({ url: `${origin}/${current}`, decoder: { kind: 'mode1', length: '16',
      tailBytes: String(tail.length), transform: (bytes) => bytes, dispose() { disposed += 1 } } })
  } })
  const first = rawRequest(lease.url)
  const second = rawRequest(lease.url)
  await denied.promise
  refreshGate.resolve()
  const results = await Promise.all([first, second])
  assert.ok(results.every((value) => value.body.equals(plain)))
  assert.equal(refreshed, 1)
  assert.equal(disposed, 4)
})

test('unresponsive fetches time out and a late response is canceled without reviving the request', async (t) => {
  const upstream = deferred()
  let disposed = 0
  let canceled = 0
  const proxy = await harness(t, { requestTimeoutMs: 30, fetch: () => upstream.promise })
  const lease = await proxy.open({ resolve: () => source({ decoder: { kind: 'mode1', length: '16',
    tailBytes: String(tail.length), transform: (bytes) => bytes, dispose() { disposed += 1 } } }) })
  const response = await rawRequest(lease.url)
  assert.equal(response.status, 502)
  assert.equal(disposed, 2)
  upstream.resolve(new Response(new ReadableStream({ cancel() { canceled += 1 } }),
    { status: 206, headers: { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` } }))
  await new Promise((done) => setImmediate(done))
  assert.equal(canceled, 1)
})

test('reader cancellation cannot block revocation or retain its owner', async (t) => {
  const received = deferred()
  let disposed = 0
  const proxy = await harness(t, { fetch: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from('first')) },
    cancel() { return new Promise(() => {}) }
  }), { status: 206, headers: { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` } }) })
  const lease = await proxy.open({ resolve: () => source({ decoder: { kind: 'mode1', length: '16',
    tailBytes: String(tail.length), transform: (bytes) => bytes, dispose() { disposed += 1 } } }) })
  const pending = rawRequest(lease.url, { onData: () => received.resolve() })
  pending.catch(() => {})
  await received.promise
  await proxy.revokeAll()
  await assert.rejects(pending)
  assert.equal(disposed, 2)
})

test('a paused downstream stops upstream pulling and disconnection releases its request owner', async (t) => {
  const chunkBytes = 65536
  const chunks = 256
  let pulled = 0
  let disposed = 0
  let owners = 0
  let requestDisposed = false
  const length = String(chunkBytes * chunks)
  const proxy = await harness(t, { fetch: (_url, options) => streamedRange(length, options, () => { pulled += 1 }) })
  const lease = await proxy.open({ resolve: () => {
    const owner = ++owners
    return source({ upstreamLength: length,
    decoder: { kind: 'mode1', length, tailBytes: '0', transform: (bytes) => bytes,
      dispose() { disposed += 1; if (owner === 2) requestDisposed = true } } })
  } })
  const { req, response } = await rawRequest(lease.url, { consume: false })
  assert.equal(response.statusCode, 200)
  response.on('error', () => {})
  response.pause()
  await new Promise((done) => setTimeout(done, 30))
  assert.ok(pulled < chunks, `pulled ${pulled} chunks while client paused`)
  response.destroy()
  req.destroy()
  await lease.release()
  assert.equal(requestDisposed, true)
  assert.equal(disposed, owners)
})

test('lease expiry, external abort and close revoke opaque addresses and reject new opens', async (t) => {
  let time = 1000
  const proxy = await harness(t, { now: () => time, leaseTtlMs: 10000 })
  const expired = await proxy.open({ resolve: source })
  time = 12000
  assert.equal((await rawRequest(expired.url)).status, 410)
  const controller = new AbortController()
  const fresh = await proxy.open({ resolve: source, signal: controller.signal })
  assert.notEqual(fresh.url, expired.url)
  controller.abort()
  await fresh.release()
  assert.equal((await rawRequest(fresh.url)).status, 404)
  await proxy.close()
  await assert.rejects(proxy.open({ resolve: source }), { code: 'CLOSED' })
})

test('asynchronous reader errors destroy the published stream and release its decoder', async (t) => {
  let streamController
  let disposed = 0
  const proxy = await harness(t, { fetch: () => new Response(new ReadableStream({
    start(controller) { streamController = controller; controller.enqueue(Buffer.from('first')) }
  }), { status: 206, headers: { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` } }) })
  const lease = await proxy.open({ resolve: () => source({ decoder: { kind: 'mode1', length: '16',
    tailBytes: String(tail.length), transform: (bytes) => bytes, dispose() { disposed += 1 } } }) })
  await assert.rejects(rawRequest(lease.url, { onData() { streamController.error(Error('public-upstream-failure')) } }))
  assert.equal(disposed, 2)
})

test('a second denied upstream is terminal and cannot create an unbounded refresh loop', async (t) => {
  let refreshed = 0
  let fetches = 0
  const proxy = await harness(t, { fetch: () => { fetches += 1; return bytesResponse('', 403, {}) } })
  const lease = await proxy.open({ resolve: ({ refresh }) => { if (refresh) refreshed += 1; return source() } })
  assert.equal((await rawRequest(lease.url)).status, 502)
  assert.equal(refreshed, 1)
  assert.equal(fetches, 2)
})

test('timely upstream chunks can stream beyond the per-wait timeout without aborting at headers', async (t) => {
  const chunks = 8
  let sent = 0
  let complete = false
  let abortedBeforeCompletion = false
  const proxy = await harness(t, { requestTimeoutMs: 100, fetch: (_url, { signal }) => {
    signal.addEventListener('abort', () => { if (!complete) abortedBeforeCompletion = true })
    return new Response(new ReadableStream({
      async pull(controller) {
        await new Promise((done) => setTimeout(done, 30))
        if (signal.aborted) return
        sent += 1
        controller.enqueue(Buffer.from([sent]))
        if (sent === chunks) { complete = true; controller.close() }
      }
    }), { status: 206, headers: { 'Content-Range': `bytes 0-${chunks - 1}/${chunks}` } })
  } })
  const lease = await proxy.open({ resolve: () => source({ upstreamLength: String(chunks),
    decoder: { kind: 'plain', length: String(chunks), tailBytes: '0' } }) })
  const response = await rawRequest(lease.url)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))
  assert.equal(abortedBeforeCompletion, false)
})

test('downstream pause across the upstream-wait timeout can resume and finish the same connection', async (t) => {
  const chunks = 256
  const chunkBytes = 65536
  const length = String(chunks * chunkBytes)
  let pulled = 0
  let disposed = 0
  let owners = 0
  let disposedRequest = false
  const requestDisposed = deferred()
  const proxy = await harness(t, { requestTimeoutMs: 50,
    fetch: (_url, options) => streamedRange(length, options, () => { pulled += 1 }) })
  const lease = await proxy.open({ resolve: () => {
    const owner = ++owners
    return source({ upstreamLength: length,
    decoder: { kind: 'mode1', length, tailBytes: '0', transform: (bytes) => bytes,
      dispose() { disposed += 1; if (owner === 2) { disposedRequest = true; requestDisposed.resolve() } } } })
  } })
  const { req, response } = await rawRequest(lease.url, { consume: false })
  t.after(() => { response.destroy(); req.destroy() })
  let received = 0
  const finished = new Promise((resolve, reject) => {
    response.on('data', (bytes) => { received += bytes.length })
    response.once('end', resolve)
    response.once('error', reject)
  })
  finished.catch(() => {})
  response.pause()
  await new Promise((done) => setTimeout(done, 160))
  assert.ok(pulled < chunks, `pulled ${pulled} chunks while paused`)
  assert.equal(disposedRequest, false, 'request owner must remain active while only downstream is paused')
  response.resume()
  await finished
  assert.equal(received, Number(length))
  // Client 'end' can arrive before the server finishes its owner's finally block.
  await within(requestDisposed.promise, 1000, 'completed request must dispose its decoder owner')
  assert.equal(disposed, owners)
})

test('a stalled upstream reader still times out, aborts its fetch and clears owned media keys', async (t) => {
  const keys = []
  let abortedFetch = false
  let canceled = 0
  const proxy = await harness(t, { requestTimeoutMs: 40, fetch: (_url, { signal }) => {
    signal.addEventListener('abort', () => { abortedFetch = true })
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.alloc(5)) },
      cancel() { canceled += 1 }
    }), { status: 206, headers: { 'Content-Range': `bytes 0-15/${plain.length + tail.length}` } })
  } })
  const lease = await proxy.open({ resolve: () => {
    const key = Buffer.alloc(16, 1); keys.push(key)
    return source({ decoder: { kind: 'mode2', length: '16', tailBytes: String(tail.length), key } })
  } })
  await assert.rejects(rawRequest(lease.url))
  assert.equal(abortedFetch, true)
  assert.equal(canceled, 1)
  assert.equal(keys.length, 2)
  assert.ok(keys.every((key) => key.every((byte) => byte === 0)))
})

const blockBytes = 512 * 1024
function largeSource(length, overrides = {}) {
  return source({ upstreamLength: String(length), decoder: { kind: 'plain', length: String(length), tailBytes: '0' }, ...overrides })
}
function requested(options) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range)
  return { start: BigInt(match[1]), end: BigInt(match[2]) }
}
function partial(bytes, selected, total) {
  return bytesResponse(bytes, 206, { 'Content-Range': `bytes ${selected.start}-${selected.end}/${total}`,
    'Content-Length': String(selected.end - selected.start + 1n) })
}
async function terminal(promise) {
  try { assert.equal((await promise).status, 502) }
  catch (error) { if (error.code === 'ERR_ASSERTION') throw error }
}

test('large Range streams its first bytes before buffering the first block and orders completed later blocks', async (t) => {
  const bytes = Buffer.alloc(blockBytes * 7 + 197)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 19 + 7) & 255
  const firstTail = deferred(), secondBlock = deferred(), firstByte = deferred(), laterReady = deferred()
  const ranges = [], completions = []
  let received = 0
  const proxy = await harness(t, { fetch: async (_url, options) => {
    const selected = requested(options)
    ranges.push(selected)
    if (selected.start === 0n) {
      let sent = false
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(bytes.subarray(0, 1024)) },
        async pull(controller) {
          if (sent) return
          sent = true
          await firstTail.promise
          if (options.signal.aborted) return
          controller.enqueue(bytes.subarray(1024, blockBytes)); controller.close()
        }
      }), { status: 206, headers: { 'Content-Range': `bytes 0-${blockBytes - 1}/${bytes.length}`,
        'Content-Length': String(blockBytes) } })
    }
    if (selected.start === BigInt(blockBytes)) await secondBlock.promise
    completions.push(selected.start)
    if (completions.includes(2n * BigInt(blockBytes)) && completions.includes(3n * BigInt(blockBytes))) laterReady.resolve()
    return partial(bytes.subarray(Number(selected.start), Number(selected.end + 1n)), selected, bytes.length)
  } })
  const lease = await proxy.open({ resolve: () => largeSource(bytes.length) })
  const pending = rawRequest(lease.url, { onData(chunk) { received += chunk.length; firstByte.resolve() } })
  pending.catch(() => {})
  await within(Promise.all([firstByte.promise, laterReady.promise]), 1000, 'first bytes and later blocks must not wait on block completion')
  assert.equal(received, 1024)
  assert.equal(ranges.length, 4)
  assert.equal(completions.includes(BigInt(blockBytes)), false)
  firstTail.resolve(); secondBlock.resolve()
  const result = await pending
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, bytes)
  assert.deepEqual(ranges.map(value => value.start), Array.from({ length: 8 }, (_, index) => BigInt(index * blockBytes)))
  assert.equal(ranges.at(-1).end, BigInt(bytes.length - 1))
})

test('large ignored Range uses exactly one whole upstream stream and clips logical tail', async (t) => {
  const bytes = Buffer.alloc(5 * blockBytes + 51, 37)
  const footer = Buffer.alloc(23, 91)
  let calls = 0
  const proxy = await harness(t, { fetch: (_url, options) => {
    calls += 1
    assert.equal(options.headers.Range, `bytes=103-${103 + blockBytes - 1}`)
    return bytesResponse(Buffer.concat([bytes, footer]), 200, { 'Content-Length': String(bytes.length + footer.length) })
  } })
  const lease = await proxy.open({ resolve: () => largeSource(bytes.length + footer.length,
    { decoder: { kind: 'plain', length: String(bytes.length), tailBytes: String(footer.length) } }) })
  const result = await rawRequest(lease.url, { headers: { Range: 'bytes=103-' } })
  assert.equal(result.status, 206)
  assert.deepEqual(result.body, bytes.subarray(103))
  assert.equal(calls, 1)
})

test('HEAD and ranges below two MiB retain the single upstream path', async (t) => {
  const bytes = Buffer.alloc(blockBytes * 6, 17)
  const ranges = []
  const proxy = await harness(t, { fetch: (_url, options) => {
    ranges.push(options.headers.Range)
    return serving(bytes)(_url, options)
  } })
  const lease = await proxy.open({ resolve: () => largeSource(bytes.length) })
  assert.equal((await rawRequest(lease.url, { method: 'HEAD' })).status, 200)
  assert.equal(ranges.length, 0)
  const end = blockBytes * 4 - 2
  assert.equal((await rawRequest(lease.url, { headers: { Range: `bytes=0-${end}` } })).body.length, end + 1)
  assert.deepEqual(ranges, [`bytes=0-${end}`])
})

test('parallel plain, mode1 and both mode2 sizes preserve exact uint64 offsets and dispose owned decoders', async (t) => {
  const v2 = JSON.parse(readFileSync(new URL('./test/fixtures/windows-media-stream-native-v2.json', import.meta.url))).vectors[0]
  const small = native.vectors.find(value => value.key_length === 256)
  for (const [kind, vector] of [['plain'], ['mode1'], ['mode2', small], ['mode2', v2]]) {
    const count = 4 * blockBytes + 73
    const total = 0xffffffffffffffffn
    const start = total - 4n * 1024n * 1024n + 19n
    const expected = Buffer.alloc(count)
    for (let index = 0; index < count; index += 1) expected[index] = (index * 13 + 41) & 255
    const key = vector && Buffer.from(vector.key_hex, 'hex')
    let encrypted = Buffer.from(expected)
    if (kind === 'mode2') {
      const cipher = new WindowsMediaStream(key)
      encrypted = cipher.transform(encrypted, String(start)); cipher.dispose()
    } else if (kind === 'mode1') {
      for (let index = 0; index < encrypted.length; index += 1) encrypted[index] ^= Number((start + BigInt(index)) & 255n)
    }
    const keys = [], transformed = []
    let owners = 0, disposed = 0
    const proxy = await harness(t, { fetch: (_url, options) => {
      const selected = requested(options)
      return partial(encrypted.subarray(Number(selected.start - start), Number(selected.end - start + 1n)), selected, total)
    } })
    const lease = await proxy.open({ resolve: () => {
      owners += 1
      let decoder = { kind, length: String(total - 17n), tailBytes: '17' }
      if (kind === 'mode2') { decoder.key = Buffer.from(key); keys.push(decoder.key) }
      if (kind === 'mode1') decoder = { ...decoder, transform(bytes, offset) {
        assert.ok(bytes.length <= 65536)
        transformed.push(BigInt(offset))
        for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= Number((BigInt(offset) + BigInt(index)) & 255n)
        return bytes
      }, dispose() { disposed += 1 } }
      return largeSource(total, { decoder })
    } })
    assert.equal(Object.hasOwn(lease, 'bytes'), false)
    const result = await rawRequest(lease.url, { headers: { Range: `bytes=${start}-${start + BigInt(count) - 1n}` } })
    assert.equal(result.headers['content-range'], `bytes ${start}-${start + BigInt(count) - 1n}/${total - 17n}`)
    assert.deepEqual(result.body, expected)
    await lease.release()
    assert.equal(owners, 6)
    assert.ok(keys.every(value => value.every(byte => byte === 0)))
    if (kind === 'mode1') {
      assert.equal(disposed, owners)
      assert.equal(transformed[0], start)
      assert.ok(transformed.every((value, index) => index === 0 || value > transformed[index - 1]))
    }
  }
})

test('completed unread blocks retain a global sixteen-MiB budget across leases and queued seeks cancel cleanly', async (t) => {
  const length = 8 * 1024 * 1024
  const eight = deferred(), twelve = deferred()
  const calls = [], resolutions = new Map(), connections = []
  let cancels = 0
  const proxy = await harness(t, { fetch: (url, options) => {
    calls.push(url)
    if (calls.length === 32) eight.resolve()
    if (calls.length === 48) twelve.resolve()
    const selected = requested(options)
    if (selected.start > 0n) return partial(Buffer.alloc(blockBytes, 1), selected, length)
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from([1])) },
      cancel() { cancels += 1; return new Promise(() => {}) }
    }), { status: 206, headers: { 'Content-Range': `bytes 0-${blockBytes - 1}/${length}`, 'Content-Length': String(blockBytes) } })
  } })
  async function open(label) {
    return proxy.open({ durationSeconds: 1, resolve: () => {
      resolutions.set(label, (resolutions.get(label) ?? 0) + 1)
      return largeSource(length, { sourceId: label, url: `${origin}/${label}` })
    } })
  }
  function begin(lease) {
    const pending = rawRequest(lease.url, { consume: false }).then(value => {
      value.response.on('error', () => {}); connections.push(value); return value
    })
    pending.catch(() => {})
    return pending
  }
  t.after(() => { for (const { req, response } of connections) { response.destroy(); req.destroy() } })
  const a = await open('a'), b = await open('b'), c = await open('c'), d = await open('d')
  const pa = begin(a), pb = begin(b)
  await within(eight.promise, 1000, 'two windows must reserve exactly thirty-two memory slots')
  await Promise.all([pa, pb])
  const pc = begin(c)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls.length, 32, 'finished future blocks must hold memory while their head is unconsumed')
  assert.equal(resolutions.get('c'), 1, 'a queued seek must not acquire a decoder owner before a slot')
  await c.release()
  assert.equal((await pc).response.statusCode, 502)
  const pd = begin(d)
  await a.release()
  assert.equal((await pd).response.statusCode, 200)
  await within(twelve.promise, 1000, 'canceled queue entries and discarded blocks must return all slots')
  assert.equal(calls.filter(url => url.endsWith('/c')).length, 0)
  await b.release(); await d.release()
  assert.equal(cancels, 3)
})

test('any invalid future lane cancels the response and returns its slots without whole-file fallback', async (t) => {
  const length = 4 * blockBytes
  for (const invalid of ['range', 'length', 'encoding', 'whole', 'truncated', 'oversized', 'reader-error', 'stall']) {
    let valid = false, calls = 0, abortedFetches = 0
    const proxy = await harness(t, { requestTimeoutMs: 80, fetch: (_url, options) => {
      calls += 1
      options.signal.addEventListener('abort', () => { abortedFetches += 1 }, { once: true })
      const selected = requested(options)
      if (valid || selected.start !== BigInt(blockBytes)) return partial(Buffer.alloc(blockBytes, 7), selected, length)
      const headers = { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`, 'Content-Length': String(blockBytes) }
      if (invalid === 'range') headers['Content-Range'] = `bytes ${selected.start + 1n}-${selected.end}/${length}`
      if (invalid === 'length') headers['Content-Length'] = String(blockBytes - 1)
      if (invalid === 'encoding') headers['Content-Encoding'] = 'gzip'
      if (invalid === 'whole') return bytesResponse(Buffer.alloc(length), 200, { 'Content-Length': String(length) })
      if (invalid === 'truncated') return bytesResponse(Buffer.alloc(17), 206, headers)
      if (invalid === 'oversized') return bytesResponse(Buffer.alloc(blockBytes + 1), 206, headers)
      if (invalid === 'reader-error') return new Response(new ReadableStream({ start(controller) { controller.error(Error('public-lane-error')) } }), { status: 206, headers })
      if (invalid === 'stall') return new Response(new ReadableStream({ cancel() { return new Promise(() => {}) } }), { status: 206, headers })
      return bytesResponse(Buffer.alloc(blockBytes), 206, headers)
    } })
    const lease = await proxy.open({ resolve: () => largeSource(length) })
    await terminal(rawRequest(lease.url))
    const before = calls
    valid = true
    const result = await within(rawRequest(lease.url), 1000, `slots leaked after ${invalid}`)
    assert.equal(result.body.length, length)
    assert.equal(calls - before, 4)
    await lease.release()
    assert.ok(abortedFetches >= before)
  }
})

test('parallel denied lanes coalesce a single refresh and cannot replace content identity', async (t) => {
  const length = 4 * blockBytes
  for (const changeIdentity of [false, true]) {
    const allDenied = deferred(), refreshGate = deferred()
    let denied = 0, refreshes = 0, current = 'old'
    const keys = []
    const key = Buffer.alloc(512, 31)
    const cipher = new WindowsMediaStream(key)
    const expected = Buffer.alloc(length, 23)
    const encrypted = cipher.transform(Buffer.from(expected), '0'); cipher.dispose()
    const proxy = await harness(t, { fetch: (url, options) => {
      const selected = requested(options)
      if (url.endsWith('/old') && selected.start > 0n) {
        denied += 1; if (denied === 3) allDenied.resolve()
        return bytesResponse('', 403, {})
      }
      return partial(encrypted.subarray(Number(selected.start), Number(selected.end + 1n)), selected, length)
    } })
    const lease = await proxy.open({ resolve: async ({ refresh }) => {
      if (refresh) { refreshes += 1; await refreshGate.promise; current = 'new' }
      const owned = Buffer.from(key); keys.push(owned)
      return largeSource(length, { url: `${origin}/${current}`, sourceId: changeIdentity && refresh ? 'other-recording' : 'public-content-sha',
        decoder: { kind: 'mode2', key: owned, length: String(length), tailBytes: '0' } })
    } })
    const pending = rawRequest(lease.url)
    pending.catch(() => {})
    await within(allDenied.promise, 1000, 'all future lanes must reach the same bounded refresh')
    refreshGate.resolve()
    if (changeIdentity) await terminal(pending)
    else assert.deepEqual((await pending).body, expected)
    await lease.release()
    assert.equal(refreshes, 1)
    assert.ok(keys.every(value => value.every(byte => byte === 0)))
  }
})

test('overlapping encrypted seeks own independent windows and cancellation cannot affect the surviving response', async (t) => {
  const length = blockBytes * 10
  const expected = Buffer.alloc(length)
  for (let index = 0; index < length; index += 1) expected[index] = (index * 3 + 17) & 255
  const vector = native.vectors.find(value => value.key_length === 256)
  const key = Buffer.from(vector.key_hex, 'hex')
  const cipher = new WindowsMediaStream(key)
  const encrypted = cipher.transform(Buffer.from(expected), '0'); cipher.dispose()
  const keys = []
  const proxy = await harness(t, { fetch: async (_url, options) => {
    const selected = requested(options)
    await new Promise(resolve => setTimeout(resolve, Number(selected.start / BigInt(blockBytes) % 3n) * 3))
    return partial(encrypted.subarray(Number(selected.start), Number(selected.end + 1n)), selected, length)
  } })
  const lease = await proxy.open({ durationSeconds: 1, resolve: () => {
    const owned = Buffer.from(key); keys.push(owned)
    return largeSource(length, { decoder: { kind: 'mode2', key: owned, length: String(length), tailBytes: '0' } })
  } })
  const first = await rawRequest(lease.url, { consume: false })
  first.response.on('error', () => {})
  first.response.pause()
  const start = blockBytes + 37, end = start + 4 * blockBytes + 79
  const second = rawRequest(lease.url, { headers: { Range: `bytes=${start}-${end}` } })
  first.response.destroy(); first.req.destroy()
  assert.deepEqual((await within(second, 1500, 'a canceled overlapping response retained global slots')).body, expected.subarray(start, end + 1))
  await lease.release()
  assert.ok(keys.every(value => value.every(byte => byte === 0)))
})

test('session rejection during future resolution aborts the window before any unauthorized subrequest', async (t) => {
  const length = 4 * blockBytes
  const checking = deferred(), confirmation = deferred()
  let calls = 0, waiting = 0, fetched = 0, authorized = true, disposed = 0
  const proxy = await harness(t, { fetch: (_url, options) => {
    fetched += 1
    return partial(Buffer.alloc(blockBytes, 1), requested(options), length)
  } })
  const lease = await proxy.open({ resolve: async ({ signal }) => {
    calls += 1
    if (calls > 2) {
      waiting += 1; if (waiting === 3) checking.resolve()
      await confirmation.promise
      if (!authorized || signal.aborted) throw Error('Public session changed')
    }
    return largeSource(length, { decoder: { kind: 'mode1', length: String(length), tailBytes: '0',
      transform: bytes => bytes, dispose() { disposed += 1 } } })
  } })
  const pending = rawRequest(lease.url)
  pending.catch(() => {})
  await within(checking.promise, 1000, 'all speculative requests must validate their session')
  authorized = false; confirmation.resolve()
  await terminal(pending)
  await lease.release()
  assert.equal(fetched, 1)
  assert.equal(disposed, 2)
})

test('cancelled future fetches clear keys promptly, discard late bodies and release their global slots', async (t) => {
  const length = 4 * blockBytes
  const vector = native.vectors.find(value => value.key_length === 256)
  const key = Buffer.from(vector.key_hex, 'hex')
  const cipher = new WindowsMediaStream(key)
  const expected = Buffer.alloc(length, 61)
  const encrypted = cipher.transform(Buffer.from(expected), '0'); cipher.dispose()
  const late = deferred(), fetching = deferred(), keys = []
  let stalled = true, cancelled = 0
  const proxy = await harness(t, { fetch: (_url, options) => {
    const selected = requested(options)
    if (stalled && selected.start === BigInt(blockBytes)) { fetching.resolve(); return late.promise }
    return partial(encrypted.subarray(Number(selected.start), Number(selected.end + 1n)), selected, length)
  } })
  const open = () => proxy.open({ resolve: () => {
    const owned = Buffer.from(key); keys.push(owned)
    return largeSource(length, { decoder: { kind: 'mode2', key: owned, length: String(length), tailBytes: '0' } })
  } })
  const lease = await open()
  const connection = await rawRequest(lease.url, { consume: false })
  connection.response.on('error', () => {})
  await within(fetching.promise, 1000, 'future fetch was not started')
  await within(lease.release(), 500, 'uncooperative future fetch retained its lease')
  assert.ok(keys.every(value => value.every(byte => byte === 0)))
  late.resolve(new Response(new ReadableStream({ cancel() { cancelled += 1 } }), { status: 206 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, 1)
  connection.response.destroy(); connection.req.destroy()
  stalled = false
  const next = await open()
  assert.deepEqual((await within(rawRequest(next.url), 1000, 'future cancellation leaked a budget slot')).body, expected)
  await next.release()
  assert.ok(keys.every(value => value.every(byte => byte === 0)))
})

test('chunked first and future blocks require EOF after exact bytes and reject trailing data, error or stall', async (t) => {
  const length = 4 * blockBytes
  for (const first of [false, true]) for (const kind of ['extra', 'error', 'stall']) {
    let reads = 0, valid = false
    const proxy = await harness(t, { requestTimeoutMs: 60, fetch: (_url, options) => {
      const selected = requested(options)
      if (valid || selected.start !== BigInt(first ? 0 : blockBytes)) return partial(Buffer.alloc(blockBytes, 17), selected, length)
      return new Response(new ReadableStream({
        pull(controller) {
          reads += 1
          if (reads === 1) controller.enqueue(Buffer.alloc(blockBytes, 17))
          else if (kind === 'extra') { controller.enqueue(Buffer.from([1])); controller.close() }
          else if (kind === 'error') controller.error(Error('public terminal body failure'))
        },
        cancel() { return new Promise(() => {}) }
      }, { highWaterMark: 0 }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}` } })
    } })
    const lease = await proxy.open({ resolve: () => largeSource(length) })
    await terminal(rawRequest(lease.url))
    assert.equal(reads, 2, `${first ? 'first' : 'future'} ${kind} was not checked after its declared count`)
    valid = true
    assert.equal((await within(rawRequest(lease.url), 1000, 'EOF failure retained block slots')).body.length, length)
  }
})

test('large 200 fallbacks hold the global permit through consumption or cancellation', async (t) => {
  const length = 4 * blockBytes
  const eight = deferred()
  let calls = 0, cancels = 0
  const connections = []
  const proxy = await harness(t, { fetch: () => {
    calls += 1; if (calls === 8) eight.resolve()
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from([17])) },
      cancel() { cancels += 1 }
    }), { status: 200, headers: { 'Content-Length': String(length) } })
  } })
  const lease = await proxy.open({ resolve: () => largeSource(length) })
  const get = () => rawRequest(lease.url, { consume: false }).then(value => {
    value.response.on('error', () => {}); connections.push(value); return value
  })
  t.after(() => { for (const { req, response } of connections) { response.destroy(); req.destroy() } })
  const first = Array.from({ length: 8 }, get)
  await within(Promise.all([eight.promise, ...first]), 1000, 'eight 200 streams were not started')
  const ninth = get()
  ninth.catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 8, 'an unconsumed 200 stream released its permit')
  const retired = connections[0]
  retired.response.destroy(); retired.req.destroy()
  assert.equal((await within(ninth, 1000, 'canceling a 200 did not release its slot')).response.statusCode, 200)
  assert.equal(calls, 9)
  await lease.release()
  assert.equal(cancels, 9)
})

test('staggered rejections from one old transport wave reuse its published refresh exactly once', async (t) => {
  const length = 4 * blockBytes
  const allOld = deferred()
  let denied = 0, refreshes = 0, current = 'old', fetches = 0
  const proxy = await harness(t, { fetch: async (url, options) => {
    fetches += 1
    const selected = requested(options)
    if (url.endsWith('/old') && selected.start > 0n) {
      denied += 1; if (denied === 3) allOld.resolve()
      await allOld.promise
      await new Promise(resolve => setTimeout(resolve, Number(selected.start / BigInt(blockBytes) - 1n) * 30))
      return bytesResponse('', 403, {})
    }
    return partial(Buffer.alloc(blockBytes, 37), selected, length)
  } })
  const lease = await proxy.open({ resolve: ({ refresh }) => {
    if (refresh) { refreshes += 1; current = 'new' }
    // Deliberately new objects for every resolution, including an equivalent
    // original transport. Refresh sharing cannot depend on object identity.
    return largeSource(length, { url: `${origin}/${current}` })
  } })
  assert.deepEqual((await rawRequest(lease.url)).body, Buffer.alloc(length, 37))
  assert.equal(denied, 3)
  assert.equal(refreshes, 1)
  assert.equal(fetches, 7)
})

test('a delayed old resolver snapshot cannot replace a published refresh with a shorter expiry', async (t) => {
  const length = 4 * blockBytes
  const fresh = deferred()
  const now = Date.now()
  let resolves = 0, refreshes = 0, denied = 0, fetches = 0
  const proxy = await harness(t, { fetch: (url, options) => {
    fetches += 1
    const selected = requested(options)
    if (url.endsWith('/old') && selected.start > 0n) {
      denied += 1
      return bytesResponse('', 403, {})
    }
    return partial(Buffer.alloc(blockBytes, 29), selected, length)
  } })
  const metadata = current => largeSource(length, { url: `${origin}/${current}`,
    expiresAt: now + (current === 'old' ? 600000 : 300000) })
  const lease = await proxy.open({ resolve: async ({ refresh }) => {
    if (refresh) { refreshes += 1; fresh.resolve(); return metadata('new') }
    const ordinal = ++resolves
    const snapshot = metadata('old')
    // These guards start in the old wave and finish after its first refresh.
    // The old URL's longer expiry must not overrule that published transport.
    if (ordinal >= 4) {
      await fresh.promise
      await new Promise(resolve => setTimeout(resolve, (ordinal - 3) * 15))
    }
    return snapshot
  } })
  assert.deepEqual((await rawRequest(lease.url)).body, Buffer.alloc(length, 29))
  assert.equal(resolves, 5, 'every block must still run its full source guard')
  assert.equal(denied, 1)
  assert.equal(refreshes, 1)
  assert.equal(fetches, 5)
})

test('unpublished future blocks retry one transient HTTP response on the exact Range without replaying the first block', async (t) => {
  const length = 4 * blockBytes, bytes = Buffer.alloc(length, 29)
  for (const code of [408, 429, 500, 502, 503, 504]) {
    const attempts = new Map()
    let discarded = 0
    const proxy = await harness(t, { fetch: (_url, options) => {
      const selected = requested(options), index = Number(selected.start)
      const attempt = (attempts.get(index) ?? 0) + 1; attempts.set(index, attempt)
      if (index === blockBytes && attempt === 1) return new Response(new ReadableStream({
        cancel() { discarded += 1 }
      }), { status: code })
      return partial(bytes.subarray(index, Number(selected.end) + 1), selected, length)
    } })
    const lease = await proxy.open({ resolve: () => largeSource(length) })
    assert.deepEqual((await rawRequest(lease.url)).body, bytes)
    assert.deepEqual([...attempts.values()], [1, 2, 1, 1])
    assert.equal(discarded, 1)
    await lease.release()
  }
})

test('future fetch and partial-read transport codes discard unpublished ciphertext before retry and retain exact plaintext', async (t) => {
  const length = 4 * blockBytes, bytes = Buffer.alloc(length)
  for (let index = 0; index < length; index++) bytes[index] = (index * 37 + 23) & 255
  const key = Buffer.from(native.vectors.find(value => value.key_length === 256).key_hex, 'hex')
  const cipher = new WindowsMediaStream(key), encrypted = cipher.transform(Buffer.from(bytes), '0'); cipher.dispose()
  for (const phase of ['fetch', 'partial-read']) {
    const attempts = new Map(), owned = []
    let firstSignal
    const proxy = await harness(t, { fetch: (_url, options) => {
      const selected = requested(options), index = Number(selected.start)
      const attempt = (attempts.get(index) ?? 0) + 1; attempts.set(index, attempt)
      if (index === blockBytes && attempt === 1) {
        firstSignal = options.signal
        if (phase === 'fetch') throw new TypeError('synthetic transport', { cause: Object.assign(Error(), { code: 'ECONNRESET' }) })
        let count = 0
        return new Response(new ReadableStream({ pull(controller) {
          if (count++ === 0) controller.enqueue(Buffer.alloc(65536, 99))
          else controller.error(Object.assign(Error('synthetic transport'), { code: 'UND_ERR_SOCKET' }))
        } }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`,
          'Content-Length': String(blockBytes) } })
      }
      return partial(encrypted.subarray(index, Number(selected.end) + 1), selected, length)
    } })
    const lease = await proxy.open({ resolve: () => {
      const copy = Buffer.from(key); owned.push(copy)
      return largeSource(length, { decoder: { kind: 'mode2', length: String(length), tailBytes: '0', key: copy } })
    } })
    assert.deepEqual((await rawRequest(lease.url)).body, bytes)
    assert.equal(attempts.get(blockBytes), 2)
    assert.equal(firstSignal.aborted, true)
    await lease.release()
    assert.ok(owned.every(value => value.every(byte => byte === 0)))
  }
})

test('future retries reject unclassified errors, forbidden statuses, Retry-After outside budget and metadata changes', async (t) => {
  const length = 4 * blockBytes
  for (const mode of ['generic-typeerror', 'message-only', 'resolver-network-code', 'retry-after',
    'identity', 'bad-range', 'auth', 'persistent-http', 'truncated']) {
    let calls = 0, resolutions = 0, refreshes = 0
    const proxy = await harness(t, { requestTimeoutMs: 100, fetch: (_url, options) => {
      const selected = requested(options)
      if (selected.start !== BigInt(blockBytes)) return partial(Buffer.alloc(blockBytes, 1), selected, length)
      calls++
      if (mode === 'generic-typeerror') throw new TypeError('fetch failed')
      if (mode === 'message-only') throw Error('ECONNRESET')
      if (mode === 'retry-after') return new Response(null, { status: 429, headers: { 'Retry-After': '1' } })
      if (mode === 'truncated') return partial(Buffer.alloc(1), selected, length)
      if (mode === 'auth' && calls > 1) return new Response(null, { status: 403 })
      if (mode === 'bad-range' && calls > 1) return partial(Buffer.alloc(blockBytes), { start: selected.start + 1n, end: selected.end }, length)
      return new Response(null, { status: 503 })
    } })
    const lease = await proxy.open({ resolve: ({ refresh }) => {
      resolutions++
      if (refresh) refreshes++
      if (mode === 'resolver-network-code' && resolutions > 2) throw Object.assign(Error('synthetic auth rejection'), { code: 'ECONNRESET' })
      return largeSource(length, { sourceId: mode === 'identity' && resolutions > 5 ? 'different-content' : 'public-content-sha' })
    } })
    await terminal(rawRequest(lease.url))
    assert.ok(calls <= (mode === 'auth' ? 3 : ['bad-range', 'persistent-http'].includes(mode) ? 2 : 1), `${mode}: ${calls}`)
    if (mode === 'auth') assert.equal(refreshes, 1)
    await lease.release()
  }
})

test('published first blocks never retry a fetch failure or an interrupted body', async (t) => {
  const length = 4 * blockBytes
  for (const phase of ['fetch', 'read']) {
    let firstCalls = 0
    const proxy = await harness(t, { fetch: (_url, options) => {
      const selected = requested(options)
      if (selected.start > 0n) return partial(Buffer.alloc(blockBytes, 1), selected, length)
      firstCalls++
      if (phase === 'fetch') throw Object.assign(Error('synthetic transport'), { code: 'ECONNRESET' })
      let sent = false
      return new Response(new ReadableStream({ pull(controller) {
        if (!sent) { sent = true; controller.enqueue(Buffer.alloc(65536, 1)) }
        else controller.error(Object.assign(Error('synthetic transport'), { code: 'ECONNRESET' }))
      } }), { status: 206, headers: { 'Content-Range': `bytes 0-${blockBytes - 1}/${length}`, 'Content-Length': String(blockBytes) } })
    } })
    const lease = await proxy.open({ resolve: () => largeSource(length) })
    await terminal(rawRequest(lease.url)); assert.equal(firstCalls, 1)
  }
})

test('future retry shares the original timeout budget and discards a late response without waiting for cancel', async (t) => {
  const length = 4 * blockBytes, late = deferred(), retryStarted = deferred()
  let attempts = 0, canceled = 0, retrySignal
  const timeout = 180
  const proxy = await harness(t, { requestTimeoutMs: timeout, fetch: async (_url, options) => {
    const selected = requested(options)
    if (selected.start !== BigInt(blockBytes)) return partial(Buffer.alloc(blockBytes, 1), selected, length)
    attempts++
    if (attempts === 1) { await new Promise(resolve => setTimeout(resolve, 120)); return new Response(null, { status: 503 }) }
    retrySignal = options.signal; retryStarted.resolve(); return late.promise
  } })
  const lease = await proxy.open({ resolve: () => largeSource(length) })
  const started = performance.now(), pending = terminal(rawRequest(lease.url))
  await retryStarted.promise; await pending
  const elapsed = performance.now() - started
  assert.ok(elapsed >= 150 && elapsed < 285, `recovery must use remainder of ${timeout}ms, observed ${elapsed}ms`)
  assert.equal(attempts, 2); assert.equal(retrySignal.aborted, true)
  late.resolve(new Response(new ReadableStream({ cancel() { canceled++; return new Promise(() => {}) } }),
    { status: 206, headers: { 'Content-Range': `bytes ${blockBytes}-${2 * blockBytes - 1}/${length}` } }))
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(canceled, 1)
  await lease.release()
})

test('retrying future blocks retain their global memory permits and stop on cancellation or their own expiry', async (t) => {
  const length = 16 * blockBytes
  for (const cancelMode of ['external', 'expiry']) {
    let calls = 0, firstSignals = [], retries = 0
    const retryReady = deferred(), memoryReady = deferred(), bodies = []
    const proxy = await harness(t, { leaseTtlMs: cancelMode === 'expiry' ? 400 : 600000,
      fetch: (_url, options) => {
        const selected = requested(options); calls++
        if (calls === 34) memoryReady.resolve()
        if (selected.start === BigInt(blockBytes)) {
          const label = new URL(_url).pathname
          if (!bodies.includes(label)) { bodies.push(label); return new Response(null, { status: 503 }) }
          retries++; if (retries === 2) retryReady.resolve()
        }
        if (selected.start === 0n || selected.start === BigInt(blockBytes)) {
          firstSignals.push(options.signal)
          return new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from([1])) } }),
            { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`, 'Content-Length': String(blockBytes) } })
        }
        return partial(Buffer.alloc(blockBytes, 1), selected, length)
      } })
    const external = new AbortController(), leases = [], connections = []
    t.after(() => { for (const { req, response } of connections) { response.destroy(); req.destroy() } })
    for (const label of ['a', 'b', 'c']) leases.push(await proxy.open({ signal: external.signal, durationSeconds: 1,
      resolve: () => largeSource(length, { url: `${origin}/${label}` }) }))
    for (const lease of leases.slice(0, 2)) {
      const connection = await rawRequest(lease.url, { consume: false }); connection.response.on('error', () => {}); connections.push(connection)
    }
    await within(retryReady.promise, 1000, 'both retries must retain their permits')
    await within(memoryReady.promise, 1000, 'both windows must retain thirty-two memory credits')
    const third = rawRequest(leases[2].url, { consume: false }).then(connection => {
      connection.response.on('error', () => {}); connections.push(connection); return connection
    })
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(calls, 34, 'thirty-two memory permits plus two retry attempts; third response stays queued')
    if (cancelMode === 'external') external.abort()
    await within(third, 1000, 'cancel/expiry must release queued response')
    await proxy.revokeAll()
    assert.ok(firstSignals.every(signal => signal.aborted))
    // Independent leases expire in opening order: a later still-live queued
    // lease may use released slots before its own timer. It must then stop too.
    assert.ok(calls <= (cancelMode === 'expiry' ? 51 : 34))
    const afterRevoke = calls
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(calls, afterRevoke)
  }
})

test('a healthy buffered first attempt can progress beyond the retry-chain budget without restarting', async (t) => {
  const length = 4 * blockBytes
  let attempts = 0
  const proxy = await harness(t, { requestTimeoutMs: 70, fetch: (_url, options) => {
    const selected = requested(options)
    if (selected.start !== BigInt(blockBytes)) return partial(Buffer.alloc(blockBytes, 17), selected, length)
    attempts++
    let position = 0
    return new Response(new ReadableStream({ async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 25))
      if (options.signal.aborted) return
      position += 65536; controller.enqueue(Buffer.alloc(65536, 17))
      if (position === blockBytes) controller.close()
    } }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`,
      'Content-Length': String(blockBytes) } })
  } })
  const lease = await proxy.open({ resolve: () => largeSource(length) })
  const started = performance.now(), result = await rawRequest(lease.url)
  assert.deepEqual(result.body, Buffer.alloc(length, 17))
  assert.ok(performance.now() - started > 150)
  assert.equal(attempts, 1)
})

test('Retry-After rejects malformed numeric or calendar values and accepts only valid IMF-fixdate or integer delay', async (t) => {
  const length = 4 * blockBytes
  const cases = [
    ...['-1', '1.5', '', '-0', 'NaN', 'Sun, 31 Feb 2026 00:00:00 GMT',
      'Sun, 06 Nov 1994 25:00:00 GMT', 'Mon, 06 Nov 1994 08:49:37 GMT',
      'Sun, 06 Nov 1994 08:49:37 UTC', 'Sunday, 06-Nov-94 08:49:37 GMT',
      '999999999999999999999999999999'].map(value => [value, false]),
    [new Date(Date.now() + 86400000).toUTCString(), false],
    ['0', true], [new Date(Date.now() - 86400000).toUTCString(), true]
  ]
  for (const [value, shouldRetry] of cases) {
    let calls = 0
    const proxy = await harness(t, { requestTimeoutMs: 100, fetch: (_url, options) => {
      const selected = requested(options)
      if (selected.start === BigInt(blockBytes) && ++calls === 1) {
        return new Response(null, { status: 429, headers: { 'Retry-After': value } })
      }
      return partial(Buffer.alloc(blockBytes, 17), selected, length)
    } })
    const lease = await proxy.open({ resolve: () => largeSource(length) })
    if (shouldRetry) assert.deepEqual((await rawRequest(lease.url)).body, Buffer.alloc(length, 17))
    else await terminal(rawRequest(lease.url))
    assert.equal(calls, shouldRetry ? 2 : 1, `Retry-After: ${value}`)
    await lease.release()
  }
})

test('read-ahead uses verified bytes and bounded duration hints while the first byte streams immediately', async (t) => {
  const cases = [
    ...[undefined, 0, -1, NaN, 1.5, '20', Number.MAX_SAFE_INTEGER].map(duration => ({ length: 32n * BigInt(blockBytes), duration, blocks: 4 })),
    { length: 8n * BigInt(blockBytes), duration: 20, blocks: 8 },
    { length: 4n * BigInt(blockBytes) + 1n, duration: 20, blocks: 5 },
    { length: 100n * BigInt(blockBytes), duration: 100, blocks: 16 },
    { length: 0xffffffffffffffffn, duration: 1, blocks: 16 },
    { length: 0xffffffffffffffffn, duration: Number.MAX_SAFE_INTEGER, blocks: 4 }
  ]
  for (const fixture of cases) {
    let calls = 0, finished = 0, active = 0, peak = 0
    const aheadReady = deferred()
    const proxy = await harness(t, { fetch: (_url, options) => {
      const selected = requested(options); calls++; active++; peak = Math.max(peak, active)
      if (selected.start === 0n) return new Response(new ReadableStream({
        start(controller) { controller.enqueue(Buffer.from([17])) }
      }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${fixture.length}`,
        'Content-Length': String(blockBytes) } })
      return new Response(new ReadableStream({ async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 5))
        if (options.signal.aborted) return
        controller.enqueue(Buffer.alloc(Number(selected.end - selected.start + 1n), 17)); controller.close()
        active--; finished++; if (finished === fixture.blocks - 1) aheadReady.resolve()
      } }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${fixture.length}`,
        'Content-Length': String(selected.end - selected.start + 1n) } })
    } })
    const lease = await proxy.open({ durationSeconds: fixture.duration, resolve: () => largeSource(fixture.length) })
    const connection = await within(rawRequest(lease.url, { consume: false }), 1000, 'stream first byte before first block completion')
    connection.response.on('error', () => {})
    try {
      await within(aheadReady.promise, 1000, 'completed future lanes must pump without consumption')
      await new Promise(resolve => setTimeout(resolve, 15))
      assert.equal(calls, fixture.blocks, `${fixture.length}/${fixture.duration}`)
      assert.ok(peak <= 4)
    } finally { connection.response.destroy(); connection.req.destroy(); await lease.release() }
  }
})

test('separate transport permits cap overlapping windows at four each and eight globally with FIFO admission', async (t) => {
  const length = 32 * blockBytes, gate = deferred(), eight = deferred(), thirdAdmitted = deferred()
  const active = new Map(), peak = new Map(), calls = []
  let totalActive = 0, totalPeak = 0
  const proxy = await harness(t, { fetch: (url, options) => {
    const label = new URL(url).pathname, selected = requested(options)
    calls.push({ label, start: selected.start.toString() })
    active.set(label, (active.get(label) ?? 0) + 1)
    peak.set(label, Math.max(peak.get(label) ?? 0, active.get(label)))
    totalPeak = Math.max(totalPeak, ++totalActive)
    let completed = false
    const finish = () => { if (completed) return; completed = true; totalActive--; active.set(label, active.get(label) - 1) }
    options.signal.addEventListener('abort', finish, { once: true })
    if (calls.length === 8) eight.resolve()
    if (label === '/c' && selected.start === 0n) thirdAdmitted.resolve()
    return new Response(new ReadableStream({ async start(controller) {
      if (selected.start === 0n) { controller.enqueue(Buffer.from([17])); return }
      await gate.promise
      if (options.signal.aborted) return
      controller.enqueue(Buffer.alloc(blockBytes, 17)); controller.close(); finish()
    } }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`,
      'Content-Length': String(blockBytes) } })
  } })
  const connections = [], leases = []
  t.after(async () => { for (const value of connections) { value.response.destroy(); value.req.destroy() }; await proxy.revokeAll() })
  const begin = lease => rawRequest(lease.url, { consume: false }).then(value => {
    value.response.on('error', () => {}); connections.push(value); return value
  })
  for (const label of ['a', 'b', 'c']) leases.push(await proxy.open({ durationSeconds: 1,
    resolve: () => largeSource(length, { url: `${origin}/${label}` }) }))
  await begin(leases[0]); await begin(leases[1]); await within(eight.promise, 1000, 'eight simultaneous transport jobs')
  const third = begin(leases[2])
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls.length, 8)
  gate.resolve(); await within(thirdAdmitted.promise, 1000, 'queued first stream must enter before later pump work')
  await third
  assert.deepEqual(calls[8], { label: '/c', start: '0' })
  assert.ok(totalPeak <= 8); assert.ok([...peak.values()].every(value => value <= 4))
})

test('first-stream failure after filling a large window aborts every future owner and returns held memory', async (t) => {
  const length = 16 * blockBytes, ready = deferred()
  let failFirst, finished = 0, healthy = false, calls = 0, transformed = 0
  const signals = []
  const proxy = await harness(t, { fetch: (_url, options) => {
    calls++; signals.push(options.signal)
    const selected = requested(options)
    if (!healthy && selected.start === 0n) return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from([17])); failFirst = () => controller.error(Object.assign(Error('synthetic disconnect'), { code: 'ECONNRESET' }))
    } }), { status: 206, headers: { 'Content-Range': `bytes ${selected.start}-${selected.end}/${length}`, 'Content-Length': String(blockBytes) } })
    if (!healthy && ++finished === 15) ready.resolve()
    return partial(Buffer.alloc(blockBytes, 17), selected, length)
  } })
  const lease = await proxy.open({ durationSeconds: 1, resolve: () => largeSource(length, {
    decoder: { kind: 'mode1', length: String(length), tailBytes: '0',
      transform(bytes) { transformed += bytes.length; return bytes }, dispose() {} }
  }) })
  const pending = terminal(rawRequest(lease.url))
  await within(ready.promise, 1000, 'fifteen unpublished future blocks should fill ahead while first stream stalls')
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, 16)
  failFirst(); await pending; await lease.release()
  assert.equal(transformed, 1, 'unpublished buffered ciphertext must not pass the response transform')
  assert.ok(signals.every(signal => signal.aborted))
  healthy = true
  const replacement = await proxy.open({ durationSeconds: 1, resolve: () => largeSource(length) })
  assert.equal((await within(rawRequest(replacement.url), 1500, 'failure leaked global memory/transport permits')).body.length, length)
})
