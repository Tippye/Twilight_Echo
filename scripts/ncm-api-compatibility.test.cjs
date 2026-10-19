const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const test = require('node:test')

test('installed NCM gateway supports keyless eapi playback and preserves failures', async (t) => {
  // Use the installed gateway, song module, and encryption implementation. Only
  // the remote HTTP transport and temp credentials are replaced; no account or
  // network access is needed, even if the developer has a cached xeapi key.
  const existsSync = fs.existsSync
  const readFileSync = fs.readFileSync
  t.mock.method(fs, 'existsSync', (file) =>
    path.basename(String(file)) === 'xeapi_public_key' ? false : existsSync(file)
  )
  t.mock.method(fs, 'readFileSync', (file, ...args) =>
    path.basename(String(file)) === 'anonymous_token' ? '' : readFileSync(file, ...args)
  )

  const ncmRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api/server.js'))
  const axios = ncmRequire('axios')
  const { eapiReqDecrypt } = ncmRequire('./util/crypto.js')
  const upstreamRequests = []
  t.mock.method(axios, 'default', async (settings) => {
    upstreamRequests.push(settings)
    return {
      status: 200,
      headers: {},
      data: { code: 200, data: [{ id: 4939801, url: 'https://music.example/song.flac' }] }
    }
  })
  const logger = ncmRequire('./util/logger.js')
  const errors = []
  t.mock.method(logger, 'error', (...args) => errors.push(args))
  t.mock.method(logger, 'info', () => {})
  const songUrlV1 = ncmRequire('./module/song_url_v1.js')
  const { serveNcmApi } = ncmRequire('./server.js')
  const app = await serveNcmApi({
    host: '127.0.0.1',
    port: '0',
    checkVersion: false,
    moduleDefs: [
      { route: '/song/url/v1', module: songUrlV1 },
      {
        route: '/missing-sk',
        module: async () => {
          throw new Error('xeapi public key response missing sk')
        }
      },
      {
        route: '/upstream-404',
        module: async () => {
          throw { status: 404, body: { code: 404, msg: 'song not found' }, cookie: [] }
        }
      },
      {
        route: '/login-required',
        module: async () => {
          throw {
            status: 200,
            body: { code: 301, msg: 'login required' },
            cookie: ['test-cookie=value']
          }
        }
      },
      {
        route: '/empty-error',
        module: async () => {
          throw null
        }
      }
    ]
  })
  t.after(async () => {
    const cache = ncmRequire('./util/apicache')
    for (const key of [...cache.getIndex().all]) cache.clear(key)
    app.server.closeAllConnections()
    await new Promise((resolve, reject) => {
      app.server.close((error) => (error ? reject(error) : resolve()))
    })
  })
  if (!app.server.listening) {
    await new Promise((resolve, reject) => {
      app.server.once('listening', resolve)
      app.server.once('error', reject)
    })
  }
  const origin = `http://127.0.0.1:${app.server.address().port}`
  const request = (route, options) =>
    fetch(`${origin}${route}`, { ...options, signal: AbortSignal.timeout(5000) })

  await t.test('all playback levels reach the official v1 endpoint through eapi', async () => {
    for (const level of ['hires', 'lossless', 'exhigh', 'standard']) {
      const response = await request(
        `/song/url/v1?id=4939801&level=${level}&encodeType=flac&crypto=eapi`,
        { headers: { Cookie: 'MUSIC_U=test-account' } }
      )
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data[0].url, 'https://music.example/song.flac')
      const upstream = upstreamRequests.at(-1)
      assert.equal(upstream.url, 'https://interface.music.163.com/eapi/song/enhance/player/url/v1')
      const decoded = eapiReqDecrypt(new URLSearchParams(upstream.data).get('params'))
      assert.equal(decoded.url, '/api/song/enhance/player/url/v1')
      assert.equal(decoded.data.ids, '[4939801]')
      assert.equal(decoded.data.level, level)
      assert.equal(decoded.data.encodeType, 'flac')
      assert.equal(decoded.data.header.MUSIC_U, 'test-account')
    }
    assert.equal(upstreamRequests.length, 4)
    assert.equal(errors.length, 0)
  })

  await t.test(
    'a missing xeapi key is a gateway error with its cause, not an API 404',
    async () => {
      const response = await request('/song/url/v1?id=4939801&level=hires')
      assert.equal(response.status, 502)
      assert.deepEqual(await response.json(), {
        code: 502,
        data: null,
        msg: 'xeapi public key is missing'
      })
      assert.equal(errors.at(-1)[1].message, 'xeapi public key is missing')
      assert.equal(upstreamRequests.length, 4)
    }
  )

  await t.test('public key parsing failures remain visible in responses and logs', async () => {
    const response = await request('/missing-sk')
    assert.equal(response.status, 502)
    assert.equal((await response.json()).msg, 'xeapi public key response missing sk')
    assert.equal(errors.at(-1)[1].message, 'xeapi public key response missing sk')
  })

  await t.test('a real upstream 404 retains its status and body', async () => {
    const response = await request('/upstream-404')
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { code: 404, msg: 'song not found' })
  })

  await t.test(
    'login-required responses retain the existing status, message and cookies',
    async () => {
      const response = await request('/login-required')
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { code: 301, msg: '需要登录' })
      assert.equal(response.headers.get('set-cookie'), 'test-cookie=value')
      const noCookieResponse = await request('/login-required?noCookie=true')
      assert.equal(noCookieResponse.headers.get('set-cookie'), null)
    }
  )

  await t.test('empty thrown values produce a bounded gateway response', async () => {
    const response = await request('/empty-error')
    assert.equal(response.status, 502)
    assert.equal((await response.json()).msg, 'NetEase API request failed')
  })
})
