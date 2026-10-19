import type { AppSettings } from '../../shared/appSettings.ts'
import type { BrowserWindow } from 'electron'

type WindowAppearanceSettings = {
  theme: AppSettings['theme']
  appBackground: { global: { dark: string; light: string } }
}

export function getWindowBackgroundColor(
  settings: WindowAppearanceSettings,
  systemDark: boolean
): string {
  if (settings.theme === 'dark') return settings.appBackground.global.dark
  if (settings.theme === 'system' && systemDark) {
    return settings.appBackground.global.dark
  }
  return settings.appBackground.global.light
}

/** Let Windows draw a neutral frame around pages with independent backgrounds. */
export function syncWindowFrameAppearance(
  win: Pick<BrowserWindow, 'setAccentColor'>,
  highContrast: boolean
): void {
  if (process.platform !== 'win32') return
  // A global light background becomes a white outline around the dark playback
  // page. Disable the forced accent while keeping native resizing and shadows.
  win.setAccentColor(highContrast ? null : false)
}
