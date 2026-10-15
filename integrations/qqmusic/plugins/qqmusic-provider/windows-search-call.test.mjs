import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWindowsDesktopSearchCall, WINDOWS_DESKTOP_SEARCH_REQUEST_KEY } from './lib/windows/search-call.mjs'

const options = { query: '测试歌曲 😀', pageNum: 1, numPerPage: 20,
  searchType: 0, remoteplace: 'public-placement', searchId: 'public-search-id' }

test('Windows Desktop search preserves its native RPC key, fields and integer types', () => {
  assert.equal(WINDOWS_DESKTOP_SEARCH_REQUEST_KEY, 'music.search.SearchCgiService')
  assert.deepEqual(buildWindowsDesktopSearchCall(options), {
    module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop',
    param: { searchid: 'public-search-id', search_type: 0, query: '测试歌曲 😀',
      page_num: 1, num_per_page: 20, grp: 1, remoteplace: 'public-placement' }
  })
})

test('nqc flag is absent by default and uses integer one only when requested', () => {
  assert.equal(Object.hasOwn(buildWindowsDesktopSearchCall(options).param, 'nqc_flag'), false)
  assert.equal(buildWindowsDesktopSearchCall({ ...options, nqcFlag: true }).param.nqc_flag, 1)
  assert.throws(() => buildWindowsDesktopSearchCall({ ...options, nqcFlag: 1 }), TypeError)
})

test('search ID and placement are caller values without capture-derived length restrictions', () => {
  const result = buildWindowsDesktopSearchCall({ ...options,
    searchId: 'a', remoteplace: '', pageNum: -1, numPerPage: 0, searchType: -0x80000000 })
  assert.equal(result.param.searchid, 'a')
  assert.equal(result.param.remoteplace, '')
  assert.equal(result.param.page_num, -1)
  assert.equal(result.param.search_type, -0x80000000)
})

test('missing caller fields and non-native values are rejected before serialization', () => {
  for (const name of ['query', 'searchId', 'remoteplace']) {
    assert.throws(() => buildWindowsDesktopSearchCall({ ...options, [name]: undefined }), TypeError)
    assert.throws(() => buildWindowsDesktopSearchCall({ ...options, [name]: 'a\0b' }), TypeError)
  }
  for (const name of ['pageNum', 'numPerPage', 'searchType']) {
    for (const value of [undefined, '1', 1.5, NaN, Infinity, 0x80000000, -0x80000001]) {
      assert.throws(() => buildWindowsDesktopSearchCall({ ...options, [name]: value }), RangeError)
    }
  }
})
