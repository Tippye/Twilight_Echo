import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsDiscoveryFeedCall, buildWindowsDiscoveryTabsCall,
  buildWindowsCategoryContentCall, buildWindowsCategoryBasicCall, buildWindowsCategoryCursorCall,
  buildWindowsDiscoveryAllTagsCall, createWindowsDiscoveryMethods, decodeWindowsDiscoveryTaxonomy,
  decodeWindowsDiscoveryFeedPage, decodeWindowsCategoryContentPage, WINDOWS_DISCOVERY_POLICY,
  WINDOWS_DISCOVERY_FEED_REQUEST_KEY, WINDOWS_DISCOVERY_TABS_REQUEST_KEY,
  WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, WINDOWS_CATEGORY_BASIC_REQUEST_KEY,
  WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY,
  WINDOWS_EMBEDDED_DISCOVERY_PROVENANCE } from './lib/windows/discovery-call.mjs'
import { WindowsRpcError } from './lib/windows/response.mjs'

test('Square literal calls keep source booleans/numbers, no sort/category/total assumption and fresh nested ownership', () => {
  const feed = buildWindowsDiscoveryFeedCall(), tabs = buildWindowsDiscoveryTabsCall()
  assert.equal(WINDOWS_DISCOVERY_FEED_REQUEST_KEY, `${feed.module}.${feed.method}`)
  assert.equal(WINDOWS_DISCOVERY_TABS_REQUEST_KEY, `${tabs.module}.${tabs.method}`)
  assert.deepEqual(feed.param, { IsReqHead: false, IsReqFeed: true, FeedReq: { From: 0, Size: 60 } })
  assert.deepEqual(tabs.param, {})
  feed.param.FeedReq.From = 30; tabs.param.guessed = 1
  assert.deepEqual(buildWindowsDiscoveryFeedCall().param.FeedReq, { From: 0, Size: 60 })
  assert.deepEqual(buildWindowsDiscoveryTabsCall().param, {})
  assert.equal(WINDOWS_EMBEDDED_DISCOVERY_PROVENANCE.nativeClientTransport, 'compatibility-accepted-public-discovery-rpc')
  assert.ok(Object.isFrozen(WINDOWS_EMBEDDED_DISCOVERY_PROVENANCE))
})

