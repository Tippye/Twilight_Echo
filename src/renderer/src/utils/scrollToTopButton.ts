import {
  SCROLL_CONTROL_STACK_GAP,
  SCROLL_TOP_BUTTON_SIZE,
  isScrollTopContainerEligible,
  isScrollTopRevealed,
  resolveScrollTopAnchor,
  type ScrollTopAnchor,
  type ScrollTopObstruction
} from './scrollToTopPolicy'
import { scrollMotionBehavior } from '../app/scrollMotion'

/**
 * Shared floating scroll controls for every scroll container in the window.
 *
 * The renderer has dozens of independent scroll containers spread across pages,
 * drawers and dialogs, so this is delegated the same way autoHideScrollbars.ts
 * delegates: a document-level listener resolves whichever container the user is
 * scrolling or pointing at, and fixed-position controls are anchored to that
 * container's bottom-right corner. Containers opt out with
 * `data-te-scroll-top="off"`; `inert` subtrees (the theme studio live preview)
 * are skipped automatically.
 *
 * A song page may opt into the locate action with
 * `data-te-locate-current="true"`. The second control then appears below
 * back-to-top and emits `te-locate-current` on the active scroller. The page owns
 * both the availability rule and the actual row lookup, so this module never
 * needs to know about player or library stores.
 */

const TOP_BUTTON_CLASS = 'te-scroll-top'
const LOCATE_BUTTON_CLASS = 'te-scroll-locate'
const LOCATE_ATTRIBUTE = 'data-te-locate-current'
const LOCATE_EVENT = 'te-locate-current'
const SKIP_SELECTOR = '[inert], [data-te-scroll-top="off"]'
/** Geometry and occlusion only change on layout, not while scrolling. */
const GEOMETRY_REFRESH_INTERVAL_MS = 200
/** Outlasts `--te-motion-page` so a page swap cannot leave the controls behind. */
const NAVIGATION_SETTLE_MS = 460

let topButton: HTMLButtonElement | null = null
let locateButton: HTMLButtonElement | null = null
let scroller: HTMLElement | null = null
let anchor: ScrollTopAnchor | null = null
let cachedClientHeight = 0
let cachedScrollHeight = 0
let geometryStamp = Number.NEGATIVE_INFINITY
let appliedAnchor = ''
let visible = false
let locateAvailable = false
let frame: number | null = null
let pointerFrame: number | null = null
let pendingPointerTarget: Element | null = null
let settleTimer: number | null = null
let locateAttributeObserver: MutationObserver | null = null

function isVerticallyScrollable(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + 1) return false
  const overflowY = window.getComputedStyle(element).overflowY
  return /(auto|scroll|overlay)/.test(overflowY)
}

function findScrollTarget(start: Element | null): HTMLElement | null {
  if (!start || start.closest(SKIP_SELECTOR)) return null
  let current: HTMLElement | null =
    start instanceof HTMLElement ? start : (start.parentElement ?? null)
  while (current) {
    if (isVerticallyScrollable(current)) return current
    current = current.parentElement
  }
  return null
}

function isControlElement(element: Element | null): boolean {
  return (
    !!element &&
    ((!!topButton && (element === topButton || topButton.contains(element))) ||
      (!!locateButton && (element === locateButton || locateButton.contains(element))))
  )
}

function isLocateAvailable(target: HTMLElement | null): boolean {
  return target?.dataset.teLocateCurrent === 'true'
}

function ensureTopButton(): HTMLButtonElement {
  if (topButton) return topButton
  const element = document.createElement('button')
  element.type = 'button'
  element.className = TOP_BUTTON_CLASS
  element.title = '回到开头'
  element.setAttribute('aria-label', '回到开头')
  element.dataset.teScrollTopVisible = 'false'
  // Size stays here rather than in base.css: the anchor math reserves exactly
  // this box, so a theme resizing the control would misplace it.
  element.style.width = `${SCROLL_TOP_BUTTON_SIZE}px`
  element.style.height = `${SCROLL_TOP_BUTTON_SIZE}px`
  const icon = document.createElement('i')
  icon.className = 'ph ph-arrow-up'
  icon.setAttribute('aria-hidden', 'true')
  element.append(icon)
  element.addEventListener('click', onTopClick)
  document.body.append(element)
  topButton = element
  return element
}

function ensureLocateButton(): HTMLButtonElement {
  if (locateButton) return locateButton
  const element = document.createElement('button')
  element.type = 'button'
  element.className = LOCATE_BUTTON_CLASS
  element.title = '定位到正在播放的歌曲'
  element.setAttribute('aria-label', '定位到正在播放的歌曲')
  element.dataset.teScrollLocateVisible = 'false'
  element.style.width = `${SCROLL_TOP_BUTTON_SIZE}px`
  element.style.height = `${SCROLL_TOP_BUTTON_SIZE}px`
  const icon = document.createElement('i')
  icon.className = 'pi pi-map-marker'
  icon.setAttribute('aria-hidden', 'true')
  element.append(icon)
  element.addEventListener('click', onLocateClick)
  document.body.append(element)
  locateButton = element
  return element
}

