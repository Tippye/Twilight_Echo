import assert from 'node:assert/strict'
import dns from 'node:dns'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import { createWebDavAdapter } from './webdavAdapter.ts'
import { NetworkResumeUnsupported } from '../errors.ts'
import type { NetworkSourceProfile } from '../../../shared/networkSources.ts'

const MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/music/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music/album/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music/a.flac</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>1024</d:getcontentlength>
        <d:getcontenttype>audio/flac</d:getcontenttype>
        <d:getlastmodified>Wed, 01 Jan 2025 00:00:00 GMT</d:getlastmodified>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

// 真实服务端会返回绝对 URI、XML 转义实体（&amp;）、百分号编码（含中文），
// 还可能混入错误编码与穿越路径。这里一次性覆盖这些形态。
const RICH_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>http://example.test/music-rich</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/album/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>http://example.test/music-rich/a&amp;b.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength><d:getcontenttype>audio/flac</d:getcontenttype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/c%23d.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/%E4%B8%AD%E6%96%87%20name.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/../secret.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/bad%ZZ.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/music-rich/&#xD800;.flac</d:href>
    <d:propstat>
      <d:prop><d:getcontentlength>4</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

const HYPHEN_PREFIX_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<ns-1:multistatus xmlns:ns-1="DAV:">
  <ns-1:response>
    <ns-1:href>/music-hyphen/</ns-1:href>
    <ns-1:propstat><ns-1:prop><ns-1:resourcetype><ns-1:collection/></ns-1:resourcetype></ns-1:prop><ns-1:status>HTTP/1.1 200 OK</ns-1:status></ns-1:propstat>
  </ns-1:response>
  <ns-1:response>
    <ns-1:href>/music-hyphen/album/</ns-1:href>
    <ns-1:propstat><ns-1:prop><ns-1:resourcetype><ns-1:collection/></ns-1:resourcetype></ns-1:prop><ns-1:status>HTTP/1.1 200 OK</ns-1:status></ns-1:propstat>
  </ns-1:response>
  <ns-1:response>
    <ns-1:href>/music-hyphen/a.flac</ns-1:href>
    <ns-1:propstat><ns-1:prop><ns-1:getcontentlength>1024</ns-1:getcontentlength></ns-1:prop><ns-1:status>HTTP/1.1 200 OK</ns-1:status></ns-1:propstat>
  </ns-1:response>
