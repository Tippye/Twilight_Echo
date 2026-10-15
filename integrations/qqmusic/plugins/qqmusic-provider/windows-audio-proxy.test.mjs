import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { WindowsAudioProxy } from './lib/windows/audio-proxy.mjs'

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
  const length = String(chunkBytes * chunks)
  const proxy = await harness(t, { fetch: () => new Response(new ReadableStream({
    pull(controller) {
      pulled += 1
      if (pulled <= chunks) controller.enqueue(Buffer.alloc(chunkBytes, 1))
      else controller.close()
    }
  }), { status: 206, headers: { 'Content-Range': `bytes 0-${BigInt(length) - 1n}/${length}` } }) })
  const lease = await proxy.open({ resolve: () => source({ upstreamLength: length,
    decoder: { kind: 'mode1', length, tailBytes: '0', transform: (bytes) => bytes,
      dispose() { disposed += 1 } } }) })
  const { req, response } = await rawRequest(lease.url, { consume: false })
  response.on('error', () => {})
  response.pause()
  await new Promise((done) => setTimeout(done, 30))
  assert.ok(pulled < chunks, `pulled ${pulled} chunks while client paused`)
  response.destroy()
  req.destroy()
  await lease.release()
  assert.equal(disposed, 2)
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
  const requestDisposed = deferred()
  const proxy = await harness(t, { requestTimeoutMs: 50, fetch: () => new Response(new ReadableStream({
    pull(controller) {
      pulled += 1
      if (pulled <= chunks) controller.enqueue(Buffer.alloc(chunkBytes, 1))
      else controller.close()
    }
  }), { status: 206, headers: { 'Content-Range': `bytes 0-${BigInt(length) - 1n}/${length}` } }) })
  const lease = await proxy.open({ resolve: () => source({ upstreamLength: length,
    decoder: { kind: 'mode1', length, tailBytes: '0', transform: (bytes) => bytes,
      dispose() { disposed += 1; if (disposed === 2) requestDisposed.resolve() } } }) })
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
  assert.equal(disposed, 1, 'request owner must remain active while only downstream is paused')
  response.resume()
  await finished
  assert.equal(received, Number(length))
  // Client 'end' can arrive before the server finishes its owner's finally block.
  await within(requestDisposed.promise, 1000, 'completed request must dispose its decoder owner')
  assert.equal(disposed, 2)
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
