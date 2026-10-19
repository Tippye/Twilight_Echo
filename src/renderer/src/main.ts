import './assets/main.css'
import { installRendererDiagnostics, installVueDiagnostics } from './app/diagnostics.ts'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { bootstrapThemeRuntime } from './stores/useThemeStore'
import { beginStartupSnapshot } from './app/startupSnapshot'
import { installAutoHideScrollbars } from './utils/autoHideScrollbars'
import { installScrollToTopButton } from './utils/scrollToTopButton'
import { injectCachedThemeRuntime } from './app/themeRuntimeCache'

const query = new URLSearchParams(window.location.search)
installRendererDiagnostics()
const windowKind = query.get('window')
const isMiniPlayer = windowKind === 'mini-player'
const isTrayPlayer = windowKind === 'tray-player'
const isDesktopLyrics = windowKind === 'desktop-lyrics'
const isDynamicIsland = windowKind === 'dynamic-island'
const isSatelliteWindow = isMiniPlayer || isTrayPlayer || isDesktopLyrics || isDynamicIsland
if (isSatelliteWindow) {
  const documentClass = isMiniPlayer
    ? 'mini-player-document'
    : isTrayPlayer
      ? 'tray-player-document'
      : isDesktopLyrics
        ? 'desktop-lyrics-document'
        : 'dynamic-island-document'
  document.documentElement.classList.add(documentClass)
  document.body.classList.add(documentClass)
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.padding = '0'
}

function applyExperienceWindowTheme(theme: string): void {
  const enabled = theme === 'rhine' || theme === 'rhine-night'
  document.documentElement.classList.toggle('rhine-experience-window', enabled)
  document.body.classList.toggle('rhine-experience-window', enabled)
  document.documentElement.dataset.experienceTone = theme === 'rhine-night' ? 'night' : 'day'
}

if (isSatelliteWindow) {
  applyExperienceWindowTheme(query.get('experienceTheme') || 'default')
  void import('./assets/rhineWindows.css')
  window.api.experienceWindow?.onTheme((theme) => applyExperienceWindowTheme(theme))
}

installAutoHideScrollbars()
if (!isSatelliteWindow) {
  injectCachedThemeRuntime()
  // The satellite windows are only a few hundred pixels tall, so a floating
  // back-to-top would cover more than it saves; the main window gets it for
  // every scroll container it owns.
  installScrollToTopButton()
}

// Chromium starts an OS drag for images, links, and arbitrary elements, letting
// users drag app content out of the window onto the desktop. Block every
// dragstart that did not originate on an explicitly draggable app surface.
// The app's intentional HTML5 drag-and-drop (playback queue reorder, DSP rack
// reorder, playlist-detail reorder) marks its rows draggable="true", so those
// keep working while everything else is confined to the window.
document.addEventListener(
  'dragstart',
  (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[draggable="true"]')) {
      event.preventDefault()
    }
  },
  true
)

async function mountApp(): Promise<void> {
  if (!isSatelliteWindow) {
    try {
      await (await import('./app/personalRestore')).applyPersonalRendererRestore()
    } catch (error) {
      const message = document.createElement('p')
      message.textContent = `个人数据恢复未完成，请关闭应用后重试。${error instanceof Error ? error.message : String(error)}`
      document.getElementById('app')?.append(message)
      return
    }
  }
  await import('./assets/icon-fonts')
  const startupSnapshot = isSatelliteWindow ? null : beginStartupSnapshot()
  const rootComponent = isMiniPlayer
    ? (await import('./mini-player/MiniPlayerApp.vue')).default
    : isTrayPlayer
      ? (await import('./tray-player/TrayPlayerApp.vue')).default
      : isDesktopLyrics
        ? (await import('./desktop-lyrics/DesktopLyricsApp.vue')).default
        : isDynamicIsland
          ? (await import('./dynamic-island/DynamicIslandApp.vue')).default
          : (await import('./App.vue')).default
  // The lyrics window reads no theme tokens: every colour arrives in its settings
  // payload, so it must not pay for (or wait on) the theme runtime.
  if (isMiniPlayer) await bootstrapThemeRuntime()
  const app = createApp(rootComponent).use(createPinia())
  installVueDiagnostics(app)
  app.mount('#app')
  void startupSnapshot
}

void mountApp()
