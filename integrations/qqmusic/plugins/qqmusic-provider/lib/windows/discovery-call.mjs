import { mapWindowsPlaylist, windowsPlaylistReference } from './search-catalog.mjs'
import { WindowsRpcError } from './response.mjs'

// Windows Resource JSON/2009 configured musicroom -> module565 discovery route
// -> wk_v17 modules441/435. These are embedded-web request shapes; actual
// WindowsMusicClient ct19/cv2271 compatibility is separately observed in the
// saved real response/pagination receipts. These are not C++ request producers.
export const WINDOWS_EMBEDDED_DISCOVERY_PROVENANCE = Object.freeze({
  kind: 'windows-configured-embedded-web', sourceEvidence: 'qq-windows-discovery-findings.json',
  squareModule: 441, squareAssetSha256: 'eb436f0ad043d43fe502de213d8ab974d41fe410c2db128f317f9d49b278b615',
  categoryModule: 435, categoryAssetSha256: 'a6931d41e6a2540263e2f2d315640bf9baa58b61604f31cf18bddacb369b2312',
  taxonomyModule: 436, taxonomyAssetSha256: '9048ce89e17d460ed38f27bdc2b20904e7cfba3b651f491b3728ff3342d7f93f',
  nativeClientTransport: 'compatibility-accepted-public-discovery-rpc',
  realServiceEvidence: 'qq-discovery-real-response-shapes.json',
  paginationEvidence: 'qq-discovery-real-pagination.json'
})
export const WINDOWS_DISCOVERY_FEED_REQUEST_KEY = 'music.playlist.PlaylistSquare.GetRecommendWhole'
export const WINDOWS_DISCOVERY_TABS_REQUEST_KEY = 'music.playlist.PlaylistSquare.GetSquareTab'
export const WINDOWS_CATEGORY_CONTENT_REQUEST_KEY = 'playlist.PlayListCategoryServer.get_category_content'
export const WINDOWS_CATEGORY_BASIC_REQUEST_KEY = 'playlist.PlayListCategoryServer.get_category_basic'
export const WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY = 'music.playlist.PlaylistSquare.GetAllTag'
const invalid = () => new Error('QQ 音乐发现请求参数无效')

// Explicit adapter input bounds, not recovered native field widths or enum
// semantics. The source parseInt inputs are URL navigation values.
function category(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalid()
  return value
}
function callerValue(value, fallback) {
  if (value === 0) return fallback
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value !== 'string' || value.length < 1 || value.length > 20 || /[^0-9]/.test(value) ||
      BigInt(value) > 0xffffffffffffffffn) throw invalid()
  return value
}
function cursor(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 19 || /[^0-9]/.test(value) ||
      BigInt(value) <= 0n || BigInt(value) > 0x7fffffffffffffffn) throw invalid()
  return value
}

// Explicit SDK resource/display policies, not recovered native limits or order
// labels. module436 uses its array index as the group React display key.
export const WINDOWS_DISCOVERY_POLICY = Object.freeze({ pageSize: 30, maxLimit: 60,
  maxOffset: 1000000, maxPages: 3, bindingWorkers: 3, maxGroups: 32,
  maxTaxonomyRows: 2048, groupKey: 'source-ui-array-index', supportedSource: 0,
  supportsSort: false, feedTotal: 'unknown-zero', cache: 'none' })
const maximumPage = Math.floor(WINDOWS_DISCOVERY_POLICY.maxOffset / 30) + 2
function pageNumber(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumPage) throw invalid()
  return value
}
function pageSize(value) {
  if (value !== 30 && value !== 60) throw invalid()
  return value
}

/** Default keeps module441's exact initial body; explicit paging uses the observed30 size. */
export function buildWindowsDiscoveryFeedCall({ from = 0, size = 60 } = {}) {
  if (!Number.isSafeInteger(from) || from < 0 || from > WINDOWS_DISCOVERY_POLICY.maxOffset + 60) throw invalid()
  return { module: 'music.playlist.PlaylistSquare', method: 'GetRecommendWhole',
    param: { IsReqHead: false, IsReqFeed: true, FeedReq: { From: from, Size: pageSize(size) } } }
}
/** Exact module436 GetAllTag body; item.tag is icon text, not a hot Boolean. */
export function buildWindowsDiscoveryAllTagsCall() {
  return { module: 'music.playlist.PlaylistSquare', method: 'GetAllTag', param: { qq: '' } }
}
export function buildWindowsDiscoveryTabsCall() {
  return { module: 'music.playlist.PlaylistSquare', method: 'GetSquareTab', param: {} }
}

/**
 * Ordinary source0 initial content. Source SDK.getUin() || string0 is a request
 * caller fallback, not a fabricated playlist creator or native host namespace.
 */
