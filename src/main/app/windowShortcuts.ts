import type { BrowserWindow } from 'electron'

export function installWindowCloseShortcut(win: BrowserWindow, isEnabled: () => boolean): void {
  win.webContents.on('before-input-event', (event, input) => {
    const modifier =
      process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
    if (input.key.toLowerCase() !== 'w' || !modifier || input.alt || input.shift) return
    // Suppress Electron's default menu accelerator even when this shortcut is disabled.
    event.preventDefault()
    if (input.type === 'keyDown' && !input.isAutoRepeat && !input.isComposing && isEnabled()) {
      win.close()
    }
  })
}
