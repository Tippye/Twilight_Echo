export const WINDOWS_DESKTOP_SEARCH_REQUEST_KEY = 'music.search.SearchCgiService'
export const WINDOWS_DESKTOP_SEARCH_PROVENANCE = Object.freeze({
  artifact: 'QQMusic_Protocol.dll',
  artifactSha256: 'ba66aa248b885227179f1676fbc54576a036f46b9d096fea33131c4f30fa6476',
  producer: '0x1006d3ef',
  evidenceId: 'ev_6b119dc9011ad9586664093677b7a74367c833a8b2d6c973252b5f375c910a20'
})

function cString(value, name) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new TypeError(`${name} must be a string without NUL`)
  }
  return value
}

function int32(value, name) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError(`${name} must be a signed int32`)
  }
  return value
}

/** Windows producer fields; search IDs, placement and mapped search type belong to the caller. */
export function buildWindowsDesktopSearchCall({ query, pageNum, numPerPage,
  searchType, remoteplace, searchId, nqcFlag = false } = {}) {
  if (typeof nqcFlag !== 'boolean') throw new TypeError('nqcFlag must be a boolean')
  const param = {
    searchid: cString(searchId, 'searchId'),
    search_type: int32(searchType, 'searchType'),
    query: cString(query, 'query'),
    page_num: int32(pageNum, 'pageNum'),
    num_per_page: int32(numPerPage, 'numPerPage'),
    grp: 1,
    remoteplace: cString(remoteplace, 'remoteplace')
  }
  if (nqcFlag) param.nqc_flag = 1
  return { module: WINDOWS_DESKTOP_SEARCH_REQUEST_KEY,
    method: 'DoSearchForQQMusicDesktop', param }
}