export function buildWindowsCategoryContentCall({ categoryId, caller = '0', page = 0, size = 60 } = {}) {
  return { module: 'playlist.PlayListCategoryServer', method: 'get_category_content',
    param: { caller: callerValue(caller, '0'), category_id: category(categoryId), page: pageNumber(page), use_page: 1, size: pageSize(size) } }
}

/** Caller supplies the source titleId here; source basic fallback is numeric0. */
export function buildWindowsCategoryBasicCall({ categoryId, caller = 0 } = {}) {
  return { module: 'playlist.PlayListCategoryServer', method: 'get_category_basic',
    param: { caller: callerValue(caller, 0), category_id: category(categoryId) } }
}

/**
 * Exact ordinary cursor body. lastId is the prior basic.tid.toString(), kept
 * lossless as a string within this adapter's existing signed64 playlist range.
 * Source literal order5 has no proven hot/new label. This body omits page and
 * use_page; it does not establish an SDK absolute-offset implementation.
 */
export function buildWindowsCategoryCursorCall({ categoryId, titleId, lastId, caller = '0' } = {}) {
  return { module: 'playlist.PlayListCategoryServer', method: 'get_category_content',
    param: { last_id: cursor(lastId), size: 60, order: 5, is_parent: 0,
      caller: callerValue(caller, '0'), titleid: category(titleId), category_id: category(categoryId) } }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const codes = new Set(['INPUT', 'REQUEST', 'SHAPE', 'STATUS', 'COUNT', 'IDENTITY', 'CATEGORY', 'BINDING'])
const ownedCodes = new WeakMap()
class WindowsDiscoveryResponseError extends Error {
  constructor(code) {
    super('QQ 音乐发现数据无法验证')
    this.name = 'WindowsDiscoveryResponseError'
    this.code = codes.has(code) ? code : 'REQUEST'
    ownedCodes.set(this, this.code)
  }
}
const failure = code => new WindowsDiscoveryResponseError(code)
function cancelled() {
  const error = new Error('QQ 音乐发现加载已取消')
  error.name = 'AbortError'
  return error
}
function check(signal) { if (signal?.aborted) throw cancelled() }
function normalize(error, signal) {
  try {
    if (signal?.aborted) return cancelled()
    if (error instanceof WindowsDiscoveryResponseError) return failure(ownedCodes.get(error) ?? 'REQUEST')
    if (error?.name === 'AbortError') return cancelled()
    if (error instanceof WindowsRpcError) {
      const code = error.code
      if (Number.isInteger(code) && code !== 0 && code >= -0x80000000 && code <= 0x7fffffff) return new WindowsRpcError(code)
    }
  } catch {}
  return failure('REQUEST')
}
function decode(callback) {
  try { return callback() } catch (error) { throw normalize(error) }
}
function text(value, { nonempty = false, maximum = 4096 } = {}) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || !value.isWellFormed()) throw failure('SHAPE')
  const result = value.trim()
  if (nonempty && !result) throw failure('SHAPE')
  return result
}
function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw failure('COUNT')
  return value
}
function status(value) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw failure('STATUS')
  if (value !== 0) throw new WindowsRpcError(value)
}
function playlistTid(value) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || !source || source.length > 19 || /[^0-9]/.test(source)) throw failure('IDENTITY')
  const integer = BigInt(source)
  if (integer <= 0n || integer > 0x7fffffffffffffffn || integer.toString() !== source) throw failure('IDENTITY')
  return source
}
function loginCaller(value) {
  const source = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof source !== 'string' || !source || source.length > 20 || /[^0-9]/.test(source)) throw failure('INPUT')
  const integer = BigInt(source)
  if (integer <= 0n || integer > 0xffffffffffffffffn || integer.toString() !== source) throw failure('INPUT')
  return source
}

/**
 * Source0 taxonomy only. Same ID/name may occur in several groups; different
 * IDs with the same name receive distinct SDK labels. group.id is deliberately
 * the source UI array index, not group_id or a request namespace.
 */