/**
 * The bar overlaps the bottom of every full-height page container, so the
 * controls have to stop above it. An auto-hidden mini bar keeps its layout box
 * while translated away — the shell publishes both hidden states as flags.
 */
function resolvePlayerBarObstruction(): ScrollTopObstruction | null {
  const shell = document.querySelector<HTMLElement>('.player-bar-shell')
  if (!shell) return null
  if (shell.dataset.tePlaybarHidden === 'true') return null
  if (shell.dataset.tePlaybarVisibility === 'hidden') return null
  const rect = shell.getBoundingClientRect()
  if (rect.height <= 0) return null
  return { top: rect.top, left: rect.left, right: rect.right }
}

/**
 * Hit-testing the spot the controls want answers the only question that matters
 * — "would a click there land in this container?" — without knowing anybody's
 * z-index. It covers a container left scrolled under a full overlay (the
 * now-playing page, a modal, the settings surface) and a panel that only takes
 * the corner, such as the playback queue drawer above the player bar. The
 * controls themselves are filtered out of the stack so they cannot mask their
 * own probes.
 */
function isCovered(target: HTMLElement, at: ScrollTopAnchor): boolean {
  const x = Math.round(at.left + SCROLL_TOP_BUTTON_SIZE / 2)
  const y = Math.round(at.top + SCROLL_TOP_BUTTON_SIZE / 2)
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return true
  for (const hit of document.elementsFromPoint(x, y)) {
    if (isControlElement(hit)) continue
    return !(hit === target || target.contains(hit) || hit.contains(target))
  }
  return true
}

function locateAnchorFor(at: ScrollTopAnchor): ScrollTopAnchor {
  return {
    left: at.left,
    top: at.top + SCROLL_TOP_BUTTON_SIZE + SCROLL_CONTROL_STACK_GAP
  }
}

function refreshGeometry(target: HTMLElement, now: number): void {
  geometryStamp = now
  anchor = null
  cachedClientHeight = target.clientHeight
  cachedScrollHeight = target.scrollHeight
  if (
    !isScrollTopContainerEligible({
      clientHeight: cachedClientHeight,
      scrollHeight: cachedScrollHeight
    })
  ) {
    return
  }
  const candidate = resolveScrollTopAnchor({
    rect: target.getBoundingClientRect(),
    clientWidth: target.clientWidth,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    obstruction: resolvePlayerBarObstruction(),
    controlCount: locateAvailable ? 2 : 1
  })
  if (!candidate) return
  if (isCovered(target, candidate)) return
  // A panel can cover only the lower part of the stack. Keep both controls off
  // screen unless every visible control has a clickable target.
  if (locateAvailable && isCovered(target, locateAnchorFor(candidate))) return
  anchor = candidate
}

function positionLocateButton(): void {
  if (!locateButton || !anchor) return
  const next = locateAnchorFor(anchor)
  locateButton.style.left = `${next.left}px`
  locateButton.style.top = `${next.top}px`
}

function applyAnchor(next: ScrollTopAnchor): void {
  const element = ensureTopButton()
  const key = `${next.left}:${next.top}`
  if (appliedAnchor !== key) {
    appliedAnchor = key
    element.style.left = `${next.left}px`
    element.style.top = `${next.top}px`
  }
  positionLocateButton()
}

function setVisible(next: boolean): void {
  visible = next
  if (next) ensureTopButton().dataset.teScrollTopVisible = 'true'
  else if (topButton) topButton.dataset.teScrollTopVisible = 'false'
  if (!next) setLocateVisible(false)
}

function setLocateVisible(next: boolean): void {
  const shouldShow = next && locateAvailable && visible
  if (shouldShow) {
    ensureLocateButton().dataset.teScrollLocateVisible = 'true'
    positionLocateButton()
  } else if (locateButton) {
    locateButton.dataset.teScrollLocateVisible = 'false'
  }
}

