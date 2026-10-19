import assert from 'node:assert/strict'
import test from 'node:test'
import {
  estimateGridColumns,
  getSongListVirtualRange,
  getSongListGridScrollTopForIndex,
  getSongListTrackScrollTopForIndex,
  getSongListGridVirtualRange,
  GRID_OVERSCAN_ROWS,
  maxMountedGridCards
} from './songListVirtualWindow.ts'

test('grid virtual window mounts only viewport + overscan cards', () => {
  const itemCount = 4_000
  const columns = 5
  const rowStride = 260
  const viewportHeight = 720
  const overscanRows = GRID_OVERSCAN_ROWS
  const cap = maxMountedGridCards(viewportHeight, rowStride, columns, overscanRows)

  for (const scrollTop of [0, 2_400, 18_000, 80_000, 200_000]) {
    const range = getSongListGridVirtualRange({
      itemCount,
      scrollTop,
      viewportHeight,
      gridOffsetTop: 180,
      columns,
      rowStride,
      overscanRows
    })
    const mounted = range.end - range.start
    assert.ok(mounted <= cap, `mounted ${mounted} exceeds cap ${cap} at scroll ${scrollTop}`)
    assert.ok(mounted > 0)
    assert.equal(range.start % columns, 0)
  }
})

test('table window keeps rows above the viewport and clamps stale offsets after filtering', () => {
  const input = {
    trackCount: 4000,
    scrollTop: 5000,
    viewportHeight: 700,
    tableOffsetTop: 300,
    rowHeight: 68
  }
  const range = getSongListVirtualRange(input)
  const firstVisible = Math.floor((input.scrollTop - input.tableOffsetTop) / input.rowHeight)
  assert.equal(range.start, firstVisible - 6)
  assert.ok(range.end > firstVisible + Math.ceil(input.viewportHeight / input.rowHeight))
  assert.deepEqual(getSongListVirtualRange({ ...input, trackCount: 3 }), { start: 0, end: 3 })
  assert.deepEqual(getSongListVirtualRange({ ...input, trackCount: 0 }), { start: 0, end: 0 })
})

test('A-Z jump scroll top lands the target index inside the window', () => {
  const itemCount = 800
  const columns = 4
  const rowStride = 240
  const gridOffsetTop = 160
  const viewportHeight = 640
  const index = firstIndexForLetter('M')

  const scrollTop = getSongListGridScrollTopForIndex(
    index,
    itemCount,
    columns,
    rowStride,
    gridOffsetTop
  )
  const range = getSongListGridVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    gridOffsetTop,
    columns,
    rowStride
  })
  assert.ok(index >= range.start && index < range.end)
})

test('track locate centers the active row inside the virtual table window', () => {
  const input = {
    trackCount: 4_000,
    viewportHeight: 700,
    tableOffsetTop: 280,
    rowHeight: 68
  }
  const index = 1_234
  const scrollTop = getSongListTrackScrollTopForIndex({ ...input, index })
  const range = getSongListVirtualRange({ ...input, scrollTop })
  assert.ok(index >= range.start && index < range.end)
  assert.equal(
    scrollTop,
    input.tableOffsetTop + index * input.rowHeight - (input.viewportHeight - input.rowHeight) / 2
  )

  assert.equal(getSongListTrackScrollTopForIndex({ ...input, index: 0 }), 0)
  assert.equal(
    getSongListTrackScrollTopForIndex({ ...input, index: input.trackCount - 1 }),
    input.tableOffsetTop + input.trackCount * input.rowHeight - input.viewportHeight
  )
  assert.equal(getSongListTrackScrollTopForIndex({ ...input, index: 2, trackCount: 0 }), 0)
})

test('grid column estimate follows the CSS auto-fill breakpoints', () => {
  assert.equal(estimateGridColumns(1_000, 1_280), 4)
  assert.equal(estimateGridColumns(400, 600), 2)
  assert.ok(estimateGridColumns(80, 1_280) >= 1)
})

function firstIndexForLetter(letter: string): number {
  const names = Array.from({ length: 800 }, (_, index) => {
    const code = 65 + (index % 26)
    return `${String.fromCharCode(code)}rtist ${index}`
  })
  return names.findIndex((name) => name.startsWith(letter))
}
