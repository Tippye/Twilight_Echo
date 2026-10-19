import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getPlaybackQueueWindow } from '../../utils/playbackQueueVirtualization.ts'

test('streaming lists reuse the queue virtual window instead of a growing prefix', () => {
  const source = readFileSync(new URL('./useProgressiveList.ts', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('./StreamingDetailStage.vue', import.meta.url), 'utf8')
  const social = readFileSync(new URL('./StreamingSocialStage.vue', import.meta.url), 'utf8')

  assert.match(source, /getPlaybackQueueWindow/)
  assert.match(source, /visibleStart/)
  assert.doesNotMatch(source, /visibleCount\.value \+ step/)
  // Detail rows now include video disclosures and pagers; playable rows carry
  // their original queue index rather than deriving it from the visual offset.
  assert.match(detail, /onPlayRow\(row\.track, row\.index, \$event\)/)
  assert.match(detail, /:ref="listRef"/)
  assert.match(social, /trackIndex\(index\)/)
  assert.match(social, /:ref="listRef"/)
})

test('a 3k streaming list window stays within viewport + overscan', () => {
  const rowHeight = 64
  const overscan = 8
  const viewportHeight = 720
  const total = 3_000
  const range = getPlaybackQueueWindow(total, 64_000, viewportHeight, rowHeight, overscan)
  const mounted = range.end - range.start
  const cap = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  assert.ok(mounted <= cap, `mounted ${mounted} exceeds ${cap}`)
  assert.ok(range.start > 0)
  assert.ok(range.end < total)
})
