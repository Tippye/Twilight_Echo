import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveWindowsPlaylistBinding } from './lib/windows/playlist-binding.mjs'
import { WindowsRpcError } from './lib/windows/response.mjs'
import { WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY } from './lib/windows/playlist-call.mjs'
const row = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url))).publicSongs[0]
const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'
const data = (id = '77', host = '0') => ({ code: 0, subcode: 0,
  dirinfo: { id, host_uin: host, creator: { musicid: host, private: marker }, private: marker },
  total_song_num: 1, songlist: [{ ...row, private: marker }], login_uin: marker, private: marker })
const resolve = (client, extra = {}) => resolveWindowsPlaylistBinding({ client, loginUin: '42', disstid: '77', ...extra })

test('public lookup explicitly uses verified login for both native UIN fields and derives final ref only from bound actual response', async () => {
  const signal = new AbortController().signal; let calls = 0
  const result = await resolve({ request: async (key, call, options) => {
    calls++; assert.equal(key, WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY)
    assert.equal(JSON.stringify(call.param), '{"login_uin":42,"host_uin":42,"disstid":77}')
    assert.equal(Object.hasOwn(call.param, 'dirid'), false)
    assert.equal(options.signal, signal)
    return data()
  } }, { signal })
  assert.equal(result.playlistId, 'qq:playlist:0:77')
  assert.equal(result.detail.complete, true); assert.equal(result.detail.total, 1)
  assert.equal(result.detail.tracks.length, 1); assert.equal(result.detail.media.length, 1)
  assert.equal(JSON.stringify(result).includes(marker), false); assert.equal(calls, 1)
})

test('provided signed64 IDs and UInt64 response identities remain lossless, including explicit zero without a default', async () => {
  const host = '18446744073709551615', id = '9223372036854775807'
  const result = await resolve({ request: async () => data(id, host) }, { disstid: id })
  assert.equal(result.playlistId, `qq:playlist:${host}:${id}`)
  assert.equal((await resolve({ request: async () => data('0') }, { disstid: '0' })).playlistId, 'qq:playlist:0:0')
  let calls = 0
  for (const extra of [{ loginUin: '0' }, { loginUin: undefined }, { loginUin: Number.MAX_SAFE_INTEGER + 1 },
    { disstid: undefined }, { disstid: '' }, { disstid: '77\n' }, { disstid: '9223372036854775808' },
    { disstid: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(resolve({ request: async () => { calls++; return data() } }, extra))
  }
  assert.equal(calls, 0)
})

test('reply binds requested ID and actual host to creator.musicid and requires complete existing strict detail', async () => {
  for (const mutate of [value => { value.dirinfo.id = '78' }, value => { value.dirinfo.creator.musicid = '42' },
    value => { delete value.dirinfo.host_uin }, value => { delete value.dirinfo.creator.musicid },
    value => { value.dirinfo.host_uin = Number.MAX_SAFE_INTEGER + 1 }, value => { value.dirinfo.creator.musicid = '' },
    value => { value.total_song_num = 2 }, value => { value.songlist[0].file = {} },
    value => { value.songlist = Array(1) }, value => { value.code = '0' }, value => { delete value.subcode }]) {
    const changed = data(); mutate(changed)
    await assert.rejects(resolve({ request: async () => changed }))
  }
  for (const field of ['code', 'subcode']) await assert.rejects(resolve({ request: async () => ({ ...data(), [field]: 22 }) }),
    error => error.code === 22 && !error.message.includes(marker))
})

test('response identity/status accessors are snapshotted once before strict owned projection', async () => {
  const value = data(), reads = new Map()
  for (const [object, field, expected] of [[value, 'code', 0], [value, 'subcode', 0], [value.dirinfo, 'id', '77'],
    [value.dirinfo, 'host_uin', '0'], [value.dirinfo.creator, 'musicid', '0']]) {
    Object.defineProperty(object, field, { get: () => {
      reads.set(field, (reads.get(field) ?? 0) + 1)
      if (reads.get(field) > 1) throw new Error(marker)
      return expected
    } })
  }
  assert.equal((await resolve({ request: async () => value })).playlistId, 'qq:playlist:0:77')
  assert.deepEqual([...reads.values()], [1, 1, 1, 1, 1])
  const throwing = Object.defineProperty({}, 'dirinfo', { get() { throw new Error(marker) } })
  Object.assign(throwing, { code: 0, subcode: 0 })
  await assert.rejects(resolve({ request: async () => throwing }), error => error.code === 'REQUEST' && !error.message.includes(marker))
})

test('external mutable/name/getter errors remain generic and genuine RPC code is snapshotted once', async () => {
  let owned
  try { await resolve({ request: async () => data() }, { loginUin: '0' }) } catch (error) { owned = error }
  owned.message = marker; owned.code = marker
  const nameGetter = Object.defineProperty({}, 'name', { get() { throw new Error(marker) } })
  for (const raw of [owned, nameGetter, new Error(marker), Object.assign(new Error(marker), { name: 'WindowsPlaylistBindingError' })]) {
    await assert.rejects(resolve({ request: async () => { throw raw } }), error =>
      error !== raw && !error.message.includes(marker) && !String(error.code).includes(marker))
  }
  const changing = new WindowsRpcError(22); let reads = 0
  Object.defineProperty(changing, 'code', { get: () => ++reads === 1 ? 22 : marker })
  await assert.rejects(resolve({ request: async () => { throw changing } }), error => error.code === 22 && !error.message.includes(marker))
  assert.equal(reads, 1)
})

test('preabort, late abort and external AbortError discard the reply without retries', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0
  await assert.rejects(resolve({ request: async () => { calls++; return data() } }, { signal: controller.signal }),
    error => error.name === 'AbortError')
  assert.equal(calls, 0)
  const late = new AbortController()
  await assert.rejects(resolve({ request: async () => { calls++; late.abort(); return data() } }, { signal: late.signal }),
    error => error.name === 'AbortError')
  assert.equal(calls, 1)
  await assert.rejects(resolve({ request: async () => { throw Object.assign(new Error(marker), { name: 'AbortError' }) } }),
    error => error.name === 'AbortError' && !error.message.includes(marker))
})