export function decodeWindowsDiscoveryTaxonomy(data) {
  return decode(() => {
    if (!object(data) || !Array.isArray(data.v_group) || data.v_group.length > WINDOWS_DISCOVERY_POLICY.maxGroups) throw failure('SHAPE')
    const names = new Map(), identities = new Map()
    let rawCount = 0
    const groups = Array.from(data.v_group, (group, index) => {
      if (!object(group) || !Array.isArray(group.v_item)) throw failure('SHAPE')
      const name = text(group.group_name, { nonempty: true, maximum: 128 })
      rawCount += group.v_item.length
      if (rawCount > WINDOWS_DISCOVERY_POLICY.maxTaxonomyRows) throw failure('COUNT')
      const seen = new Set()
      const rows = Array.from(group.v_item, row => {
        if (!object(row)) throw failure('SHAPE')
        const id = category(row.id), label = text(row.name, { nonempty: true, maximum: 128 })
        if (row.source !== 0 && row.source !== 1 || row.tag !== undefined && typeof row.tag !== 'string') throw failure('SHAPE')
        if (row.tag !== undefined) text(row.tag)
        if (seen.has(id)) throw failure('IDENTITY')
        seen.add(id)
        const prior = identities.get(id)
        if (prior && (prior.name !== label || prior.source !== row.source)) throw failure('IDENTITY')
        identities.set(id, { name: label, source: row.source })
        if (row.source === 1) return null
        if (label === '全部') throw failure('CATEGORY')
        if (!names.has(label)) names.set(label, new Set())
        names.get(label).add(id)
        return { id, name: label }
      }).filter(Boolean)
      return { id: index, name, rows }
    })
    const labels = new Map()
    const tagged = groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row,
      label: names.get(row.name).size > 1 ? `${row.name}（${group.name}）` : row.name })) }))
    // A real category name can itself look like a disambiguated label. Detect
    // collisions across the entire taxonomy before applying a stable ID suffix.
    const labelIds = new Map()
    for (const group of tagged) for (const row of group.rows) {
      if (!labelIds.has(row.label)) labelIds.set(row.label, new Set())
      labelIds.get(row.label).add(row.id)
    }
    const catalogue = { hotTags: [], groups: tagged.map(group => ({ id: group.id, name: group.name,
      tags: group.rows.map(row => {
        const label = labelIds.get(row.label).size > 1 ? `${row.label} [${row.id}]` : row.label
        if (labels.has(label) && labels.get(label) !== row.id) throw failure('CATEGORY')
        labels.set(label, row.id)
        return { name: label, hot: false }
      }) })) }
    return { catalogue, categoryIds: labels }
  })
}

function candidate(basic) {
  if (!object(basic) || !object(basic.creator) || !object(basic.cover)) throw failure('SHAPE')
  const disstid = playlistTid(basic.tid)
  // No source creator.uin/encrypt_uin is retained as a native host. The exact
  // host comes only from the injected verified native detail binder.
  const name = text(basic.title, { nonempty: true })
  const creatorName = text(basic.creator.nick)
  const cover = text(basic.cover.medium_url)
  count(basic.song_cnt)
  if (cover) {
    let url
    try { url = new URL(cover) } catch { throw failure('SHAPE') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw failure('SHAPE')
  }
  return { disstid, name, creatorName, cover }
}
function candidates(rows, getBasic) {
  if (!Array.isArray(rows) || rows.length > 30) throw failure('COUNT')
  const seen = new Set()
  return Array.from(rows, row => {
    const result = candidate(getBasic(row))
    if (seen.has(result.disstid)) throw failure('IDENTITY')
    seen.add(result.disstid)
    return result
  })
}
export function decodeWindowsDiscoveryFeedPage(data) {
  return decode(() => {
    if (!object(data)) throw failure('SHAPE')
    const response = data.FeedRsp
    if (!object(response)) throw failure('SHAPE')
    // A dependency can supply accessor-backed DTOs. Keep validation and the
    // published Boolean bound to the very same read, rather than rereading it.
    const hasMore = response.HasMore
    if (typeof hasMore !== 'boolean') throw failure('SHAPE')
    // FromLimit is validated as a field, then deliberately excluded from total.
    count(response.FromLimit)
    const records = candidates(response.List, row => row?.Playlist?.basic)
    if (records.length < 30 && hasMore) throw failure('COUNT')
    return { records, hasMore, total: 0 }
  })
}
export function decodeWindowsCategoryContentPage(data, { page } = {}) {
  return decode(() => {
    pageNumber(page)
    if (!object(data) || !object(data.content)) throw failure('SHAPE')
    status(data.retcode)
    const total = count(data.content.total_cnt)
    const records = candidates(data.content.v_item, row => row?.basic)
    const expected = Math.min(30, Math.max(0, total - page * 30))
    if (records.length !== expected) throw failure('COUNT')
    return { records, total, hasMore: (page * 30 + records.length) < total }
  })
}

async function request(client, key, call, signal) {
  check(signal)
  const method = client?.request
  if (typeof method !== 'function') throw failure('INPUT')
  const data = await method.call(client, key, call, { signal })
  check(signal)
  return data
}
function window(limit, offset) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WINDOWS_DISCOVERY_POLICY.maxLimit ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > WINDOWS_DISCOVERY_POLICY.maxOffset) throw failure('INPUT')
  return { limit, offset, page: Math.floor(offset / 30), skip: offset % 30,
    pages: Math.ceil((offset % 30 + limit) / 30) }
}
function boundSummary(record, binding) {
  if (!object(binding) || !object(binding.detail)) throw failure('BINDING')
  const reference = windowsPlaylistReference(binding.playlistId)
  if (reference.dirid !== undefined || reference.disstid !== record.disstid) throw failure('BINDING')
  const total = count(binding.detail.total)
  const summary = mapWindowsPlaylist({ dissid: reference.disstid, dissname: record.name,
    creator: { creator_uin: reference.hostUin, name: record.creatorName },
    imgurl: record.cover, song_count: total })
  if (!summary || summary.id !== binding.playlistId) throw failure('BINDING')
  return summary
}
async function bind(records, resolveBinding, caller, signal) {
  if (typeof resolveBinding !== 'function') throw failure('INPUT')
  const results = new Array(records.length)
  let next = 0, firstFailure
  async function worker() {
    while (!firstFailure && next < records.length) {
      try {
        check(signal)
        const index = next++, record = records[index]
        const binding = await resolveBinding({ disstid: record.disstid, loginUin: caller, signal })
        check(signal)
        results[index] = boundSummary(record, binding)
      } catch (error) { if (!firstFailure) firstFailure = normalize(error, signal) }
    }
  }
  // Await started workers even after failure. No queued work starts after it,
  // and no partially filled result is returned to the SDK.
  await Promise.all(Array.from({ length: Math.min(3, records.length) }, () => worker()))
  check(signal)
  if (firstFailure) throw firstFailure
  if (new Set(results.map(result => result.id)).size !== results.length) throw failure('IDENTITY')
  return results
}

