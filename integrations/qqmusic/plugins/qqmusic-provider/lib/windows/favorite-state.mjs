const SNAPSHOT_TTL_MS = 60000
const MAX_TRACKS = 100000

function canceled() {
  const error = new Error('QQ 音乐收藏请求已取消')
  error.name = 'AbortError'
  return error
}

function trackId(value) {
  // Canonical provider identities are resolved by the existing provider owner.
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\0')) {
    throw new TypeError('Favorite state requires a canonical track identity')
  }
  return value
}

function waitFor(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(canceled())
  return new Promise((resolve, reject) => {
    const cancel = () => reject(canceled())
    signal.addEventListener('abort', cancel, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}

/**
 * Owns only an in-memory snapshot and a write queue. Authentication, full
 * session fingerprints, canonical song IDs, directory verification and RPCs
 * remain with the supplied provider callbacks. Writes are never retried.
 */
export function createWindowsFavoriteMethods({ getOwner, assertOwner, readSnapshot, write, now = Date.now } = {}) {
  if ([getOwner, assertOwner, readSnapshot, write, now].some(value => typeof value !== 'function')) {
    throw new TypeError('Favorite state requires provider-owned callbacks')
  }
  let closed = false
  let lifecycle = 0
  let cacheRevision = 0
  let mutationRevision = 0
  let currentKey = null
  let cache = null
  let writes = Promise.resolve()

  function clearCache() { cache = null; cacheRevision++ }
  function guard(signal, version) {
    if (closed || lifecycle !== version || signal?.aborted) throw canceled()
  }
  async function check(owner, signal, version) {
    guard(signal, version)
    await assertOwner(owner, signal)
    guard(signal, version)
  }
  async function ownerFor(signal, version) {
    guard(signal, version)
    const owner = await getOwner(signal)
    if (!owner || typeof owner.key !== 'string' || owner.key.length === 0) {
      throw new Error('QQ 音乐收藏会话无效')
    }
    await check(owner, signal, version)
    return owner
  }
  function selectOwner(owner) {
    if (owner.key !== currentKey) { clearCache(); currentKey = owner.key }
  }
  function time() {
    const value = now()
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('QQ 音乐收藏缓存时间无效')
    return value
  }
  async function fresh(owner, signal, version) {
    const revision = cacheRevision
    const mutation = mutationRevision
    const value = await readSnapshot(owner, signal)
    await check(owner, signal, version)
    if (mutation !== mutationRevision) throw canceled()
    if (!value || !value.playlist || typeof value.playlist !== 'object' || Array.isArray(value.playlist) ||
        !Array.isArray(value.trackIds) || value.trackIds.length > MAX_TRACKS) {
      throw new Error('QQ 音乐收藏快照无效')
    }
    const snapshot = { playlist: { ...value.playlist }, trackIds: Array.from(value.trackIds, trackId) }
    const entry = { key: owner.key, snapshot, ids: new Set(snapshot.trackIds), at: time() }
    if (revision === cacheRevision && currentKey === owner.key) cache = entry
    return entry
  }

  async function isTrackLiked(id, context = {}) {
    trackId(id)
    const signal = context?.signal
    const version = lifecycle
    try {
      const owner = await ownerFor(signal, version)
      for (;;) {
        const barrier = writes
        await waitFor(barrier, signal)
        await check(owner, signal, version)
        if (barrier === writes) break
      }
      const mutation = mutationRevision
      selectOwner(owner)
      const age = cache ? time() - cache.at : -1
      const entry = cache?.key === owner.key && age >= 0 && age < SNAPSHOT_TTL_MS
        ? cache : await fresh(owner, signal, version)
      await check(owner, signal, version)
      // A new mutation may have started while this independent read was active.
      if (mutation !== mutationRevision) throw canceled()
      return entry.ids.has(id)
    } catch (error) {
      clearCache()
      throw error
    }
  }

  function likeTrack(id, liked, context = {}) {
    try { trackId(id) } catch (error) { return Promise.reject(error) }
    if (typeof liked !== 'boolean') return Promise.reject(new TypeError('liked must be a boolean'))
    const signal = context?.signal
    const version = lifecycle
    // Bind the invocation before queueing, so an old account's queued intent
    // cannot be applied to the account that happens to own the later slot.
    const ownerReady = ownerFor(signal, version)
    ownerReady.catch(() => {})
    clearCache()
    const task = writes.then(async () => {
      try {
        const owner = await ownerReady
        await check(owner, signal, version)
        selectOwner(owner)
        mutationRevision++
        clearCache()
        const before = await fresh(owner, signal, version)
        if (before.ids.has(id) === liked) return liked
        await check(owner, signal, version)
        clearCache()
        await write(id, liked, before.snapshot, owner, signal)
        await check(owner, signal, version)
        // A returned write acknowledgement never substitutes for membership.
        clearCache()
        const after = await fresh(owner, signal, version)
        if (after.ids.has(id) !== liked) throw new Error('QQ 音乐收藏状态尚未确认，请刷新后重试')
        return liked
      } catch (error) {
        clearCache()
        throw error
      }
    })
    // Rejection must release the queue without replaying the failed mutation.
    writes = task.catch(() => {})
    return waitFor(task, signal)
  }

  function invalidate() {
    lifecycle++
    mutationRevision++
    currentKey = null
    clearCache()
  }
  function dispose() { closed = true; invalidate() }
  return Object.freeze({ isTrackLiked, likeTrack, invalidate, dispose })
}
