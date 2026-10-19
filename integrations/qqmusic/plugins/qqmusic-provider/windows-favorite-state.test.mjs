import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWindowsFavoriteMethods } from './lib/windows/favorite-state.mjs'

const song = 'qq:00000000000001:42'
const other = 'qq:00000000000002:43'
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function abort() { const error = new Error('Canceled fixture'); error.name = 'AbortError'; return error }
function fixture(initial = []) {
  let key = 'fixture-owner:first-token'
  let clock = 0
  const libraries = new Map([[key, new Set(initial)]])
  const stats = { reads: 0, writes: [], owners: [] }
  const hooks = {}
  const service = createWindowsFavoriteMethods({
    getOwner: async signal => {
      if (signal?.aborted) throw abort()
      const owner = { key }
      stats.owners.push(owner)
      return owner
    },
    assertOwner: async (owner, signal) => { if (owner.key !== key || signal?.aborted) throw abort() },
    readSnapshot: async (owner, signal) => {
      stats.reads++
      if (hooks.read) await hooks.read(owner, signal)
      return { playlist: { id: 'verified-directory-fixture', name: '我喜欢' },
        trackIds: [...libraries.get(owner.key)] }
    },
    write: async (id, liked, snapshot, owner, signal) => {
      stats.writes.push({ id, liked, owner: owner.key })
      if (hooks.write) return hooks.write(id, liked, snapshot, owner, signal)
      liked ? libraries.get(owner.key).add(id) : libraries.get(owner.key).delete(id)
    },
    now: () => clock
  })
  return { service, stats, hooks, libraries,
    get members() { return libraries.get(key) },
    setTime(value) { clock = value },
    setOwner(next, ids = []) { key = next; libraries.set(next, new Set(ids)) }
  }
}

test('membership comes from the complete snapshot and cache expires at 60 seconds', async () => {
  const f = fixture([song])
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(await f.service.isTrackLiked(other), false)
  assert.equal(f.stats.reads, 1)
  f.members.delete(song)
  f.setTime(59999)
  assert.equal(await f.service.isTrackLiked(song), true)
  f.setTime(60000)
  assert.equal(await f.service.isTrackLiked(song), false)
  assert.equal(f.stats.reads, 2)
})

test('account changes and same-account token changes cannot reuse another session snapshot', async () => {
  const f = fixture([song])
  assert.equal(await f.service.isTrackLiked(song), true)
  f.setOwner('fixture-owner:second-token', [])
  assert.equal(await f.service.isTrackLiked(song), false)
  f.setOwner('fixture-other-owner:first-token', [other])
  assert.equal(await f.service.isTrackLiked(song), false)
  assert.equal(await f.service.isTrackLiked(other), true)
  assert.equal(f.stats.reads, 3)
})

test('writes refresh before checking idempotence even when the cache says otherwise', async () => {
  const f = fixture()
  assert.equal(await f.service.isTrackLiked(song), false)
  f.members.add(song)
  assert.equal(await f.service.likeTrack(song, true), true)
  assert.equal(f.stats.writes.length, 0)
  assert.equal(f.stats.reads, 2)
  assert.equal(await f.service.likeTrack(other, false), false)
  assert.equal(f.stats.writes.length, 0)
})

test('writes confirm a fresh snapshot before publishing the new membership', async () => {
  const f = fixture()
  assert.equal(await f.service.likeTrack(song, true), true)
  assert.equal(f.stats.writes.length, 1)
  assert.equal(f.stats.reads, 2)
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(f.stats.reads, 2)
  assert.equal(await f.service.likeTrack(song, false), false)
  assert.equal(await f.service.isTrackLiked(song), false)
  assert.deepEqual(f.stats.writes.map(value => value.liked), [true, false])
})

test('queued toggles serialize and reads wait for the latest queued result', async () => {
  const f = fixture()
  const entered = deferred(), release = deferred()
  f.hooks.write = async (id, liked, snapshot, owner) => {
    assert.equal(snapshot.playlist.id, 'verified-directory-fixture')
    if (f.stats.writes.length === 1) { entered.resolve(); await release.promise }
    liked ? f.libraries.get(owner.key).add(id) : f.libraries.get(owner.key).delete(id)
  }
  const add = f.service.likeTrack(song, true)
  await entered.promise
  const remove = f.service.likeTrack(song, false)
  const read = f.service.isTrackLiked(song)
  assert.equal(f.stats.writes.length, 1)
  release.resolve()
  assert.deepEqual(await Promise.all([add, remove, read]), [true, false, false])
  assert.deepEqual(f.stats.writes.map(value => value.liked), [true, false])
})

test('unknown write outcome invalidates the cache without automatic replay', async () => {
  const f = fixture()
  f.hooks.write = async (id, liked, snapshot, owner) => {
    f.libraries.get(owner.key).add(id)
    throw new Error('Unknown fixture outcome')
  }
  await assert.rejects(f.service.likeTrack(song, true), /Unknown fixture outcome/)
  assert.equal(f.stats.writes.length, 1)
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(await f.service.likeTrack(song, true), true)
  assert.equal(f.stats.writes.length, 1)
})

test('an acknowledgement with unchanged membership is rejected and is never cached as liked', async () => {
  const f = fixture()
  f.hooks.write = async () => undefined
  await assert.rejects(f.service.likeTrack(song, true), /尚未确认/)
  assert.equal(f.stats.writes.length, 1)
  assert.equal(await f.service.isTrackLiked(song), false)
  assert.equal(f.stats.reads, 3)
})