function update(): void {
  const target = scroller
  const nextLocateAvailable = isLocateAvailable(target)
  if (nextLocateAvailable !== locateAvailable) {
    locateAvailable = nextLocateAvailable
    // The stack grows/shrinks, so its reserved height and hit-test anchors move.
    geometryStamp = Number.NEGATIVE_INFINITY
    appliedAnchor = ''
    if (!locateAvailable) setLocateVisible(false)
  }
  if (!target || !target.isConnected || target.clientHeight === 0) {
    setVisible(false)
    return
  }
  const now = performance.now()
  if (now - geometryStamp >= GEOMETRY_REFRESH_INTERVAL_MS) refreshGeometry(target, now)
  if (!anchor) {
    setVisible(false)
    return
  }
  const revealed = isScrollTopRevealed({
    scrollTop: target.scrollTop,
    clientHeight: cachedClientHeight,
    scrollHeight: cachedScrollHeight
  })
  if (!revealed) {
    setVisible(false)
    return
  }
  applyAnchor(anchor)
  setVisible(true)
  setLocateVisible(locateAvailable)
}

function scheduleUpdate(): void {
  if (frame !== null || document.hidden) return
  frame = window.requestAnimationFrame(() => {
    frame = null
    update()
  })
}

function setScroller(next: HTMLElement | null): void {
  if (scroller === next) return
  scroller = next
  locateAvailable = isLocateAvailable(next)
  anchor = null
  appliedAnchor = ''
  geometryStamp = Number.NEGATIVE_INFINITY
  setVisible(false)
  scheduleUpdate()
}

function invalidateGeometry(): void {
  geometryStamp = Number.NEGATIVE_INFINITY
  scheduleUpdate()
}

/** Page swaps mount and unmount containers without a scroll event of their own. */
function scheduleSettleCheck(): void {
  if (document.hidden) return
  invalidateGeometry()
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    invalidateGeometry()
  }, NAVIGATION_SETTLE_MS)
}

function onTopClick(): void {
  const target = scroller
  if (!target) return
  // Visibility is left to the scroll events the animation emits, so the control
  // fades exactly when the offset drops back under the reveal distance.
  target.scrollTo({ top: 0, behavior: scrollMotionBehavior() })
}

function onLocateClick(): void {
  const target = scroller
  if (!target || !isLocateAvailable(target)) return
  target.dispatchEvent(new CustomEvent(LOCATE_EVENT))
}

function onScroll(event: Event): void {
  if (document.hidden) return
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target === scroller) {
    scheduleUpdate()
    return
  }
  if (target.closest(SKIP_SELECTOR)) {
    setScroller(null)
    return
  }
  // A horizontal carousel inside a scrolled page must not steal the control.
  if (!isVerticallyScrollable(target)) return
  setScroller(target)
}

function applyPointerTarget(): void {
  const target = pendingPointerTarget
  pendingPointerTarget = null
  if (!target) return
  // Pointing at a control itself must never retarget or hide it.
  if (isControlElement(target)) return
  const next = findScrollTarget(target)
  // Hovering non-scrollable chrome keeps whichever container is already active.
  if (next) setScroller(next)
}

function onPointerMove(event: PointerEvent): void {
  if (document.hidden) return
  pendingPointerTarget = event.target instanceof Element ? event.target : null
  if (pointerFrame !== null) return
  pointerFrame = window.requestAnimationFrame(() => {
    pointerFrame = null
    applyPointerTarget()
  })
}

/** Escape closes overlays and Enter activates navigation, both without a scroll. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' || event.key === 'Enter') scheduleSettleCheck()
}

function cancelPendingUpdates(): void {
  if (frame !== null) window.cancelAnimationFrame(frame)
  if (pointerFrame !== null) window.cancelAnimationFrame(pointerFrame)
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  frame = null
  pointerFrame = null
  settleTimer = null
  pendingPointerTarget = null
}

function onVisibilityChange(): void {
  if (document.hidden) {
    cancelPendingUpdates()
    setVisible(false)
  } else invalidateGeometry()
}

function onLocateAttributeChange(records: MutationRecord[]): void {
  if (!scroller) return
  if (records.some((record) => record.target === scroller)) invalidateGeometry()
}

export function installScrollToTopButton(): () => void {
  locateAttributeObserver = new MutationObserver(onLocateAttributeChange)
  locateAttributeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [LOCATE_ATTRIBUTE],
    subtree: true
  })
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('click', scheduleSettleCheck, { capture: true, passive: true })
  document.addEventListener('keydown', onKeyDown, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('resize', invalidateGeometry, { passive: true })

  return () => {
    document.removeEventListener('scroll', onScroll, true)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('click', scheduleSettleCheck, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('resize', invalidateGeometry)
    locateAttributeObserver?.disconnect()
    locateAttributeObserver = null
    cancelPendingUpdates()
    topButton?.removeEventListener('click', onTopClick)
    locateButton?.removeEventListener('click', onLocateClick)
    topButton?.remove()
    locateButton?.remove()
    topButton = null
    locateButton = null
    scroller = null
    anchor = null
    appliedAnchor = ''
    visible = false
    locateAvailable = false
    geometryStamp = Number.NEGATIVE_INFINITY
  }
}
