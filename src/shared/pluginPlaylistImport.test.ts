import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PLUGIN_PLAYLIST_NAME_LENGTH,
  MAX_PLUGIN_PLAYLISTS_PER_REQUEST,
  normalizePluginPlaylistImportRequest,
  PluginPlaylistImportError
} from './pluginPlaylistImport.ts'

test('accepts a well-formed batch and normalizes names', () => {
  const request = normalizePluginPlaylistImportRequest({
    playlists: [
      { name: '  星际穿越OST  ', paths: ['E:\\Music\\01.flac', 'E:\\Music\\02.flac'] },
      { name: '白戒', paths: ['D:\\HIFI\\01.wav'] }
    ]
  })

  assert.deepEqual(request.playlists, [
    { name: '星际穿越OST', paths: ['E:\\Music\\01.flac', 'E:\\Music\\02.flac'] },
    { name: '白戒', paths: ['D:\\HIFI\\01.wav'] }
  ])
})

test('drops unusable paths and empty playlists without failing the batch', () => {
  const request = normalizePluginPlaylistImportRequest({
    playlists: [
      { name: 'keep', paths: ['a.flac', '', '   ', 'b.flac', 42, null] },
      { name: 'drop', paths: [] },
      { name: 'drop2', paths: ['', '  '] }
    ]
  })

  assert.equal(request.playlists.length, 1)
  assert.deepEqual(request.playlists[0].paths, ['a.flac', 'b.flac'])
})

test('normalizes whitespace and accepts names exactly at the limit', () => {
  const request = normalizePluginPlaylistImportRequest({
    playlists: [{ name: `  ${'x'.repeat(MAX_PLUGIN_PLAYLIST_NAME_LENGTH)}  `, paths: ['x.flac'] }]
  })
  assert.equal(request.playlists[0].name.length, MAX_PLUGIN_PLAYLIST_NAME_LENGTH)
  assert.equal(
    normalizePluginPlaylistImportRequest({
      playlists: [{ name: '  a   b  ', paths: ['x.flac'] }]
    }).playlists[0].name,
    'a b'
  )
})

test('rejects long names instead of aliasing an existing playlist or each other', () => {
  const prefix = 'x'.repeat(MAX_PLUGIN_PLAYLIST_NAME_LENGTH)
  for (const suffix of ['A', 'B']) {
    assert.throws(
      () =>
        normalizePluginPlaylistImportRequest({
          playlists: [
            { name: prefix, paths: ['first.flac'] },
            { name: prefix + suffix, paths: ['second.flac'] }
          ]
        }),
      /歌单名称不能超过 80 个字符/
    )
  }
})

test('rejects malformed payloads', () => {
  const cases: unknown[] = [
    null,
    'nope',
    [],
    {},
    { playlists: 'nope' },
    { playlists: [] },
    { playlists: [{ name: '   ', paths: ['a.flac'] }] },
    { playlists: [{ name: 'x', paths: 'nope' }] },
    { playlists: [{ name: 'x', paths: [null, 42] }] }
  ]

  for (const value of cases) {
    assert.throws(
      () => normalizePluginPlaylistImportRequest(value),
      PluginPlaylistImportError,
      `expected ${JSON.stringify(value)} to be rejected`
    )
  }
})

test('rejects batches beyond the documented ceilings', () => {
  assert.throws(
    () =>
      normalizePluginPlaylistImportRequest({
        playlists: Array.from({ length: MAX_PLUGIN_PLAYLISTS_PER_REQUEST + 1 }, () => ({
          name: 'x',
          paths: ['a.flac']
        }))
      }),
    PluginPlaylistImportError
  )
})
