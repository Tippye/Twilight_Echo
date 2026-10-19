import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useSongListVirtualScroll } from './useSongListVirtualScroll.ts'

test('returning from an album restores its parent offset after the transition, ignoring temporary scroll events', async () => {
  const scope = effectScope()
  const key = ref('test:albums')
  const identity = computed(() => key.value)
  const scroll = scope.run(() =>
    useSongListVirtualScroll({
      displayTracks: computed(() => []),
      resetSources: [],
      shouldResetOnSearch: computed(() => false),
      debouncedSearchQuery: ref(''),
      viewKey: computed(() => key.value),
      viewIdentity: identity
    })
  )!
  const container = { clientHeight: 720, scrollTop: 0 } as HTMLElement
  scroll.containerRef.value = container
  scroll.restoreScrollAndMeasure()
  await nextTick()
  container.scrollTop = 2400
  scroll.onScroll({ target: container } as unknown as Event)
  key.value = 'test:albums:detail'
  await nextTick()
  container.scrollTop = 0
  scroll.onScroll({ target: container } as unknown as Event)
  scroll.restoreScrollAndMeasure()
  await nextTick()
  assert.equal(container.scrollTop, 0)
  key.value = 'test:albums'
  await nextTick()
  scroll.onScroll({ target: container } as unknown as Event)
  assert.equal(scroll.scrollTop.value, 2400)
  scroll.restoreScrollAndMeasure()
  await nextTick()
  assert.equal(container.scrollTop, 2400)
  scope.stop()
})

test('table coordinates stay relative to the scroller when a themed wrapper becomes the offset parent', () => {
  const scope = effectScope()
  const scroll = scope.run(() =>
    useSongListVirtualScroll({
      displayTracks: computed(
        () => Array.from({ length: 100 }, (_, index) => ({ id: String(index) })) as never[]
      ),
      resetSources: [],
      shouldResetOnSearch: computed(() => false),
      debouncedSearchQuery: ref('')
    })
  )!
  scroll.containerRef.value = {
    clientHeight: 700,
    clientTop: 1,
    scrollTop: 800,
    getBoundingClientRect: () => ({ top: 50 })
  } as unknown as HTMLElement
  scroll.tbodyRef.value = {
    offsetTop: 55,
    getBoundingClientRect: () => ({ top: -451 })
  } as unknown as HTMLElement
  scroll.updateViewportHeight()
  scroll.onScroll({ target: scroll.containerRef.value } as unknown as Event)
  const range = scroll.visibleRange.value
  assert.ok(range.start <= 7 && range.end > 7, 'the row at the viewport top must stay mounted')
  assert.equal(range.start, 1)
  scope.stop()
})

test('scrollToTrack brings an off-screen row into the virtual window', () => {
  const scope = effectScope()
  const scroll = scope.run(() =>
    useSongListVirtualScroll({
      displayTracks: computed(
        () => Array.from({ length: 4_000 }, (_, index) => ({ id: String(index) })) as never[]
      ),
      resetSources: [],
      shouldResetOnSearch: computed(() => false),
      debouncedSearchQuery: ref('')
    })
  )!
  const container = {
    clientHeight: 700,
    clientTop: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 })
  } as unknown as HTMLElement
  scroll.containerRef.value = container
  scroll.tbodyRef.value = {
    getBoundingClientRect: () => ({ top: 280 })
  } as unknown as HTMLElement
  scroll.updateViewportHeight()
  scroll.scrollToTrack(1_234)
  assert.ok(container.scrollTop > 0)
  assert.ok(scroll.visibleRange.value.start <= 1_234)
  assert.ok(scroll.visibleRange.value.end > 1_234)
  scope.stop()
})
