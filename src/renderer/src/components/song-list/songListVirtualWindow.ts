export interface SongListVirtualWindowInput {
  trackCount: number
  scrollTop: number
  viewportHeight: number
  tableOffsetTop: number
  rowHeight: number
  overscanRows?: number
}

export interface SongListGridVirtualWindowInput {
  itemCount: number
  scrollTop: number
  viewportHeight: number
  gridOffsetTop: number
  columns: number
  rowStride: number
  overscanRows?: number
}

export interface SongListGridVirtualRange {
  start: number
  end: number
  startRow: number
  endRow: number
  columns: number
  rowStride: number
}

export interface GridLayoutMetrics {
  minColumnWidth: number
  columnGap: number
  rowGap: number
  padX: number
  padY: number
}

export const GRID_OVERSCAN_ROWS = 2
export const GRID_AZ_SCAN_OFFSET = 104
export const GRID_AZ_SCROLL_PADDING = 92

export function getSongListVirtualRange({
  trackCount,
  scrollTop,
  viewportHeight,
  tableOffsetTop,
  rowHeight,
  overscanRows = 6
}: SongListVirtualWindowInput): { start: number; end: number } {
  const virtualScrollTop = Math.max(0, scrollTop - tableOffsetTop)
  const count = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2
  const start = Math.min(
    Math.max(0, trackCount - count),
    Math.max(0, Math.floor(virtualScrollTop / rowHeight) - overscanRows)
  )
  return {
    start: Math.max(0, start),
    end: Math.min(trackCount, start + count)
  }
}

export interface SongListTrackScrollTopInput {
  index: number
  trackCount: number
  viewportHeight: number
  tableOffsetTop: number
  rowHeight: number
}

/**
 * Center the requested track in the scroller while accounting for the table's
 * current offset inside it. The offset is measured rather than guessed because
 * album detail headers, search status and empty-state transitions all change the
 * distance between the scroller top and the first row.
 */
export function getSongListTrackScrollTopForIndex({
  index,
  trackCount,
  viewportHeight,
  tableOffsetTop,
  rowHeight
}: SongListTrackScrollTopInput): number {
  const safeTrackCount = Math.max(0, Math.floor(trackCount))
  if (safeTrackCount === 0) return 0
  const safeRowHeight = Math.max(1, rowHeight)
  const safeViewportHeight = Math.max(0, viewportHeight)
  const safeTableOffset = Math.max(0, tableOffsetTop)
  const safeIndex = Math.min(safeTrackCount - 1, Math.max(0, Math.floor(index)))
  const maxScrollTop = Math.max(
    0,
    safeTableOffset + safeTrackCount * safeRowHeight - safeViewportHeight
  )
  const centered =
    safeTableOffset + safeIndex * safeRowHeight - (safeViewportHeight - safeRowHeight) / 2
  return Math.min(maxScrollTop, Math.max(0, centered))
}

export function resolveGridLayoutMetrics(viewportWidth: number): GridLayoutMetrics {
  if (viewportWidth <= 640) {
    return { minColumnWidth: 128, columnGap: 10, rowGap: 12, padX: 16, padY: 18 }
  }
  if (viewportWidth <= 900) {
    return { minColumnWidth: 160, columnGap: 14, rowGap: 16, padX: 20, padY: 22 }
  }
  return { minColumnWidth: 192, columnGap: 20, rowGap: 22, padX: 26, padY: 28 }
}

export function estimateGridColumns(containerWidth: number, viewportWidth: number): number {
  const { minColumnWidth, columnGap } = resolveGridLayoutMetrics(viewportWidth)
  const width = Math.max(0, containerWidth)
  return Math.max(1, Math.floor((width + columnGap) / (minColumnWidth + columnGap)))
}

export function estimateGridRowStride(columnWidth: number, viewportWidth: number): number {
  const { rowGap, padX, padY } = resolveGridLayoutMetrics(viewportWidth)
  const cover = Math.max(1, columnWidth - padX)
  const textBlock = 46
  return Math.max(1, Math.round(cover + padY + textBlock + rowGap))
}

export function estimateAlbumGridRowStride(
  columnWidth: number,
  viewportWidth: number,
  bodyFontSize = 14
): number {
  // Artwork is edge-to-edge; two title lines and two metadata lines keep cards uniform.
  const textHeight = bodyFontSize * (2.8 + 0.93 * 1.5 + 0.82 * 1.5)
  return Math.max(
    1,
    Math.ceil(columnWidth + textHeight + 26 + resolveGridLayoutMetrics(viewportWidth).rowGap)
  )
}

export function getSongListGridVirtualRange({
  itemCount,
  scrollTop,
  viewportHeight,
  gridOffsetTop,
  columns,
  rowStride,
  overscanRows = GRID_OVERSCAN_ROWS
}: SongListGridVirtualWindowInput): SongListGridVirtualRange {
  const safeCount = Math.max(0, Math.floor(itemCount))
  const safeColumns = Math.max(1, Math.floor(columns))
  const safeStride = Math.max(1, rowStride)
  const totalRows = Math.ceil(safeCount / safeColumns)
  const virtualScrollTop = Math.max(0, scrollTop - gridOffsetTop)
  const startRow = Math.max(0, Math.floor(virtualScrollTop / safeStride) - overscanRows)
  const visibleRows = Math.ceil(Math.max(0, viewportHeight) / safeStride) + overscanRows * 2
  const endRow = Math.min(totalRows, startRow + visibleRows)
  return {
    start: Math.min(safeCount, startRow * safeColumns),
    end: Math.min(safeCount, endRow * safeColumns),
    startRow,
    endRow,
    columns: safeColumns,
    rowStride: safeStride
  }
}

export function getSongListGridScrollTopForIndex(
  index: number,
  itemCount: number,
  columns: number,
  rowStride: number,
  gridOffsetTop: number,
  headerPadding = GRID_AZ_SCROLL_PADDING
): number {
  const safeCount = Math.max(0, Math.floor(itemCount))
  if (safeCount === 0) return 0
  const safeColumns = Math.max(1, Math.floor(columns))
  const safeStride = Math.max(1, rowStride)
  const safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)))
  const row = Math.floor(safeIndex / safeColumns)
  return Math.max(0, gridOffsetTop + row * safeStride - headerPadding)
}

export function maxMountedGridCards(
  viewportHeight: number,
  rowStride: number,
  columns: number,
  overscanRows = GRID_OVERSCAN_ROWS
): number {
  const safeColumns = Math.max(1, Math.floor(columns))
  const visibleRows = Math.ceil(Math.max(0, viewportHeight) / Math.max(1, rowStride))
  return (visibleRows + overscanRows * 2) * safeColumns
}