test('cancel after mutation may leave a server change but never replays or optimistically caches it', async () => {
  const f = fixture()
  const entered = deferred(), release = deferred()
  f.hooks.write = async (id, liked, snapshot, owner) => {
    entered.resolve()
    await release.promise
    f.libraries.get(owner.key).add(id)
  }
  const controller = new AbortController()
  const mutation = f.service.likeTrack(song, true, { signal: controller.signal })
  await entered.promise
  controller.abort()
  await assert.rejects(mutation, { name: 'AbortError' })
  release.resolve()
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(f.stats.writes.length, 1)
})

test('canceling a queued caller does not cancel the preceding write or a later caller', async () => {
  const f = fixture()
  const entered = deferred(), release = deferred()
  f.hooks.write = async (id, liked, snapshot, owner) => {
    if (f.stats.writes.length === 1) { entered.resolve(); await release.promise }
    liked ? f.libraries.get(owner.key).add(id) : f.libraries.get(owner.key).delete(id)
  }
  const first = f.service.likeTrack(song, true)
  await entered.promise
  const controller = new AbortController()
  const queued = f.service.likeTrack(other, true, { signal: controller.signal })
  controller.abort()
  await assert.rejects(queued, { name: 'AbortError' })
  release.resolve()
  assert.equal(await first, true)
  assert.equal(await f.service.likeTrack(song, false), false)
  assert.deepEqual(f.stats.writes.map(value => value.id), [song, song])
})

test('one canceled independent read cannot abort another caller', async () => {
  const f = fixture([song])
  const entered = deferred(), release = deferred()
  f.hooks.read = async () => {
    if (f.stats.reads === 1) { entered.resolve(); await release.promise }
  }
  const controller = new AbortController()
  const first = f.service.isTrackLiked(song, { signal: controller.signal })
  await entered.promise
  const second = f.service.isTrackLiked(song)
  controller.abort()
  assert.equal(await second, true)
  release.resolve()
  await assert.rejects(first, { name: 'AbortError' })
})

test('a queued old-session intent is rejected after an account change', async () => {
  const f = fixture()
  const entered = deferred(), release = deferred()
  f.hooks.write = async (id, liked, snapshot, owner) => {
    entered.resolve()
    await release.promise
    f.libraries.get(owner.key).add(id)
  }
  const first = f.service.likeTrack(song, true)
  await entered.promise
  const queued = f.service.likeTrack(other, true)
  const firstRejected = assert.rejects(first, { name: 'AbortError' })
  const queuedRejected = assert.rejects(queued, { name: 'AbortError' })
  f.setOwner('new-account:token', [])
  release.resolve()
  await Promise.all([firstRejected, queuedRejected])
  assert.equal(f.stats.writes.length, 1)
  assert.equal(f.members.has(song), false)
  assert.equal(f.members.has(other), false)
  assert.equal(await f.service.isTrackLiked(song), false)
})

test('invalidate and dispose reject late results and prevent cache resurrection', async () => {
  for (const action of ['invalidate', 'dispose']) {
    const f = fixture([song])
    const entered = deferred(), release = deferred()
    f.hooks.read = async () => { entered.resolve(); await release.promise }
    const read = f.service.isTrackLiked(song)
    await entered.promise
    f.service[action]()
    release.resolve()
    await assert.rejects(read, { name: 'AbortError' })
    delete f.hooks.read
    if (action === 'dispose') {
      await assert.rejects(f.service.isTrackLiked(song), { name: 'AbortError' })
      await assert.rejects(f.service.likeTrack(song, true), { name: 'AbortError' })
      assert.equal(f.stats.writes.length, 0)
    } else {
      assert.equal(await f.service.isTrackLiked(song), true)
      assert.equal(f.stats.reads, 2)
    }
  }
})

test('failed reads prevent writes, and a rejected task releases the write queue', async () => {
  const f = fixture()
  f.hooks.read = async () => { throw new Error('Snapshot fixture failed') }
  await assert.rejects(f.service.likeTrack(song, true), /Snapshot fixture failed/)
  assert.equal(f.stats.writes.length, 0)
  delete f.hooks.read
  assert.equal(await f.service.likeTrack(song, true), true)
  assert.equal(f.stats.writes.length, 1)
})

test('a read started before a mutation cannot publish or cache its earlier membership', async () => {
  const f = fixture()
  const entered = deferred(), release = deferred()
  f.hooks.read = async () => {
    if (f.stats.reads === 1) { entered.resolve(); await release.promise }
  }
  const early = f.service.isTrackLiked(song)
  await entered.promise
  assert.equal(await f.service.likeTrack(song, true), true)
  release.resolve()
  await assert.rejects(early, { name: 'AbortError' })
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(f.stats.writes.length, 1)
})

test('failed post-write verification is an unknown result and is never automatically replayed', async () => {
  const f = fixture()
  f.hooks.read = async () => { if (f.stats.reads === 2) throw new Error('Verification fixture failed') }
  await assert.rejects(f.service.likeTrack(song, true), /Verification fixture failed/)
  assert.equal(f.stats.writes.length, 1)
  delete f.hooks.read
  assert.equal(await f.service.isTrackLiked(song), true)
  assert.equal(await f.service.likeTrack(song, true), true)
  assert.equal(f.stats.writes.length, 1)
})