// Entirely artificial public records: no real user IDs, titles or responses.
function basic(id) {
  return { tid: id, title: `公开歌单${id}`, creator: { uin: '', nick: '公开作者' },
    cover: { medium_url: 'https://example.org/cover.png' }, song_cnt: 2 }
}
function taxonomy() {
  return { v_group: [
    { group_id: 99, group_name: '最近常用', v_item: [{ id: 3419, name: '私藏', source: 0 }, { id: 27, name: '睡前', source: 0 }] },
    { group_id: 88, group_name: '热门', v_item: [{ id: 3417, name: '私藏', source: 0 }, { id: 9527, name: 'AI歌单', source: 1 }] },
    { group_id: 77, group_name: '场景', v_item: [{ id: 27, name: '睡前', source: 0 }] }
  ] }
}
function feed(from, { length = 30, hasMore = from !== 30 } = {}) {
  return { FeedRsp: { FromLimit: 400, HasMore: hasMore,
    List: Array.from({ length }, (_, index) => ({ Playlist: { basic: basic(1000 + from + index) } })) } }
}
function categoryPage(page, { total = 504 } = {}) {
  const length = Math.min(30, Math.max(0, total - page * 30))
  return { retcode: 0, content: { total_cnt: total,
    v_item: Array.from({ length }, (_, index) => ({ basic: basic(2000 + page * 30 + index) })) } }
}
function binding({ disstid }) { return { playlistId: `qq:playlist:0:${disstid}`, detail: { total: 2 } } }
function methods(overrides = {}) {
  const calls = [], bindings = []
  const client = { async request(key, call, options) {
    calls.push({ key, call, options })
    if (key === WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY) return taxonomy()
    if (key === WINDOWS_DISCOVERY_FEED_REQUEST_KEY) return feed(call.param.FeedReq.From)
    if (key === WINDOWS_CATEGORY_CONTENT_REQUEST_KEY) return categoryPage(call.param.page)
    throw new Error('Unexpected test RPC')
  } }
  const resolveBinding = async input => { bindings.push(input); return binding(input) }
  return { calls, bindings, ...createWindowsDiscoveryMethods({ client, resolveBinding, ...overrides }) }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const generic = error => error.message === 'QQ 音乐发现数据无法验证' && !JSON.stringify(error).includes('PUBLIC_RAW_PROVIDER_MESSAGE')

test('new taxonomy body and explicit page bodies are exact, while the five original defaults remain unchanged', () => {
  const all = buildWindowsDiscoveryAllTagsCall()
  assert.equal(WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY, `${all.module}.${all.method}`)
  assert.deepEqual(all.param, { qq: '' })
  all.param.qq = 'mutation'
  assert.deepEqual(buildWindowsDiscoveryAllTagsCall().param, { qq: '' })
  assert.deepEqual(buildWindowsDiscoveryFeedCall({ from: 60, size: 30 }).param,
    { IsReqHead: false, IsReqFeed: true, FeedReq: { From: 60, Size: 30 } })
  assert.deepEqual(buildWindowsCategoryContentCall({ categoryId: 27, caller: '77', page: 2, size: 30 }).param,
    { caller: '77', category_id: 27, page: 2, use_page: 1, size: 30 })
  for (const size of [0, 1, 31, 61, '30', Infinity]) {
    assert.throws(() => buildWindowsDiscoveryFeedCall({ size }))
    assert.throws(() => buildWindowsCategoryContentCall({ categoryId: 27, size }))
  }
  for (const page of [-1, 1.1, '1', 1000000]) assert.throws(() => buildWindowsCategoryContentCall({ categoryId: 27, page }))
  for (const from of [-1, 1.1, '30', 1000061]) assert.throws(() => buildWindowsDiscoveryFeedCall({ from }))
})

test('taxonomy source0, array-index group keys and deterministic ambiguous labels do not invent hot tags', () => {
  const result = decodeWindowsDiscoveryTaxonomy(taxonomy())
  assert.deepEqual(result.catalogue, { hotTags: [], groups: [
    { id: 0, name: '最近常用', tags: [{ name: '私藏（最近常用）', hot: false }, { name: '睡前', hot: false }] },
    { id: 1, name: '热门', tags: [{ name: '私藏（热门）', hot: false }] },
    { id: 2, name: '场景', tags: [{ name: '睡前', hot: false }] }
  ] })
  assert.equal(result.categoryIds.get('私藏（最近常用）'), 3419)
  assert.equal(result.categoryIds.get('私藏（热门）'), 3417)
  assert.equal(result.categoryIds.get('睡前'), 27)
  assert.equal(result.categoryIds.has('私藏'), false)
  assert.equal(result.categoryIds.has('AI歌单'), false)
  assert.equal(WINDOWS_DISCOVERY_POLICY.groupKey, 'source-ui-array-index')
  assert.equal(WINDOWS_DISCOVERY_POLICY.supportsSort, false)
})

test('taxonomy validates excluded AI rows, duplicates, source types, sparse arrays, bounds and conflicting identities', () => {
  const mutations = [
    data => { data.v_group[1].v_item[1].id = 0 },
    data => { data.v_group[1].v_item[1].name = '' },
    data => { delete data.v_group[0].v_item[0].source },
    data => { data.v_group[0].v_item[0].tag = true },
    data => { data.v_group[0].v_item.push({ id: 27, name: '睡前', source: 0 }) },
    data => { data.v_group[2].v_item[0].name = '不同名称' },
    data => { data.v_group[0].v_item = new Array(1) },
    data => { data.v_group = new Array(1) },
    data => { data.v_group[0].group_name = '' },
    data => { data.v_group[0].v_item[0].name = '全部' }
  ]
  for (const mutate of mutations) { const data = taxonomy(); mutate(data); assert.throws(() => decodeWindowsDiscoveryTaxonomy(data), generic) }
  assert.throws(() => decodeWindowsDiscoveryTaxonomy({ v_group: Array.from({ length: 33 }, () => taxonomy().v_group[0]) }), generic)
  const tooMany = taxonomy(); tooMany.v_group[0].v_item = Array.from({ length: 2049 }, (_, id) => ({ id: id + 1, name: `标签${id}`, source: 0 }))
  assert.throws(() => decodeWindowsDiscoveryTaxonomy(tooMany), generic)
})

test('taxonomy second-order label collisions receive stable numeric suffixes without mapping one label to two IDs', () => {
  const data = { v_group: [{ group_name: 'A', v_item: [
    { id: 1, name: '相同', source: 0 }, { id: 2, name: '相同', source: 0 }, { id: 3, name: '相同（A）', source: 0 }
  ] }] }
  const result = decodeWindowsDiscoveryTaxonomy(data)
  assert.deepEqual(result.catalogue.groups[0].tags.map(tag => tag.name), ['相同（A） [1]', '相同（A） [2]', '相同（A） [3]'])
  assert.equal(result.categoryIds.size, 3)
})

test('SDK catalogue returns only display fields, and named categories rebuild a cold deterministic mapping', async () => {
  const api = methods()
  const catalogue = await api.fetchPlaylistCategories()
  catalogue.groups[0].tags[0].name = 'caller mutation'
  const page = await api.fetchDiscoveryPlaylists({ cat: '私藏（热门）', caller: '77' })
  assert.equal(page.items.length, 30)
  assert.equal(page.total, 504)
  assert.equal(api.calls.filter(call => call.key === WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY).length, 2)
  const request = api.calls.find(call => call.key === WINDOWS_CATEGORY_CONTENT_REQUEST_KEY).call.param
  assert.equal(request.category_id, 3417)
  assert.equal(request.caller, '77')
  assert.equal(Object.hasOwn(request, 'order'), false)
})

test('feed page0/30/60 preserves true/false/true, unknown total and permits explicit page60 after false', async () => {
  const api = methods()
  const results = []
  for (const offset of [0, 30, 60]) results.push(await api.fetchDiscoveryPlaylists({ caller: '77', offset }))
  assert.deepEqual(results.map(result => result.hasMore), [true, false, true])
  assert.deepEqual(results.map(result => result.total), [0, 0, 0])
  assert.deepEqual(api.calls.map(call => call.call.param.FeedReq), [
    { From: 0, Size: 30 }, { From: 30, Size: 30 }, { From: 60, Size: 30 }
  ])
  assert.equal(results[1].items[0].id, 'qq:playlist:0:1030')
})

test('feed response and HasMore are read once so a changing accessor cannot publish a string as the SDK Boolean', async () => {
  const data = feed(0), response = data.FeedRsp
  let responseReads = 0, moreReads = 0
  Object.defineProperty(data, 'FeedRsp', { get() { responseReads++; return responseReads === 1 ? response : { HasMore: 'PUBLIC_RAW_PROVIDER_MESSAGE' } } })
  Object.defineProperty(response, 'HasMore', { get() { moreReads++; return moreReads === 1 ? false : 'PUBLIC_RAW_PROVIDER_MESSAGE' } })
  const result = await methods({ client: { request: async () => data } }).fetchDiscoveryPlaylists({ caller: '77' })
  assert.equal(result.hasMore, false)
  assert.equal(typeof result.hasMore, 'boolean')
  assert.equal(responseReads, 1)
  assert.equal(moreReads, 1)
  assert.equal(JSON.stringify(result).includes('PUBLIC_RAW_PROVIDER_MESSAGE'), false)
})

test('window31 split and maximum unaligned60 span bounded raw pages with exact native page/offset and order', async () => {
  const api = methods()
  const split = await api.fetchDiscoveryPlaylists({ caller: '77', offset: 29, limit: 31 })
  assert.equal(split.items.length, 31)
  assert.equal(split.items[0].id, 'qq:playlist:0:1029')
  assert.equal(split.items.at(-1).id, 'qq:playlist:0:1059')
  assert.equal(split.hasMore, false)
  assert.deepEqual(api.calls.map(call => call.call.param.FeedReq.From), [0, 30])
  const category = methods()
  const result = await category.fetchDiscoveryPlaylists({ cat: '睡前', caller: '77', offset: 31, limit: 60 })
  assert.equal(result.items.length, 60)
  assert.equal(result.items[0].id, 'qq:playlist:0:2031')
  assert.equal(result.items.at(-1).id, 'qq:playlist:0:2090')
  assert.deepEqual(category.calls.filter(call => call.key === WINDOWS_CATEGORY_CONTENT_REQUEST_KEY).map(call => call.call.param.page), [1, 2, 3])
  assert.equal(result.total, 504)
  assert.equal(result.hasMore, true)
})

test('partial selected windows have known remaining raw rows; final category pages use actual total', async () => {
  const api = methods()
  const first = await api.fetchDiscoveryPlaylists({ caller: '77', offset: 30, limit: 1 })
  assert.equal(first.hasMore, true) // Nativefalse, but29 already-returned rows remain.
  const result = await api.fetchDiscoveryPlaylists({ cat: '睡前', caller: '77', offset: 500, limit: 30 })
  assert.equal(result.items.length, 4)
  assert.equal(result.total, 504)
  assert.equal(result.hasMore, false)
  assert.equal((await api.fetchDiscoveryPlaylists({ cat: '睡前', caller: '77', offset: 600 })).items.length, 0)
})

test('bounded inputs reject unknown/ambiguous/AI labels and new sort without selecting fallback categories', async () => {
  for (const input of [{ order: 'new' }, { order: '' }, { limit: 0 }, { limit: 61 }, { limit: 1.5 },
    { offset: -1 }, { offset: 1000001 }, { offset: '0' }, { caller: '0' }, { caller: '077' }, { caller: undefined }]) {
    const api = methods()
    await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', ...input }), generic)
    assert.equal(api.calls.length, 0)
  }
  for (const cat of ['不存在', '私藏', 'AI歌单', '', '睡前\n']) {
    const api = methods()
    await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', cat }), generic)
    assert.equal(api.calls.length, 1)
    assert.equal(api.bindings.length, 0)
  }
})

test('all raw rows are validated before any selected binding, including records outside the requested slice', async () => {
  let bindings = 0
  for (const mutate of [data => { data.FeedRsp.List[29].Playlist.basic.title = '' },
    data => { data.FeedRsp.List[29].Playlist.basic.cover.medium_url = 'file:///private' },
    data => { data.FeedRsp.List[29].Playlist.basic.song_cnt = -1 },
    data => { data.FeedRsp.List[29].Playlist.basic.creator.nick = '\0' }]) {
    const data = feed(0); mutate(data)
    const api = methods({ client: { request: async () => data }, resolveBinding: async input => { bindings++; return binding(input) } })
    await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', limit: 1 }), generic)
  }
  assert.equal(bindings, 0)
})

test('in-page/cross-page duplicate IDs, category total drift and malformed counts reject the whole read', async () => {
  for (const scenario of ['samePage', 'crossPage', 'drift', 'short', 'countType']) {
    let bindings = 0
    const api = methods({ client: { async request(key, call) {
      if (key === WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY) return taxonomy()
      const page = call.param.page, data = categoryPage(page)
      if (scenario === 'samePage') data.content.v_item[29].basic.tid = data.content.v_item[0].basic.tid
      if (scenario === 'crossPage' && page === 1) data.content.v_item[29].basic.tid = 2000
      if (scenario === 'drift' && page === 1) data.content.total_cnt = 505
      if (scenario === 'short') data.content.v_item.pop()
      if (scenario === 'countType') data.content.total_cnt = '504'
      return data
    } }, resolveBinding: async input => { bindings++; return binding(input) } })
    await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', cat: '睡前', limit: 31 }), generic)
    assert.equal(bindings, 0)
  }
})

test('feed incomplete/contradictory pages, sparse records, invalid IDs and unsafe64 precision do not silently skip', () => {
  for (const mutate of [data => { data.FeedRsp.HasMore = 1 }, data => { data.FeedRsp.FromLimit = '400' },
    data => { data.FeedRsp.List.pop() }, data => { delete data.FeedRsp.List[0] },
    data => { data.FeedRsp.List[0].Playlist.basic.tid = Number.MAX_SAFE_INTEGER + 1 },
    data => { data.FeedRsp.List[0].Playlist.basic.tid = '01' },
    data => { data.FeedRsp.List[0].Playlist.basic.tid = '9223372036854775808' }]) {
    const data = feed(0); mutate(data); assert.throws(() => decodeWindowsDiscoveryFeedPage(data), generic)
  }
  const lossless = feed(0)
  lossless.FeedRsp.List[0].Playlist.basic.tid = '9223372036854775807'
  assert.equal(decodeWindowsDiscoveryFeedPage(lossless).records[0].disstid, '9223372036854775807')
  assert.equal(decodeWindowsDiscoveryFeedPage(feed(0, { length: 0, hasMore: false })).hasMore, false)
})

test('native binding host0 is supplied, source empty uin is never defaulted, and mismatched or directory bindings reject', async () => {
  const api = methods()
  const result = await api.fetchDiscoveryPlaylists({ caller: '77', limit: 1 })
  assert.equal(result.items[0].id, 'qq:playlist:0:1000')
  assert.equal(result.items[0].trackCount, 2)
  assert.deepEqual(api.bindings[0], { disstid: '1000', loginUin: '77', signal: undefined })
  for (const result of [undefined, {}, { playlistId: 'qq:playlist:0:9999', detail: { total: 2 } },
    { playlistId: 'qq:playlist:0:1000:201', detail: { total: 2 } },
    { playlistId: 'qq:playlist::1000', detail: { total: 2 } },
    { playlistId: 'qq:playlist:0:1000', detail: { total: '2' } }]) {
    await assert.rejects(methods({ resolveBinding: async () => result }).fetchDiscoveryPlaylists({ caller: '77', limit: 1 }), generic)
  }
})

test('three binding workers preserve source order; first failure stops queued work and awaits already-started peers', async () => {
  const waits = [deferred(), deferred(), deferred()]
  let calls = 0, settled = false
  const api = methods({ resolveBinding: input => {
    const index = calls++
    if (index >= 3) throw new Error('Started after failure')
    return waits[index].promise.then(() => binding(input))
  } })
  const promise = api.fetchDiscoveryPlaylists({ caller: '77', limit: 6 })
  const outcome = promise.then(() => { settled = true }, error => { settled = true; return error })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 3)
  waits[0].reject(new Error('PUBLIC_RAW_PROVIDER_MESSAGE'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  waits[2].resolve(); waits[1].resolve()
  assert.ok(generic(await outcome))
  assert.equal(calls, 3)
})

test('successful workers cap concurrency at3 and retain input order despite reversed completion', async () => {
  let active = 0, maximum = 0
  const api = methods({ resolveBinding: async input => {
    active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, Number(input.disstid) % 3))
    active--
    return binding(input)
  } })
  const result = await api.fetchDiscoveryPlaylists({ caller: '77', limit: 10 })
  assert.equal(maximum, 3)
  assert.deepEqual(result.items.map(item => item.id), Array.from({ length: 10 }, (_, index) => `qq:playlist:0:${1000 + index}`))
})

