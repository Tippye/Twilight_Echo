import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { normalizeDesktopLyricsSettings } from '../../shared/desktopLyrics.ts'

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

test('desktop lyrics stay out of the Windows taskbar across focus and interaction updates', async () => {
  const main = await source('./desktopLyrics.ts')
  const applySettings = main.slice(
    main.indexOf('function applyWindowSettings'),
    main.indexOf('function clearTaskbarStackingTimer')
  )
  const settings = normalizeDesktopLyricsSettings({ version: 3 })
  let bounds = { x: 100, y: 100, width: settings.windowWidth, height: settings.windowHeight }
  let skipTaskbar = true
  let focusable = true
  let ignoreMouseEvents = false
  const win = {
    isDestroyed: () => false,
    setFocusable(value: boolean) {
      focusable = value
      // Electron's Windows implementation also calls SetSkipTaskbar(!focusable).
      skipTaskbar = !value
    },
    setSkipTaskbar(value: boolean) {
      skipTaskbar = value
    },
    setAlwaysOnTop: () => {},
    setIgnoreMouseEvents(value: boolean) {
      ignoreMouseEvents = value
    },
    getBounds: () => ({ ...bounds }),
    setBounds(value: Partial<typeof bounds>) {
      bounds = { ...bounds, ...value }
    },
    getPosition: () => [bounds.x, bounds.y],
    setPosition(x: number, y: number) {
      bounds = { ...bounds, x, y }
    }
  }
  const context = {
    runtime: { desktopLyricsWindow: win },
    getEffectiveDesktopLyricsSettings: () => settings,
    currentTaskbarBounds: () => ({ x: 100, y: 100, width: 320, height: 40 }),
    windowPosition: () => ({ x: 100, y: 100 }),
    clampToCurrentDisplay: (_win: unknown, x: number, y: number) => ({ x, y }),
    desktopLyricsPausedHidden: false,
    desktopLyricsInteractionActive: false,
    appliedTaskbarPlacement: false,
    taskbarStackingTimer: null,
    clearDesktopLyricsHoverTracking: () => {},
    clearTaskbarStackingTimer: () => {},
    syncDesktopLyricsHoverTracking: () => {},
    setInterval: () => ({ unref: () => {} }),
    applyWindowSettings: () => {}
  }
  runInNewContext(stripTypeScriptTypes(applySettings), context)

  for (const placement of ['desktop', 'taskbar', 'desktop'] as const) {
    settings.placement = placement
    for (const locked of [false, true]) {
      settings.locked = locked
      for (const interactionActive of [false, true]) {
        context.desktopLyricsInteractionActive = interactionActive
        for (const pausedHidden of [false, true]) {
          context.desktopLyricsPausedHidden = pausedHidden
          context.applyWindowSettings()
          assert.equal(skipTaskbar, true, `${placement} lyrics must never gain a taskbar entry`)
          assert.equal(focusable, placement !== 'taskbar')
          assert.equal(
            ignoreMouseEvents,
            placement === 'taskbar' || pausedHidden || (locked && !interactionActive)
          )
        }
      }
    }
  }
})

test('taskbar lyrics preserve translation preferences and fit both lines without changing saved settings', async () => {
  const main = await source('./desktopLyrics.ts')
  const effectiveSettings = main.slice(
    main.indexOf('export function getEffectiveDesktopLyricsSettings'),
    main.indexOf('function applyWindowSettings')
  )
  const createSettings = new Function(
    'runtime',
    'currentTaskbarBounds',
    'resolveDesktopLyricsFontFamily',
    `${stripTypeScriptTypes(effectiveSettings.replace('export ', ''))}; return getEffectiveDesktopLyricsSettings()`
  )
  for (const translationVisible of [true, false]) {
    for (const height of [28, 40, 48]) {
      const saved = normalizeDesktopLyricsSettings({
        version: 3,
        placement: 'taskbar',
        taskbarFontSize: 32,
        translationVisible
      })
      const before = structuredClone(saved)
      const effective = createSettings(
        { appSettings: { desktopLyrics: saved, lyricsAppearance: { styles: { active: {} } } } },
        () => ({ width: 320, height }),
        () => 'sans-serif'
      )
      assert.equal(effective.translationVisible, translationVisible)
      const contentHeight = effective.fontSize * 1.08 * (translationVisible ? 1.65 : 1)
      assert.ok(contentHeight + (translationVisible ? 4 : 2) <= height)
      assert.deepEqual(saved, before)
    }
  }
})

test('desktop lyrics v3 isolates host and satellite IPC capabilities', async () => {
  const main = await source('./desktopLyrics.ts')
  const preload = await source('../../preload/domains/desktopLyricsApi.ts')
  const entry = await source('../../preload/index.ts')

  assert.match(main, /isMainSender\(event\)/)
  assert.match(main, /isDesktopLyricsSender\(event\)/)
  assert.match(main, /desktopLyrics:publishSession/)
  assert.match(main, /desktopLyrics:bootstrap/)
  assert.match(preload, /desktopLyricsHostApi/)
  assert.match(preload, /desktopLyricsWindowApi/)
  assert.match(preload, /desktopLyrics:setInteractionActive/)
  assert.match(preload, /desktopLyrics:setPausedHidden/)
  assert.match(preload, /desktopLyrics:hoverIntent/)
  assert.match(entry, /desktopLyrics: desktopLyricsHostApi/)
  assert.match(
    entry,
    /if \(isDesktopLyricsDocument\(\)\)\s+return \{\s*diagnostics: diagnosticsApi,\s*desktopLyrics: desktopLyricsWindowApi,\s*experienceWindow: experienceWindowApi\s*\}/
  )
  assert.doesNotMatch(preload, /desktopLyrics:toggle/)
})

