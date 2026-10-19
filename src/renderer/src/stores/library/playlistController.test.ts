import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { ref, shallowRef } from 'vue'
import type { Track } from '../../types/music.ts'
import type { Playlist, PlaylistPersistenceNotice } from './musicStoreTypes.ts'
import type { PlaylistPersistenceStatus } from '../playlistPersistence.ts'
import { createPlaylistController } from './playlistController.ts'
import { PersistentDataRevisionConflictError } from '../../../../shared/versionedPersistence.ts'

function track(id: number): Track {
  return {
    id: String(id),
    title: `Song ${id}`,
    artist: 'Artist',
    album: 'Album',
    filePath: `D:/Music/${id}.flac`,
    fileName: `${id}.flac`,
    duration: 180,
    size: 1000,
    cover: null,
    lyrics: null,
    source: 'local'
  }
}

function fixture(inputTracks: Track[]) {
  const playlists = shallowRef<Playlist[]>([])
  const controller = createPlaylistController({
    playlists,
    tracks: shallowRef(inputTracks),
    trackById: new Map(inputTracks.map((item) => [item.id, item])),
    getTracksRevision: () => 0,
    playlistPersistenceStatus: ref<PlaylistPersistenceStatus>({
      state: 'idle',
      dirty: false,
      failureCount: 0,
      lastError: null
    }),
    playlistPersistenceNotice: ref<PlaylistPersistenceNotice | null>(null)
  })
  return { controller, playlists }
}

function mockWindow(t: TestContext, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
}

test('batch preserves matching, order, duplicates, empty results and existing playlist identity', async (t) => {
  const writes: Playlist[][] = []
  t.mock.method(globalThis, 'setTimeout', (() => 0) as unknown as typeof setTimeout)
  mockWindow(t, {
    api: {
      data: {
        savePlaylists: async (snapshot: Playlist[]) => {
          writes.push(snapshot)
        }
      }
    }
  } as unknown as Window & typeof globalThis)
  const { controller, playlists } = fixture([track(1), track(2)])
  playlists.value = [{ id: 'existing', name: 'Mix', trackIds: ['1'], createdAt: '2026-01-01' }]
  const results = controller.importPlaylistPathBatch([
    { name: ' Mix ', paths: [track(2).filePath, track(1).filePath, track(2).filePath] },
    { name: 'Missing', paths: ['D:/Music/missing.flac'] },
    { name: 'Relative', paths: ['1.flac'] }
  ])
  assert.equal(results[0].playlistId, 'existing')
  assert.equal(results[0].importedCount, 3)
  assert.equal(results[1].unresolvedEntries, 1)
  assert.deepEqual(
    playlists.value.map((p) => p.trackIds),
    [['1', '2'], [], ['1']]
  )
  assert.equal(await controller.flushPlaylists(), true)
  assert.equal(writes.length, 1)
  const document = controller.importPlaylistDocument(
    'Document',
    'mix.m3u8',
    '#EXTM3U\nD:/Music/2.flac\n1.flac'
  )
  assert.equal(document.importedCount, 2)
  assert.deepEqual(playlists.value.at(-1)?.trackIds, ['2', '1'])
  await controller.flushPlaylists()
})

test('validates the entire batch before changing any playlist', () => {
  const { controller, playlists } = fixture([track(1)])
  assert.throws(
    () =>
      controller.importPlaylistPathBatch([
        { name: 'Valid', paths: [track(1).filePath] },
        { name: 'x'.repeat(81), paths: [track(1).filePath] }
      ]),
    /80/
  )
  assert.deepEqual(playlists.value, [])
})

test('large batches build one library index and clone only the transaction endpoints', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (() => 0) as unknown as typeof setTimeout)
  mockWindow(t, { api: { data: { savePlaylists: async () => {} } } })
  const clones = t.mock.method(globalThis, 'structuredClone')
  const library = Array.from({ length: 10_000 }, (_, i) => track(i))
  let pathReads = 0
  Object.defineProperty(library.at(-1)!, 'filePath', {
    get: () => {
      pathReads++
      return 'D:/Music/9999.flac'
    }
  })
  const { controller } = fixture(library)
  const paths = library.slice(0, 1000).map((item) => item.filePath)
  const start = performance.now()
  const results = controller.importPlaylistPathBatch(
    Array.from({ length: 100 }, (_, i) => ({
      name: `Playlist ${i}`,
      paths
    }))
  )
  t.diagnostic(
    `100 playlists × 1000 paths, 10000 library tracks: ${Math.round(performance.now() - start)} ms`
  )
  assert.equal(results.length, 100)
  assert.ok(results.every((result) => result.importedCount === 1000))
  assert.equal(pathReads, 1)
  assert.equal(clones.mock.callCount(), 2)
  await controller.flushPlaylists()
})

test('batched persistence replays its delta across a revision conflict', async (t) => {
  t.mock.method(globalThis, 'setTimeout', (() => 0) as unknown as typeof setTimeout)
  const concurrent: Playlist = {
    id: 'other',
    name: 'Other window',
    trackIds: ['9'],
    createdAt: '2026-01-01'
  }
  let saved: Playlist[] = []
  let attempts = 0
  mockWindow(t, {
    api: {
      data: {
        savePlaylists: async (snapshot: Playlist[], revision: number) => {
          if (++attempts === 1) {
            throw new PersistentDataRevisionConflictError(
              {
                version: 2,
                revision: 1,
                savedAt: '',
                data: [concurrent]
              },
              revision
            )
          }
          assert.equal(revision, 1)
          saved = snapshot
          return { version: 2, revision: 2, savedAt: '', data: snapshot }
        }
      }
    }
  } as unknown as Window & typeof globalThis)
  const { controller } = fixture([track(1), track(2)])
  controller.importPlaylistPathBatch([
    { name: 'One', paths: [track(1).filePath] },
    { name: 'Two', paths: [track(2).filePath] }
  ])
  assert.equal(await controller.flushPlaylists(), true)
  assert.deepEqual(saved.map((p) => p.name).sort(), ['One', 'Other window', 'Two'])
})