/**
 * Stateless leaves: Root supplies the verified current caller and guards the
 * whole await with its existing owner epoch. The binder owns native namespace
 * verification. No account state, taxonomy response, or raw track cache lives
 * here; a cold category read reconstructs the deterministic label mapping.
 */
export function createWindowsDiscoveryMethods({ client, resolveBinding } = {}) {
  return {
    async fetchPlaylistCategories({ signal } = {}) {
      try {
        const data = await request(client, WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY, buildWindowsDiscoveryAllTagsCall(), signal)
        const result = decodeWindowsDiscoveryTaxonomy(data).catalogue
        check(signal)
        return result
      } catch (error) { throw normalize(error, signal) }
    },
    async fetchDiscoveryPlaylists({ cat = '全部', order = 'hot', limit = 30, offset = 0, caller, signal } = {}) {
      try {
        const input = window(limit, offset), loginUin = loginCaller(caller)
        if (order !== 'hot' || typeof cat !== 'string' || cat.length > 512) throw failure('INPUT')
        let categoryId
        if (cat !== '全部') {
          const data = await request(client, WINDOWS_DISCOVERY_ALL_TAGS_REQUEST_KEY, buildWindowsDiscoveryAllTagsCall(), signal)
          categoryId = decodeWindowsDiscoveryTaxonomy(data).categoryIds.get(cat)
          if (categoryId === undefined) throw failure('CATEGORY')
        }
        const records = [], seen = new Set()
        let total, finalHasMore = false
        for (let index = 0; index < input.pages; index++) {
          const page = input.page + index
          const key = categoryId === undefined ? WINDOWS_DISCOVERY_FEED_REQUEST_KEY : WINDOWS_CATEGORY_CONTENT_REQUEST_KEY
          const call = categoryId === undefined ? buildWindowsDiscoveryFeedCall({ from: page * 30, size: 30 }) :
            buildWindowsCategoryContentCall({ categoryId, caller: loginUin, page, size: 30 })
          const data = await request(client, key, call, signal)
          const decoded = categoryId === undefined ? decodeWindowsDiscoveryFeedPage(data) : decodeWindowsCategoryContentPage(data, { page })
          if (total !== undefined && total !== decoded.total) throw failure('COUNT')
          total = decoded.total
          for (const record of decoded.records) {
            if (seen.has(record.disstid)) throw failure('IDENTITY')
            seen.add(record.disstid)
          }
          const skip = index === 0 ? input.skip : 0
          const remaining = input.limit - records.length
          records.push(...decoded.records.slice(skip, skip + remaining))
          finalHasMore = decoded.hasMore || skip + remaining < decoded.records.length
          if (records.length >= input.limit || decoded.records.length < 30) break
          // Full feed pages continue the explicit requested window even when
          // HasMore=false: real pages0/30/60 returned true/false/true.
        }
        check(signal)
        const items = await bind(records, resolveBinding, loginUin, signal)
        check(signal)
        return { items, total: total ?? 0,
          hasMore: categoryId === undefined ? finalHasMore : input.offset + items.length < total,
          offset: input.offset, limit: input.limit }
      } catch (error) { throw normalize(error, signal) }
    }
  }
}