test('desktop lyrics validates payload size, shape, ranges, and message order', async () => {
  const main = await source('./desktopLyrics.ts')

  assert.match(main, /DESKTOP_LYRICS_MAX_CONTENT_BYTES/)
  assert.match(main, /stringifyJsonForIpcStorage\(raw, 'desktop lyrics session'/)
  assert.match(main, /lines\.length <= 10000/)
  assert.match(main, /words\.length <= 512/)
  assert.match(main, /value\.romanization == null/)
  assert.match(main, /Number\(value\.rate\) >= 0\.5/)
  assert.match(main, /clock\.epoch < current\.epoch/)
  assert.match(main, /clock\.sequence <= current\.sequence/)
})

test('desktop lyrics bootstraps before reveal and performs one crash recovery', async () => {
  const main = await source('./desktopLyrics.ts')
  const app = await source('../../renderer/src/desktop-lyrics/DesktopLyricsApp.vue')

  assert.match(main, /show: false/)
  assert.match(main, /desktopLyrics:ready/)
  assert.match(app, /await api\.bootstrap\(\)/)
  assert.match(app, /api\.ready\(\)/)
  assert.ok(app.indexOf('await api.bootstrap()') < app.indexOf('api.ready()'))
  assert.match(main, /desktopLyricsCrashRestarts >= 1/)
  assert.match(main, /runtime\.desktopLyricsCrashRestarts \+= 1/)
})

test('desktop lyrics uses constrained dragging and locked hover unlock forwarding', async () => {
  const main = await source('./desktopLyrics.ts')
  const app = await source('../../renderer/src/desktop-lyrics/DesktopLyricsApp.vue')

  assert.match(main, /screen\.getDisplayMatching/)
  assert.match(
    main,
    /const ignoreMouseEvents =\s*desktopLyricsPausedHidden \|\| \(settings\.locked && !desktopLyricsInteractionActive\)/
  )
  assert.match(main, /screen\.getCursorScreenPoint\(\)/)
  assert.match(main, /desktopLyrics:hoverIntent/)
  assert.match(main, /desktopLyrics:setInteractionActive/)
  assert.match(main, /const lockChanged = 'locked' in patch/)
  assert.match(
    main,
    /if \(lockChanged\) publishDesktopLyricsHoverIntent\(desktopLyricsPointerInside\)/
  )
  const hoverTracking = main.slice(
    main.indexOf('function refreshDesktopLyricsHoverIntent'),
    main.indexOf('export function syncDesktopLyricsSettings')
  )
  assert.doesNotMatch(hoverTracking, /desktopLyricsInteractionActive/)
  assert.match(app, /setPointerCapture/)
  assert.match(app, /api\.moveTo/)
  assert.match(app, /api\.moveEnd/)
})

test('desktop lyrics uses programmatic bounds updates so a non-resizable window can shrink', async () => {
  const main = await source('./desktopLyrics.ts')

  assert.match(
    main,
    /const bounds = win\.getBounds\(\)[\s\S]*?win\.setBounds\(\{[\s\S]*?width: settings\.windowWidth,[\s\S]*?height: settings\.windowHeight/
  )
  assert.doesNotMatch(main, /win\.setSize\(settings\.windowWidth, settings\.windowHeight\)/)
})

test('pause auto-hide makes the transparent native window click-through', async () => {
  const main = await source('./desktopLyrics.ts')
  const preload = await source('../../preload/domains/desktopLyricsApi.ts')
  const app = await source('../../renderer/src/desktop-lyrics/DesktopLyricsApp.vue')

  assert.match(
    main,
    /desktopLyricsPausedHidden \|\| \(settings\.locked && !desktopLyricsInteractionActive\)/
  )
  assert.match(main, /ipcMain\.handle\('desktopLyrics:setPausedHidden'/)
  assert.match(preload, /setPausedHidden: \(hidden: boolean\)/)
  assert.match(app, /setPausedHidden\(true\)/)
  assert.match(app, /setPausedHidden\(false\)/)
})

test('desktop lyrics resumes frozen and requests an authoritative snapshot', async () => {
  const main = await source('./desktopLyrics.ts')
  const clock = await source('../../renderer/src/desktop-lyrics/desktopLyricsClock.ts')

  assert.match(main, /powerMonitor\.on\('resume', requestDesktopLyricsResync\)/)
  assert.match(main, /desktopLyrics:freezeClock/)
  assert.match(main, /desktopLyrics:resyncRequested/)
  assert.match(clock, /current\.state === 'playing' && !frozen/)
})

test('desktop lyrics v3 removes presets and keeps a dedicated lock shortcut', async () => {
  const settings = await source('../core/settings.ts')
  const shared = await source('../../shared/appSettings.ts')
  const tray = await source('./shortcutsTray.ts')

  assert.match(settings, /normalizeDesktopLyricsSettings/)
  assert.doesNotMatch(settings, /desktopLyricsPresets/)
  assert.doesNotMatch(shared, /DesktopLyricsPreset/)
  assert.match(settings, /CommandOrControl\+Alt\+L/)
  assert.match(tray, /toggleDesktopLyricsLock/)
  assert.match(tray, /type: 'checkbox'/)
})