test('abort before request, after native page, during taxonomy and late binding rejects without partial output', async () => {
  const before = new AbortController(); before.abort()
  const api = methods()
  await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', signal: before.signal }), { name: 'AbortError' })
  assert.equal(api.calls.length, 0)
  for (const phase of ['taxonomy', 'page']) {
    const abort = new AbortController()
    const api = methods({ client: { async request(key, call) {
      if (phase === 'taxonomy' && key === WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY) { abort.abort(); return taxonomy() }
      abort.abort(); return feed(call.param.FeedReq.From)
    } } })
    await assert.rejects(api.fetchDiscoveryPlaylists({ caller: '77', cat: phase === 'taxonomy' ? '睡前' : '全部', signal: abort.signal }), { name: 'AbortError' })
  }
  const abort = new AbortController(), pending = deferred()
  let count = 0
  const late = methods({ resolveBinding: async input => { count++; await pending.promise; return binding(input) } })
  const promise = late.fetchDiscoveryPlaylists({ caller: '77', limit: 10, signal: abort.signal })
  await new Promise(resolve => setImmediate(resolve)); abort.abort(); pending.resolve()
  await assert.rejects(promise, { name: 'AbortError' })
  assert.equal(count, 3)
})

test('RPC numeric status is preserved once; external names/prototypes/accessors never leak private raw messages', async () => {
  const marker = 'PUBLIC_RAW_PROVIDER_MESSAGE'
  let captured
  try { decodeWindowsDiscoveryTaxonomy({}) } catch (error) { captured = error }
  captured.message = marker
  for (const property of ['name', 'code']) Object.defineProperty(captured, property, { get() { throw new Error(marker) } })
  const spoof = Object.create(Object.getPrototypeOf(captured))
  spoof.message = marker; spoof.code = marker
  const cases = [new Error(marker), { name: 'WindowsDiscoveryResponseError', code: 'SHAPE', message: marker }, captured, spoof,
    { get name() { throw new Error(marker) } }]
  for (const error of cases) {
    await assert.rejects(methods({ client: { request: async () => { throw error } } }).fetchDiscoveryPlaylists({ caller: '77' }), generic)
  }
  let reads = 0
  const rpc = new WindowsRpcError(22)
  Object.defineProperty(rpc, 'code', { get() { return ++reads === 1 ? 22 : marker } })
  await assert.rejects(methods({ client: { request: async () => { throw rpc } } }).fetchDiscoveryPlaylists({ caller: '77' }), error => error instanceof WindowsRpcError && error.code === 22 && !error.message.includes(marker))
  assert.equal(reads, 1)
  await assert.rejects(methods({ client: { get request() { throw new Error(marker) } } }).fetchDiscoveryPlaylists({ caller: '77' }), generic)
  const data = {}; Object.defineProperty(data, 'v_group', { get() { throw new Error(marker) } })
  assert.throws(() => decodeWindowsDiscoveryTaxonomy(data), generic)
  assert.throws(() => decodeWindowsCategoryContentPage({ retcode: 22, content: {} }, { page: 0 }), error => error instanceof WindowsRpcError && error.code === 22)
  assert.throws(() => decodeWindowsCategoryContentPage({ retcode: marker, content: {} }, { page: 0 }), generic)
})

