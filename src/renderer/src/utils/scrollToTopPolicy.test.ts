import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SCROLL_CONTROL_STACK_GAP,
  SCROLL_TOP_BUTTON_SIZE,
  SCROLL_TOP_EDGE_GAP,
  SCROLL_TOP_MIN_CONTAINER_HEIGHT,
  SCROLL_TOP_REVEAL_MAX_PX,
  SCROLL_TOP_REVEAL_MIN_PX,
  isScrollTopContainerEligible,
  isScrollTopRevealed,
  resolveScrollTopAnchor,
  resolveScrollTopRevealDistance
} from './scrollToTopPolicy.ts'

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width }
}

test('reveal distance is half a viewport, floored for panels and capped for tall pages', () => {
  assert.equal(resolveScrollTopRevealDistance(360), SCROLL_TOP_REVEAL_MIN_PX)
  assert.equal(resolveScrollTopRevealDistance(700), 350)
  assert.equal(resolveScrollTopRevealDistance(2000), SCROLL_TOP_REVEAL_MAX_PX)
})

test('short containers and containers with nothing to scroll stay ineligible', () => {
  assert.equal(
    isScrollTopContainerEligible({
      clientHeight: SCROLL_TOP_MIN_CONTAINER_HEIGHT - 1,
      scrollHeight: 4000
    }),
    false
  )
  assert.equal(isScrollTopContainerEligible({ clientHeight: 800, scrollHeight: 804 }), false)
  assert.equal(isScrollTopContainerEligible({ clientHeight: 800, scrollHeight: 4000 }), true)
})

test('the control only appears once the container is scrolled past its reveal distance', () => {
  const metrics = { clientHeight: 700, scrollHeight: 5000 }
  assert.equal(isScrollTopRevealed({ ...metrics, scrollTop: 349 }), false)
  assert.equal(isScrollTopRevealed({ ...metrics, scrollTop: 350 }), true)
  // A tall list scrolled far still hides again when it returns near the top.
  assert.equal(isScrollTopRevealed({ ...metrics, scrollTop: 0 }), false)
})

test('the anchor sits inside the scrollbar gutter at the bottom-right of the client box', () => {
  const anchor = resolveScrollTopAnchor({
    rect: rect(0, 0, 1200, 800),
    clientWidth: 1190,
    viewportWidth: 1200,
    viewportHeight: 800
  })
  assert.deepEqual(anchor, {
    left: 1200 - 10 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE,
    top: 800 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE
  })
})

test('a locate action reserves a second control below back-to-top', () => {
  const anchor = resolveScrollTopAnchor({
    rect: rect(0, 0, 1200, 800),
    clientWidth: 1200,
    viewportWidth: 1200,
    viewportHeight: 800,
    obstruction: { top: 700, left: 0, right: 1200 },
    controlCount: 2
  })
  assert.ok(anchor)
  const locateTop = anchor.top + SCROLL_TOP_BUTTON_SIZE + SCROLL_CONTROL_STACK_GAP
  assert.equal(
    anchor.top,
    700 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE * 2 - SCROLL_CONTROL_STACK_GAP
  )
  assert.equal(locateTop + SCROLL_TOP_BUTTON_SIZE, 700 - SCROLL_TOP_EDGE_GAP)
})

test('a two-control stack needs room for both controls', () => {
  assert.equal(
    resolveScrollTopAnchor({
      rect: rect(0, 0, 1200, 800),
      clientWidth: 1200,
      viewportWidth: 1200,
      viewportHeight: 800,
      obstruction: { top: 100, left: 0, right: 1200 },
      controlCount: 2
    }),
    null
  )
})

test('a player bar spanning the container lifts the anchor above it', () => {
  const anchor = resolveScrollTopAnchor({
    rect: rect(0, 0, 1200, 800),
    clientWidth: 1200,
    viewportWidth: 1200,
    viewportHeight: 800,
    obstruction: { top: 700, left: 0, right: 1200 }
  })
  assert.equal(anchor?.top, 700 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE)
})

test('a bar docked beside the container never pushes the anchor up', () => {
  const anchor = resolveScrollTopAnchor({
    rect: rect(0, 0, 300, 800),
    clientWidth: 300,
    viewportWidth: 1200,
    viewportHeight: 800,
    obstruction: { top: 700, left: 400, right: 1200 }
  })
  assert.equal(anchor?.top, 800 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE)
})

test('a container extending past the viewport keeps the control on screen', () => {
  const anchor = resolveScrollTopAnchor({
    rect: rect(0, 0, 1600, 900),
    clientWidth: 1600,
    viewportWidth: 1200,
    viewportHeight: 800
  })
  assert.deepEqual(anchor, {
    left: 1200 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE,
    top: 800 - SCROLL_TOP_EDGE_GAP - SCROLL_TOP_BUTTON_SIZE
  })
})

test('containers too small or too far off-screen to host the control return no anchor', () => {
  assert.equal(
    resolveScrollTopAnchor({
      rect: rect(0, 0, 60, 700),
      clientWidth: 60,
      viewportWidth: 1200,
      viewportHeight: 800
    }),
    null
  )
  assert.equal(
    resolveScrollTopAnchor({
      rect: rect(0, 300, 1200, 60),
      clientWidth: 1200,
      viewportWidth: 1200,
      viewportHeight: 800
    }),
    null
  )
  assert.equal(
    resolveScrollTopAnchor({
      rect: rect(0, 0, 1200, 800),
      clientWidth: 1200,
      viewportWidth: 1200,
      viewportHeight: 800,
      obstruction: { top: 20, left: 0, right: 1200 }
    }),
    null
  )
})
