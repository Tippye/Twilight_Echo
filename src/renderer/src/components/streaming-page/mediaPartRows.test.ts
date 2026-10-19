import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMediaPartRows } from './mediaPartRows.ts'
import type { Track } from '../../types/music'

const parts = Array.from(
  { length: 47 },
  (_, i) =>
    ({
      id: `bili:video:${i}`,
      title: `Collection - Movement ${i + 1}`,
      duration: 120,
      mediaPart: {
        groupId: 'video',
        groupTitle: 'Collection',
        title: `Movement ${i + 1}`,
        index: i + 1,
        count: 47
      }
    }) as Track
)
const single = { id: 'single', title: 'Single' } as Track

test('videos start folded, while ordinary tracks retain their queue indices', () => {
  const rows = buildMediaPartRows([...parts, single], {})
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'group')
  assert.equal(rows[1].kind, 'track')
  if (rows[1].kind === 'track') assert.equal(rows[1].index, 47)
})

test('20-part pages preserve exact track identities through the final partial page', () => {
  for (const [page, expected] of [
    [0, 20],
    [1, 20],
    [2, 7]
  ]) {
    const rows = buildMediaPartRows(parts, { video: { expanded: true, page } })
    const tracks = rows.filter((row) => row.kind === 'track')
    assert.equal(tracks.length, expected)
    assert.deepEqual(
      tracks.map((row) => row.track.id),
      parts.slice(page * 20, page * 20 + expected).map((track) => track.id)
    )
    assert.equal(tracks[0].index, page * 20)
  }
})

test('search shows matching part names with original P numbers and filtered queue indices', () => {
  const filtered = [parts[26], parts[41]]
  const rows = buildMediaPartRows(filtered, {}, true)
  assert.deepEqual(
    rows
      .filter((row) => row.kind === 'track')
      .map((row) => [row.track.mediaPart?.index, row.index]),
    [
      [27, 0],
      [42, 1]
    ]
  )
  assert.equal(
    buildMediaPartRows(filtered, { video: { expanded: false, page: 0 } }, true).length,
    1
  )
})

test('sort order and independent video pagination survive collapsing and a shrinking list', () => {
  const other = {
    ...parts[0],
    id: 'other',
    mediaPart: { ...parts[0].mediaPart!, groupId: 'other' }
  }
  const rows = buildMediaPartRows([other, ...parts.toReversed(), single], {
    video: { expanded: true, page: 1 },
    other: { expanded: false, page: 0 }
  })
  const tracks = rows.filter((row) => row.kind === 'track')
  assert.equal(tracks[0].track.id, parts[26].id)
  assert.equal(tracks[0].index, 21)
  const shrunk = buildMediaPartRows(parts.slice(0, 3), { video: { expanded: true, page: 2 } })
  assert.equal(shrunk.filter((row) => row.kind === 'track').length, 3)
})
