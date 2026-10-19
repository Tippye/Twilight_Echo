import { createApp } from 'vue'
import MiniPlayerApp from './MiniPlayerApp.vue'
import {
  DEFAULT_MINI_PLAYER_SETTINGS,
  EMPTY_MINI_PLAYER_STATE,
  MINI_PLAYER_SIZE_PRESETS,
  cloneMiniPlayerSettings
} from '../../../shared/miniPlayer.ts'

const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}
const waitFor = async (condition, message) => {
  const deadline = Date.now() + 4000
  while (!condition()) {
    expect(Date.now() < deadline, message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const resize = (width, height) => window.resizeMiniPlayerTest(width, height)
const root = () => document.querySelector('.mini-player-root')
const panel = () => document.querySelector('.mini-customizer')
let saved
let mounted
let settingsListener
let failNextSave = false
let activeSaves = 0
let motionPreference = 'off'
const unhandledErrors = []
window.addEventListener('unhandledrejection', (event) => unhandledErrors.push(event.reason))

window.api = {
  miniPlayer: {
    getBootstrap: async () => ({
      settings: cloneMiniPlayerSettings(saved),
      state: { ...EMPTY_MINI_PLAYER_STATE },
      motionPreference
    }),
    updateSettings: async (candidate) => {
      activeSaves++
      try {
        if (failNextSave) {
          failNextSave = false
          throw new Error('undo persistence unavailable')
        }
        saved = cloneMiniPlayerSettings(candidate)
        await resize(saved.windowWidth, saved.windowHeight)
        settingsListener?.(cloneMiniPlayerSettings(saved))
        return cloneMiniPlayerSettings(saved)
      } finally {
        activeSaves--
      }
    },
    onState: () => () => {},
    onSettings: (listener) => {
      settingsListener = listener
      return () => {
        settingsListener = null
      }
    },
    onMotionPreference: () => () => {}
  }
}

async function mountPreset(preset) {
  mounted?.unmount()
  saved = cloneMiniPlayerSettings(DEFAULT_MINI_PLAYER_SETTINGS)
  saved.windowWidth = preset.width
  saved.windowHeight = preset.height
  await resize(preset.width, preset.height)
  mounted = createApp(MiniPlayerApp)
  mounted.mount('#app')
  await waitFor(() => root()?.classList.contains('is-ready'), 'mini player did not bootstrap')
}

async function openCustomizer() {
  document.querySelector('.tool-customize').click()
  await waitFor(() => panel() && activeSaves === 0, 'customizer did not open')
  expect(innerWidth >= 520 && innerHeight >= 340, 'customizer needs its expanded window')
}

async function changeTheme() {
  const previous = saved.activeStyleId
  document.querySelector('.customizer-theme-option:not(.active)').click()
  await waitFor(
    () => saved.activeStyleId !== previous && activeSaves === 0,
    'theme change did not persist'
  )
}

function undo() {
  document.querySelector('.mini-customizer-footer button').click()
}

async function expectPlayer(preset, theme) {
  await waitFor(
    () =>
      !panel() &&
      !root().classList.contains('is-customizing') &&
      innerWidth === preset.width &&
      innerHeight === preset.height &&
      activeSaves === 0,
    `${preset.id}: undo left the customizer open or failed to restore the player size`
  )
  expect(saved.activeStyleId === theme, 'wrong persisted theme after closing')
  expect(root().dataset.themeProfile === theme, 'wrong rendered theme after closing')
  expect(
    !document.querySelector('.mini-controls').inert,
    'playback controls stayed inert after closing'
  )
}

window.runMiniPlayerUndoTests = async () => {
  for (motionPreference of ['off', 'full']) {
    for (const preset of MINI_PLAYER_SIZE_PRESETS) {
      await mountPreset(preset)
      const original = cloneMiniPlayerSettings(saved)
      await openCustomizer()
      undo()
      await expectPlayer(preset, original.activeStyleId)

      await openCustomizer()
      await changeTheme()
      undo()
      await expectPlayer(preset, original.activeStyleId)
      expect(
        JSON.stringify(saved) === JSON.stringify(original),
        'undo did not restore the snapshot'
      )

      await openCustomizer()
      await changeTheme()
      const committedTheme = saved.activeStyleId
      document.querySelector('[aria-label="关闭自定义面板"]').click()
      await expectPlayer(preset, committedTheme)

      await openCustomizer()
      await changeTheme()
      undo()
      await expectPlayer(preset, committedTheme)
    }
  }

  const preset = MINI_PLAYER_SIZE_PRESETS[0]
  await mountPreset(preset)
  const originalTheme = saved.activeStyleId
  await openCustomizer()
  await changeTheme()
  const editedTheme = saved.activeStyleId
  failNextSave = true
  undo()
  await waitFor(
    () =>
      panel()
        ?.querySelector('[role="status"]')
        ?.textContent.includes('undo persistence unavailable'),
    'failed undo did not show its persistence error'
  )
  expect(innerWidth >= 520 && innerHeight >= 340, 'failed undo shrank the editor')
  expect(saved.activeStyleId === editedTheme, 'failed undo lost the last confirmed theme')
  undo()
  await expectPlayer(preset, originalTheme)
  expect(unhandledErrors.length === 0, 'undo leaked an unhandled promise rejection')
  mounted.unmount()
  return 'MINI_PLAYER_UNDO_OK: four forms, motion off/full, unchanged/edited/reopened sessions, close, failure and retry'
}
