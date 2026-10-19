import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { activate, deactivate } from './windows-index.mjs'

const publicFixture = JSON.parse(readFileSync(new URL('./test/fixtures/windows-public-search-songs.json', import.meta.url)))
const publicSong = publicFixture.publicSongs[0]
const localId = `${publicSong.mid}:${publicSong.id}`
const canonicalId = `qq:${localId}`
const DIRECTORY_NAME = '精确的 synthetic fixture directory ✓'
const ADD = 'music.musicasset.PlaylistDetailWrite.AddSonglist'
const DEL = 'music.musicasset.PlaylistDetailWrite.DelSonglist'
const CREATED = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin'
const FAVORITE_LISTS = 'music.musicasset.PlaylistFavRead'
const DETAIL = 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo'
const platform = { skip: process.platform !== 'win32' }
const fixtureSession = () => ({ openid: 'public-fixture-openid', access_token: 'public-fixture-access',
  refresh_token: 'public-fixture-refresh', musickey: 'public-fixture-key', unionid: '', refresh_key: '',
  encryptUin: '', musicid: 123, musickeyCreateTime: 1,
  expired_at: Math.floor(Date.now() / 1000) + 3600, loginType: 2 })

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

function harness({ initialLiked = false } = {}) {
  let provider
  const storage = new Map([['windows-auth', fixtureSession()]])
  const members = new Set(initialLiked ? [Number(publicSong.id)] : [])
  const stats = { writes: [], details: 0, tracks: 0, created: 0 }
  const hooks = {}
  const context = { settings: {
    get: async key => storage.get(key), set: async (key, value) => { storage.set(key, value) },
    delete: async key => { storage.delete(key) }
  }, twilight: { providers: { register: async value => { provider = value } },
    qqAuth: { clear: async () => {} },
    ui: { register: async () => {}, onCommand: () => () => {} }
  } }
  const fetch = async (_url, options) => {
    assert.equal(options.method, 'POST')
    assert.equal(typeof options.headers.Sign, 'string')
    assert.equal(typeof options.headers.Mask, 'string')
    const request = JSON.parse(options.body.toString())
    const key = Object.keys(request).find(value => value !== 'comm')
    const call = request[key]
    let data
    if (key === 'music.login.LoginServer.Login') data = storage.get('windows-auth')
    else if (key === CREATED) {
      stats.created++
      data = { total: 1, bFinish: true, v_delTid: [], v_playlist: [{
        uin: String(request.comm.uin), tid: 99, dirId: 201, dirName: DIRECTORY_NAME,
        songNum: members.size, bigpicUrl: '', picUrl: '', nick: '' }] }
    } else if (key === FAVORITE_LISTS) {
      data = { number: 0, total: 0, hasmore: 0, hide: false, v_list: [], v_delTids: [], v_failTids: [] }
    } else if (key === DETAIL) {
      stats.details++
      assert.deepEqual(call.param, { login_uin: 123, dirid: 201, host_uin: 123, disstid: 99 })
      data = { code: 0, subcode: 0, dirinfo: { id: 99, host_uin: 0, dirid: 201 },
        total_song_num: members.size,
        songlist: members.has(Number(publicSong.id)) ? [structuredClone(publicSong)] : [] }
    } else if (key === 'Protocol_UpdateSongInfo') {
      stats.tracks++
      assert.deepEqual(call.param, { ids: [Number(publicSong.id)], types: [0], ctx: 0, scene: 0 })
      data = { tracks: [structuredClone(publicSong)] }
    } else if (key === ADD || key === DEL) {
      assert.equal(request.comm.uin, '123')
      assert.equal(call.module, 'music.musicasset.PlaylistDetailWrite')
      assert.equal(call.method, key === ADD ? 'AddSonglist' : 'DelSonglist')
      assert.deepEqual(call.param, { dirId: 201, dirName: DIRECTORY_NAME, tid: 99, bFmtUtf8: true,
        v_songInfo: [{ songType: 0, songId: Number(publicSong.id) }] })
      stats.writes.push({ key, call })
      if (!hooks.ignoreMutation) {
        if (key === ADD) members.add(Number(publicSong.id))
        else members.delete(Number(publicSong.id))
      }
      data = key === ADD ? { msg: '', result: { dirId: '201', tid: '99', updateTime: 1,
        songlist: [{ backendSongId: Number(publicSong.id), songType: 0, loc: 0 }] } } : { msg: '' }
    } else throw new Error('Unexpected synthetic favorite RPC')
    const changed = await hooks.reply?.(request, key, data)
    return new Response(JSON.stringify({ code: 0, [key]: { code: 0, data: changed ?? data } }))
  }
  return { context, storage, members, stats, hooks, fetch, get provider() { return provider } }
}

async function usingProvider(h, operation) {
  const original = globalThis.fetch
  globalThis.fetch = h.fetch
  try { await activate(h.context); return await operation(h.provider) }
  finally { await deactivate(); globalThis.fetch = original }
}