test('ordinary category initial content and basic keep their distinct source zero-caller types', () => {
  const content = buildWindowsCategoryContentCall({ categoryId: 123 })
  const basic = buildWindowsCategoryBasicCall({ categoryId: 456 })
  assert.equal(WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, `${content.module}.${content.method}`)
  assert.equal(WINDOWS_CATEGORY_BASIC_REQUEST_KEY, `${basic.module}.${basic.method}`)
  assert.deepEqual(content.param, { caller: '0', category_id: 123, page: 0, use_page: 1, size: 60 })
  assert.deepEqual(basic.param, { caller: 0, category_id: 456 })
  assert.equal(buildWindowsCategoryContentCall({ categoryId: 123, caller: 0 }).param.caller, '0')
  assert.equal(buildWindowsCategoryBasicCall({ categoryId: 123, caller: '0' }).param.caller, '0')
  for (const caller of [123, '123', '18446744073709551615']) {
    assert.equal(buildWindowsCategoryContentCall({ categoryId: 123, caller }).param.caller, caller)
    assert.equal(buildWindowsCategoryBasicCall({ categoryId: 123, caller }).param.caller, caller)
  }
})

test('ordinary category cursor is lossless and excludes page/use_page, with source literal order5 only', () => {
  const call = buildWindowsCategoryCursorCall({ categoryId: 123, titleId: 456, lastId: '9223372036854775807' })
  assert.equal(WINDOWS_CATEGORY_CONTENT_REQUEST_KEY, `${call.module}.${call.method}`)
  assert.deepEqual(call.param, { last_id: '9223372036854775807', size: 60, order: 5, is_parent: 0,
    caller: '0', titleid: 456, category_id: 123 })
  assert.equal(Object.hasOwn(call.param, 'page'), false)
  assert.equal(Object.hasOwn(call.param, 'use_page'), false)
  assert.match(JSON.stringify(call.param), /"last_id":"9223372036854775807"/)
})