</ns-1:multistatus>`

const FLAC_BYTES = Buffer.from('FLAC-DATA-0123456789')
const EXPECTED_BASIC = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`
const SINGLE_FILE_STATUS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/music/a.flac</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>1024</d:getcontentlength>
        <d:getcontenttype>audio/flac</d:getcontenttype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`

interface SeenRequest {
  method: string
  url: string
  authorization?: string
  contentLength?: string
  range?: string
}

let server: Server
let otherServer: Server
let ipv6Server: Server
let basePort = 0
let otherPort = 0
let ipv6Port = 0
const seen: SeenRequest[] = []
const otherSeen: SeenRequest[] = []

function record(target: SeenRequest[], req: import('node:http').IncomingMessage): void {
  target.push({
    method: req.method ?? '',
    url: req.url ?? '',
    authorization: req.headers.authorization,
    contentLength: req.headers['content-length'],
    range: typeof req.headers.range === 'string' ? req.headers.range : undefined
  })
}

function makeProfile(
  overrides: Partial<Omit<NetworkSourceProfile, 'options'>> & {
    options?: Partial<NetworkSourceProfile['options']>
  } = {}
): NetworkSourceProfile {
  const base: NetworkSourceProfile = {
    id: 'p1',
    protocol: 'webdav',
    name: 'Test NAS',
    host: '127.0.0.1',
    port: basePort,
    rootPath: '/music',
    username: 'alice',
    credential: { kind: 'password', encryptedId: 'enc:secret' },
    options: {
      readOnly: true,
      connectTimeoutMs: 5_000,
      transferTimeoutMs: 10_000,
      maxConcurrentTransfers: 2
    },
    bookmarks: [],
    createdAt: 1,
    lastConnectedAt: null
  }
  return {
    ...base,
    ...overrides,
    options: { ...base.options, ...(overrides.options ?? {}) },
    credential: overrides.credential ?? base.credential
  }
}

test.before(async () => {
  server = createServer((req, res) => {
    record(seen, req)
    if (req.url === '/music-digest') {
      res.writeHead(401, {
        'WWW-Authenticate': 'Digest realm="x", nonce="abc", algorithm=MD5, qop="auth"'
      })
      res.end()
      return
    }
    if (req.url === '/music-basic-realm-digest') {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Digest zone"' })
      res.end()
      return
    }
    if (req.headers.authorization !== EXPECTED_BASIC) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' })
      res.end()
      return
    }
    if (req.method === 'PROPFIND') {
      if (req.url === '/music' || req.url === '/music/') {
        res.writeHead(207, { 'Content-Type': 'application/xml' })
        res.end(MULTISTATUS)
        return
      }
      if (req.url === '/music/a.flac') {
        res.writeHead(207, { 'Content-Type': 'application/xml' })
        res.end(SINGLE_FILE_STATUS)
        return
      }
      if (req.url === '/music-rich' || req.url === '/music-rich/') {
        res.writeHead(207, { 'Content-Type': 'application/xml' })
        res.end(RICH_MULTISTATUS)
        return
      }
      if (req.url === '/music-hyphen' || req.url === '/music-hyphen/') {
        res.writeHead(207, { 'Content-Type': 'application/xml' })
        res.end(HYPHEN_PREFIX_MULTISTATUS)
        return
      }
      if (req.url === '/music-no-slash') {
        res.writeHead(301, { Location: '/music/' })
        res.end()
        return
      }
      if (req.url === '/music-xorigin') {
        res.writeHead(301, { Location: `http://127.0.0.1:${otherPort}/music-target` })
        res.end()
        return
      }
      if (req.url === '/music-hang') {
        // 故意不响应，用于空闲超时断言。
        return
      }
      if (req.url === '/music-slow-headers') {
        const timer = setTimeout(() => {
          res.writeHead(207, { 'Content-Type': 'application/xml' })
          res.end(MULTISTATUS)
        }, 800)
        res.on('close', () => clearTimeout(timer))
        return
      }
      if (req.url === '/music-forbidden') {
        res.writeHead(403)
        res.end()
        return
      }
      if (req.url === '/music-error') {
        res.writeHead(500)
        res.end('boom')
        return
      }
      if (req.url === '/music-loop') {
        res.writeHead(301, { Location: '/music-loop' })
        res.end()
        return
      }
      if (req.url === '/music-ftp') {
        res.writeHead(301, { Location: 'ftp://example.test/music' })
        res.end()
        return
      }
      res.writeHead(404)
      res.end()
      return
    }
    if (req.method === 'GET') {
      if (req.url?.startsWith('/music-rich/')) {
        res.writeHead(200, { 'Content-Type': 'audio/flac' })
        res.end('RICH')
        return
      }
      if (req.url === '/music/slow.flac') {
        res.writeHead(200, { 'Content-Type': 'audio/flac' })
        let sent = 0
        const timer = setInterval(() => {
          res.write('slow-chunk;')
          sent += 1
          if (sent >= 16) {
            clearInterval(timer)
            res.end()
          }
        }, 50)
        res.on('close', () => clearInterval(timer))
        return
      }
      if (req.url === '/music/wrong-range.flac') {
        res.writeHead(206, {
          'Content-Range': `bytes 0-4/${FLAC_BYTES.length}`,
          'Content-Length': 5
        })
        res.end(FLAC_BYTES.subarray(0, 5))
        return
      }
      if (req.url === '/music/a.flac') {
        const range = req.headers.range
        const match = typeof range === 'string' ? /^bytes=(\d+)-/.exec(range) : null
        if (match) {
          const start = Number(match[1])
          if (start >= FLAC_BYTES.length) {
            res.writeHead(416, { 'Content-Range': `bytes */${FLAC_BYTES.length}` })
            res.end()
            return
          }
          const body = FLAC_BYTES.subarray(start)
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${FLAC_BYTES.length - 1}/${FLAC_BYTES.length}`,
            'Content-Length': body.length
          })
          res.end(body)
          return
        }
        res.writeHead(200, { 'Content-Type': 'audio/flac', 'Content-Length': FLAC_BYTES.length })
        res.end(FLAC_BYTES)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  otherServer = createServer((req, res) => {
    record(otherSeen, req)
    res.writeHead(200, { 'Content-Type': 'application/xml' })
    res.end(MULTISTATUS)
  })
  ipv6Server = createServer((req, res) => {
    if (req.method === 'PROPFIND') {
      res.writeHead(207, { 'Content-Type': 'application/xml' })
      res.end(MULTISTATUS)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => otherServer.listen(0, '127.0.0.1', resolve))
  await new Promise<void>((resolve) => ipv6Server.listen(0, '::1', resolve))
  const address = server.address()
  const otherAddress = otherServer.address()
  const ipv6Address = ipv6Server.address()
  if (address && typeof address === 'object') basePort = address.port
  if (otherAddress && typeof otherAddress === 'object') otherPort = otherAddress.port
  if (ipv6Address && typeof ipv6Address === 'object') ipv6Port = ipv6Address.port
})

test.after(async () => {
  await Promise.all(
    [server, otherServer, ipv6Server].map(
      (item) =>
        new Promise<void>((resolve, reject) => item.close((err) => (err ? reject(err) : resolve())))
    )
  )
})

test('webdav list parses multistatus into children entries with stable ids', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const entries = await session.list('/music')
  assert.equal(entries.length, 2)
  const album = entries.find((entry) => entry.name === 'album')
  const track = entries.find((entry) => entry.name === 'a.flac')
  assert.ok(album)
  assert.ok(track)
  assert.equal(album.kind, 'directory')
  assert.equal(album.path, '/music/album')
  assert.equal(track.kind, 'audio')
  assert.equal(track.path, '/music/a.flac')
  assert.equal(track.sizeBytes, 1024)
  assert.equal(track.mimeType, 'audio/flac')
  assert.match(track.id, /^[0-9a-f]{64}$/)
  await session.close()
})

test('webdav stat returns a single entry and notFound for missing paths', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const entry = await session.stat('/music/a.flac')
  assert.equal(entry?.name, 'a.flac')
  await assert.rejects(
    async () => session.stat('/music/missing.flac'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'notFound')
      return true
    }
  )
  await session.close()
})

test('webdav readStream streams file bytes with the configured auth', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const stream = await session.readStream('/music/a.flac')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(chunks), FLAC_BYTES)
  await session.close()
})

test('webdav rejects wrong credentials with auth error', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 'wrong'
  })
  await assert.rejects(
    async () => session.list('/music'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'auth')
      return true
    }
  )
  await session.close()
})

test('webdav readStream honors byte range resumes', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const stream = await session.readStream('/music/a.flac', undefined, { start: 4 })
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  assert.deepEqual(Buffer.concat(chunks), FLAC_BYTES.subarray(4))
  await session.close()
})

test('webdav list normalizes absolute hrefs, XML entities, encodings and drops unsafe paths', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const entries = await session.list('/music-rich')
  const paths = entries.map((entry) => entry.path).sort()
  assert.deepEqual(paths, [
    '/music-rich/a&b.flac',
    '/music-rich/album',
    '/music-rich/bad%ZZ.flac',
    '/music-rich/c#d.flac',
    '/music-rich/中文 name.flac'
  ])
  // 绝对 URI 的自身 href 必须被过滤，不能出现在子条目里。
  assert.ok(!paths.includes('/music-rich'))
  // 穿越路径、非法编码与孤立代理项必须被丢弃。
  assert.ok(!paths.some((path) => path.includes('secret')))
  assert.ok(!paths.some((path) => path.includes('\uD800')))
  await session.close()
})

test('webdav rejects paths that cannot be percent-encoded with a structured error', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.list('/music/\uD800'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'network')
      assert.ok(err instanceof Error)
      return true
    }
  )
  await session.close()
})

test('webdav percent-encodes reserved characters when building request URLs', async () => {
  seen.length = 0
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const stream = await session.readStream('/music-rich/c#d.flac')
  for await (const _chunk of stream) void _chunk
  assert.ok(seen.some((item) => item.url === '/music-rich/c%23d.flac'))

  const amp = await session.readStream('/music-rich/a&b.flac')
  for await (const _chunk of amp) void _chunk
  assert.ok(seen.some((item) => item.url === '/music-rich/a%26b.flac'))

  const chinese = await session.readStream('/music-rich/中文 name.flac')
  for await (const _chunk of chinese) void _chunk
  assert.ok(seen.some((item) => item.url === '/music-rich/%E4%B8%AD%E6%96%87%20name.flac'))
  await session.close()
})

test('webdav sends an explicit Content-Length for PROPFIND bodies', async () => {
  seen.length = 0
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await session.list('/music')
  const propfind = seen.find((item) => item.method === 'PROPFIND')
  assert.ok(propfind)
  assert.ok(Number(propfind.contentLength) > 0)
  await session.close()
})

test('webdav follows redirects when a collection needs a trailing slash', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const entries = await session.list('/music-no-slash')
  assert.deepEqual(entries.map((entry) => entry.path).sort(), ['/music/a.flac', '/music/album'])
  await session.close()
})

test('webdav does not leak credentials across cross-origin redirects', async () => {
  otherSeen.length = 0
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await session.list('/music-xorigin')
  assert.ok(otherSeen.length > 0)
  assert.ok(otherSeen.every((item) => item.authorization === undefined))
  await session.close()
})

test('webdav does not abort downloads that keep making progress', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ options: { connectTimeoutMs: 500, transferTimeoutMs: 500 } }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  const stream = await session.readStream('/music/slow.flac')
  let total = 0
  for await (const chunk of stream) total += Buffer.byteLength(chunk as Buffer)
  assert.equal(total, 'slow-chunk;'.length * 16)
  await session.close()
})

test('webdav reports an idle timeout when the server never responds', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ options: { connectTimeoutMs: 150, transferTimeoutMs: 150 } }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  await assert.rejects(
    async () => session.list('/music-hang'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'timeout')
      return true
    }
  )
  await session.close()
})

test('webdav bounds the wait for response headers with connectTimeoutMs', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ options: { connectTimeoutMs: 120, transferTimeoutMs: 5_000 } }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  const startedAt = Date.now()
  await assert.rejects(
    async () => session.list('/music-slow-headers'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'timeout')
      return true
    }
  )
  assert.ok(Date.now() - startedAt < 600)
  await session.close()
})

test('webdav connection deadline includes a stalled DNS lookup', async (t) => {
  let lookupStarted = false
  t.mock.method(dns, 'lookup', () => {
    lookupStarted = true
    // Simulate a resolver that never invokes its callback.
  })
  const session = await createWebDavAdapter().createSession(
    makeProfile({ host: 'stalled.invalid', options: { connectTimeoutMs: 50 } }),
    { kind: 'anonymous' }
  )
  const controller = new AbortController()
  let watchdogExpired = false
  const watchdog = setTimeout(() => {
    watchdogExpired = true
    controller.abort()
  }, 2000)
  try {
    await assert.rejects(session.list('/music', controller.signal), { code: 'timeout' })
    assert.equal(lookupStarted, true)
    assert.equal(watchdogExpired, false, 'connection deadline must abort before the caller does')
  } finally {
    clearTimeout(watchdog)
    await session.close()
  }
})

test('webdav keeps a port embedded in the host when none is configured explicitly', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ host: `127.0.0.1:${basePort}`, port: null }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  const entries = await session.list('/music')
  assert.deepEqual(entries.map((entry) => entry.path).sort(), ['/music/a.flac', '/music/album'])
  await session.close()
})

test('webdav explicit port overrides a port embedded in the host', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ host: '127.0.0.1:1', port: basePort }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  const entries = await session.list('/music')
  assert.equal(entries.length, 2)
  await session.close()
})

test('webdav sends Basic auth for a password profile with an empty password', async () => {
  seen.length = 0
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: ''
  })
  await assert.rejects(async () => session.list('/music'))
  const request = seen.find((item) => item.method === 'PROPFIND')
  assert.ok(request)
  assert.equal(request.authorization, `Basic ${Buffer.from('alice:').toString('base64')}`)
  await session.close()
})

test('webdav connects to an IPv6 host literal', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ host: '::1', port: ipv6Port }),
    { kind: 'anonymous' }
  )
  const entries = await session.list('/music')
  assert.equal(entries.length, 2)
  await session.close()
})

test('webdav drops a stray query or fragment from the configured host', async () => {
  const session = await createWebDavAdapter().createSession(
    makeProfile({ host: `127.0.0.1:${basePort}?x=1#frag`, port: null }),
    { kind: 'password', username: 'alice', password: 's3cret' }
  )
  const entries = await session.list('/music')
  assert.equal(entries.length, 2)
  await session.close()
})

