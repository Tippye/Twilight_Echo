// Task-only investigation helper. Never include in the final provider runtime.
// Inject the already proved Windows native builders; no alternate client/profile.
const MID = value => typeof value === 'string' && value.length === 14 && /^[A-Za-z0-9]+$/.test(value)
const INT32 = value => Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff
const FIELDS = Object.freeze({ hires: 'size_hires', surround: 'size_dts', dolby: 'size_dolby' })

function failure(code = 'SHAPE') {
  const error = new Error('Windows quality candidate probe failed')
  error.name = 'WindowsQualityCandidateProbeError'
  error.code = code
  return error
}
function check(signal) {
  if (signal?.aborted) { const error = failure('ABORT'); error.name = 'AbortError'; throw error }
}
function songId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff ? String(value) : null
  if (typeof value !== 'string' || value.length === 0 || value.length > 10 || /[^0-9]/.test(value)) return null
  const id = BigInt(value)
  return id > 0n && id <= 0xffffffffn ? id.toString() : null
}
function title(value) {
  return typeof value === 'string' && value.trim() && !/[\x00-\x1f\x7f]/.test(value)
    ? value.trim().slice(0, 160) : null
}
function reference(row) {
  const id = songId(row?.id)
  const name = title(row?.title ?? row?.name)
  if (id === null || !MID(row?.mid) || !name) return null
  return { songid: id, songmid: row.mid, title: name }
}
function summarize(row, ref, source) {
  // Native parser uses asInt>0 for hires; isInt/asInt!=0 for DTS/Dolby.
  // Investigation candidate policy requires a physical positive int32 size for all3.
  // Missing, string, overflow or negative size is unknown, never permission success.
  const positiveFormats = Object.fromEntries(Object.entries(FIELDS).map(([format, field]) => {
    const value = row?.file?.[field]
    return [format, INT32(value) && value >= 0 ? value > 0 : null]
  }))
  return { id: `qq:${ref.songmid}:${ref.songid}`, ...ref, positiveFormats,
    hasMediaMid: MID(row?.file?.media_mid), formatSource: source }
}

/**
 * search performs exactly one authenticated Desktop search RPC. includeDetails
 * explicitly allows one scene0 TrackInfo RPC for at most20 identities/types from
 * that same public result. No pagination/retry/fallback, media fetch or state store.
 * Output is an allowlist of public song IDs/title/format flags, never raw DTOs.
 */
export function createWindowsQualityCandidateProbe({ client, buildSearchCall, searchRequestKey,
  buildTrackInfoCall, trackInfoRequestKey } = {}) {
  if (typeof client?.checkLogin !== 'function' || typeof client?.request !== 'function' ||
    typeof buildSearchCall !== 'function' || typeof buildTrackInfoCall !== 'function' ||
    typeof searchRequestKey !== 'string' || !searchRequestKey ||
    typeof trackInfoRequestKey !== 'string' || !trackInfoRequestKey) throw failure('CONFIG')
  return {
    async search({ query, pageNum = 1, numPerPage = 20, searchId, includeDetails = false, signal } = {}) {
      if (typeof query !== 'string' || !query.trim() || query.length > 80 || /[\x00-\x1f\x7f]/.test(query) ||
        !Number.isInteger(pageNum) || pageNum < 1 || pageNum > 1000000 ||
        !Number.isInteger(numPerPage) || numPerPage < 1 || numPerPage > 20 ||
        typeof searchId !== 'string' || !searchId || searchId.length > 64 || /[\x00-\x1f\x7f]/.test(searchId) ||
        typeof includeDetails !== 'boolean') throw failure('INPUT')
      check(signal)
      try {
        if (await client.checkLogin({ signal }) !== true) throw failure('LOGIN')
        check(signal)
        const data = await client.request(searchRequestKey, buildSearchCall({ query, pageNum, numPerPage,
          searchType: 0, remoteplace: 'pc.button.search.song', searchId }), { signal })
        check(signal)
        if (!Array.isArray(data?.body?.song?.list)) throw failure()
        const rows = data.body.song.list
        const selected = []
        const seen = new Set()
        for (const row of rows.slice(0, numPerPage)) {
          const ref = reference(row)
          if (!ref) continue
          const identity = `${ref.songid}:${ref.songmid}`
          if (seen.has(identity)) continue
          seen.add(identity)
          selected.push({ ref, type: INT32(row.type) ? row.type : null,
            summary: summarize(row, ref, 'search') })
        }
        let detailRpc = false
        let matchedDetails = 0
        let ignoredDetails = 0
        const detailInputs = selected.filter(value => value.type !== null)
        if (includeDetails && detailInputs.length) {
          // ctx0/scene0 are explicit adapter inputs, accepted in the public probe;
          // producer types are the original result's song.type, never filename type.
          const detail = await client.request(trackInfoRequestKey, buildTrackInfoCall({
            ids: detailInputs.map(value => Number(value.ref.songid)),
            types: detailInputs.map(value => value.type), ctx: 0, scene: 0
          }), { signal })
          detailRpc = true
          check(signal)
          if (!Array.isArray(detail?.tracks)) throw failure()
          const expected = new Map(detailInputs.map(value => [`${value.ref.songid}:${value.ref.songmid}`, value]))
          const replaced = new Set()
          for (const row of detail.tracks.slice(0, 20)) {
            const id = songId(row?.id)
            const identity = id && MID(row?.mid) ? `${id}:${row.mid}` : null
            const value = expected.get(identity)
            if (!value || replaced.has(identity) || row.type !== value.type) { ignoredDetails++; continue }
            // Keep the title from the already public search result. No detail extras
            // are retained; exact ID/MID/type matching prevents identity substitution.
            value.summary = summarize(row, value.ref, 'track-info-scene0')
            replaced.add(identity)
            matchedDetails++
          }
          ignoredDetails += Math.max(0, detail.tracks.length - 20)
        }
        check(signal)
        const items = selected.map(value => value.summary)
        return { investigationOnly: true, items,
          candidates: items.filter(item => Object.values(item.positiveFormats).includes(true)),
          observations: { searchRows: rows.length, scannedRows: Math.min(rows.length, numPerPage),
            publicItems: items.length, detailRpc, matchedDetails, ignoredDetails } }
      } catch (error) {
        check(signal)
        if (error?.name === 'WindowsQualityCandidateProbeError' || error?.name === 'AbortError') throw error
        throw failure(Number.isSafeInteger(error?.code) ? error.code : 'RPC')
      }
    }
  }
}
