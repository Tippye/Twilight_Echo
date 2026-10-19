/**
 * Reveal thresholds and placement math for the shared "back to top" control.
 *
 * Kept free of DOM access so the thresholds, the scrollbar gutter inset and the
 * player-bar clamp stay unit-testable with plain numbers; scrollToTopButton.ts
 * owns the live element and the event wiring.
 */

/** Short panels and popovers never get the control — it would cover their content. */
export const SCROLL_TOP_MIN_CONTAINER_HEIGHT = 320
export const SCROLL_TOP_REVEAL_MIN_PX = 240
export const SCROLL_TOP_REVEAL_MAX_PX = 420
export const SCROLL_TOP_BUTTON_SIZE = 40
export const SCROLL_TOP_EDGE_GAP = 16
export const SCROLL_CONTROL_STACK_GAP = 8

export interface ScrollTopMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export interface ScrollTopRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
}

export interface ScrollTopObstruction {
  top: number
  left: number
  right: number
}

export interface ScrollTopAnchorInput {
  rect: ScrollTopRect
  /** Excludes the scrollbar gutter, so the button never straddles the thumb. */
  clientWidth: number
  viewportWidth: number
  viewportHeight: number
  /** Bottom-docked chrome (the player bar) the controls must stay clear of. */
  obstruction?: ScrollTopObstruction | null
  buttonSize?: number
  gap?: number
  /** Controls are stacked vertically; the locate action sits below back-to-top. */
  controlCount?: number
}

export interface ScrollTopAnchor {
  left: number
  top: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Half a viewport of travel, floored and capped: a tall page should not have to
 * scroll most of its height before the control shows up, and a 400px panel
 * should not surface it after two rows.
 */
export function resolveScrollTopRevealDistance(clientHeight: number): number {
  return clamp(clientHeight * 0.5, SCROLL_TOP_REVEAL_MIN_PX, SCROLL_TOP_REVEAL_MAX_PX)
}

/** Can this container host the control at all, whatever its current offset is. */
export function isScrollTopContainerEligible(
  metrics: Pick<ScrollTopMetrics, 'clientHeight' | 'scrollHeight'>
): boolean {
  if (metrics.clientHeight < SCROLL_TOP_MIN_CONTAINER_HEIGHT) return false
  return metrics.scrollHeight - metrics.clientHeight >= 8
}

export function isScrollTopRevealed(metrics: ScrollTopMetrics): boolean {
  if (!isScrollTopContainerEligible(metrics)) return false
  return metrics.scrollTop >= resolveScrollTopRevealDistance(metrics.clientHeight)
}

/**
 * Bottom-right of the container's client box, in viewport coordinates. Returns
 * null when the container is too small or too far off-screen to host it.
 */
export function resolveScrollTopAnchor(input: ScrollTopAnchorInput): ScrollTopAnchor | null {
  const size = input.buttonSize ?? SCROLL_TOP_BUTTON_SIZE
  const gap = input.gap ?? SCROLL_TOP_EDGE_GAP
  const controlCount = Math.max(1, Math.floor(input.controlCount ?? 1))
  const rect = input.rect
  // getBoundingClientRect spans the border box while clientWidth stops before
  // the scrollbar; the difference is the gutter to sit inside of.
  const gutter = Math.max(0, rect.width - input.clientWidth)
  const right = Math.min(rect.right - gutter, input.viewportWidth) - gap

  let bottomEdge = Math.min(rect.bottom, input.viewportHeight)
  const obstruction = input.obstruction
  // Only a bar that actually spans this container's columns can cover the
  // control; a narrow one docked elsewhere must not push it up.
  if (obstruction && obstruction.left < rect.right && obstruction.right > rect.left) {
    bottomEdge = Math.min(bottomEdge, obstruction.top)
  }

  const left = right - size
  const stackHeight = size * controlCount + SCROLL_CONTROL_STACK_GAP * (controlCount - 1)
  const top = bottomEdge - gap - stackHeight
  if (top < rect.top + gap || left < rect.left + gap) return null
  if (top < 0 || left < 0) return null
  return { left: Math.round(left), top: Math.round(top) }
}