test('webdav maps forbidden and server errors to structured codes', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.list('/music-forbidden'),
    (err: unknown) => (err as { code: string }).code === 'denied'
  )
  await assert.rejects(
    async () => session.list('/music-error'),
    (err: unknown) => (err as { code: string }).code === 'network'
  )
  await session.close()
})

test('webdav rejects redirect loops and non-http redirect targets', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.list('/music-loop'),
    (err: unknown) => (err as { code: string }).code === 'network'
  )
  await assert.rejects(
    async () => session.list('/music-ftp'),
    (err: unknown) => (err as { code: string }).code === 'network'
  )
  await session.close()
})

test('webdav treats unsatisfiable and mismatched ranges as resume-unsupported', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.readStream('/music/a.flac', undefined, { start: 9999 }),
    (err: unknown) => err instanceof NetworkResumeUnsupported
  )
  await assert.rejects(
    async () => session.readStream('/music/wrong-range.flac', undefined, { start: 4 }),
    (err: unknown) => err instanceof NetworkResumeUnsupported
  )
  await session.close()
})

test('webdav parses namespaced tags with hyphen or dot prefixes', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  const entries = await session.list('/music-hyphen')
  assert.deepEqual(entries.map((entry) => entry.path).sort(), [
    '/music-hyphen/a.flac',
    '/music-hyphen/album'
  ])
  await session.close()
})

test('webdav distinguishes a Digest challenge from a wrong password', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.list('/music-digest'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'auth')
      assert.match((err as Error).message, /Digest/)
      return true
    }
  )
  await session.close()
})

test('webdav keeps the generic auth message for a Basic realm mentioning Digest', async () => {
  const session = await createWebDavAdapter().createSession(makeProfile(), {
    kind: 'password',
    username: 'alice',
    password: 's3cret'
  })
  await assert.rejects(
    async () => session.list('/music-basic-realm-digest'),
    (err: unknown) => {
      assert.equal((err as { code: string }).code, 'auth')
      assert.doesNotMatch((err as Error).message, /Digest/)
      return true
    }
  )
  await session.close()
})