test('registered favorite methods accept stripped SDK IDs and send one exact Add/Del with idempotent checks', platform, async () => {
  const h = harness()
  await usingProvider(h, async provider => {
    assert.equal(typeof provider.likeTrack, 'function')
    assert.equal(typeof provider.isTrackLiked, 'function')
    assert.equal(await provider.isTrackLiked(localId, {}), false)
    await provider.likeTrack(localId, true, {})
    assert.equal(await provider.isTrackLiked(canonicalId, {}), true)
    await provider.likeTrack(canonicalId, true, {})
    assert.equal(h.stats.writes.length, 1)
    await provider.likeTrack(localId, false, {})
    assert.equal(await provider.isTrackLiked(localId, {}), false)
    await provider.likeTrack(canonicalId, false, {})
    assert.deepEqual(h.stats.writes.map(value => value.key), [ADD, DEL])
    assert.equal(h.stats.tracks, 2)
  })
})

test('malformed or mismatched native Add acknowledgements reject despite business code zero', platform, async () => {
  for (const change of [result => { result.dirId = '202' }, result => { result.tid = '100' },
    result => { result.songlist = [] }, result => { result.songlist[0].loc = 1 },
    result => { result.songlist[0].backendSongId = Number(publicSong.id) + 1 }]) {
    const h = harness()
    h.hooks.reply = (_request, key, data) => { if (key === ADD) change(data.result) }
    await usingProvider(h, async provider => {
      await assert.rejects(provider.likeTrack(localId, true, {}), /收藏响应无效/)
      assert.equal(h.stats.writes.length, 1)
      // The server may have changed despite the malformed acknowledgement.
      assert.equal(await provider.isTrackLiked(localId, {}), true)
      await provider.likeTrack(localId, true, {})
      assert.equal(h.stats.writes.length, 1)
    })
  }
})

test('write code zero without a confirmed fresh membership never reports success', platform, async () => {
  const h = harness()
  h.hooks.ignoreMutation = true
  await usingProvider(h, async provider => {
    await assert.rejects(provider.likeTrack(localId, true, {}), /尚未确认/)
    assert.equal(h.stats.writes.length, 1)
    assert.equal(await provider.isTrackLiked(localId, {}), false)
  })
})

test('unverified directory owners, another directory and incomplete snapshots never reach writes', platform, async () => {
  for (const change of [data => { data.v_playlist[0].uin = '456' },
    data => { data.v_playlist[0].dirId = 200 }, data => { data.bFinish = false }]) {
    const h = harness()
    h.hooks.reply = (_request, key, data) => { if (key === CREATED) change(data) }
    await usingProvider(h, async provider => {
      await assert.rejects(provider.likeTrack(localId, true, {}))
      assert.equal(h.stats.writes.length, 0)
      assert.equal(h.stats.tracks, 0)
    })
  }
})

test('fresh scene0 SongInfo server type gates the mutation instead of cached playlist metadata', platform, async () => {
  const h = harness()
  h.hooks.reply = (_request, key, data) => { if (key === 'Protocol_UpdateSongInfo') data.tracks[0].type = 1 }
  await usingProvider(h, async provider => {
    await assert.rejects(provider.likeTrack(localId, true, {}), /尚不支持修改喜欢状态/)
    assert.equal(h.stats.tracks, 1)
    assert.equal(h.stats.writes.length, 0)
  })
})

test('logout and same-account token replacement reject late reads and cannot resurrect a cached state', platform, async () => {
  for (const action of ['logout', 'same-account-token']) {
    const h = harness({ initialLiked: true })
    const entered = deferred(), release = deferred()
    h.hooks.reply = async (_request, key) => { if (key === DETAIL) { entered.resolve(); await release.promise } }
    await usingProvider(h, async provider => {
      const pending = provider.isTrackLiked(localId, {})
      const rejected = assert.rejects(pending)
      await entered.promise
      if (action === 'logout') await provider.logout({})
      else h.storage.set('windows-auth', { ...h.storage.get('windows-auth'), musickey: 'public-fixture-replaced-key' })
      release.resolve()
      await rejected
      delete h.hooks.reply
      h.members.clear()
      if (action === 'logout') await assert.rejects(provider.isTrackLiked(localId, {}), /请先扫码登录/)
      else assert.equal(await provider.isTrackLiked(localId, {}), false)
      assert.equal(h.stats.writes.length, 0)
    })
  }
})

test('logout and same-account token replacement reject a late write result without replay', platform, async () => {
  for (const action of ['logout', 'same-account-token']) {
    const h = harness()
    const entered = deferred(), release = deferred()
    h.hooks.reply = async (_request, key) => { if (key === ADD) { entered.resolve(); await release.promise } }
    await usingProvider(h, async provider => {
      const pending = provider.likeTrack(localId, true, {})
      const rejected = assert.rejects(pending)
      await entered.promise
      if (action === 'logout') await provider.logout({})
      else h.storage.set('windows-auth', { ...h.storage.get('windows-auth'), musickey: 'public-fixture-replaced-key' })
      release.resolve()
      await rejected
      delete h.hooks.reply
      assert.equal(h.stats.writes.length, 1)
      if (action === 'same-account-token') {
        assert.equal(await provider.isTrackLiked(localId, {}), true)
        await provider.likeTrack(localId, true, {})
        assert.equal(h.stats.writes.length, 1)
      }
    })
  }
})