test('explicit categories cannot manufacture All/default3204 from missing/string/unsafe inputs', () => {
  for (const categoryId of [undefined, null, 0, -1, 1.5, '123', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.throws(() => buildWindowsCategoryContentCall({ categoryId }))
    assert.throws(() => buildWindowsCategoryBasicCall({ categoryId }))
    assert.throws(() => buildWindowsCategoryCursorCall({ categoryId, titleId: 456, lastId: '77' }))
    assert.throws(() => buildWindowsCategoryCursorCall({ categoryId: 123, titleId: categoryId, lastId: '77' }))
  }
  assert.equal(buildWindowsCategoryContentCall({ categoryId: Number.MAX_SAFE_INTEGER }).param.category_id, Number.MAX_SAFE_INTEGER)
})

test('caller and cursor input bounds reject precision loss, whitespace/private tokens and invalid range with generic errors', () => {
  for (const caller of [null, '', '123\n', '123\0', 'PUBLIC_RAW_PROVIDER_MESSAGE', -1, 1.5,
    Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', '1'.repeat(100)]) {
    assert.throws(() => buildWindowsCategoryContentCall({ categoryId: 123, caller }), error => error.message === 'QQ 音乐发现请求参数无效')
    assert.throws(() => buildWindowsCategoryBasicCall({ categoryId: 123, caller }))
  }
  for (const lastId of [undefined, null, 0, 77, '', '0', '-1', '77\n', '77\0', '9223372036854775808', '1'.repeat(100)]) {
    assert.throws(() => buildWindowsCategoryCursorCall({ categoryId: 123, titleId: 456, lastId }))
  }
})
