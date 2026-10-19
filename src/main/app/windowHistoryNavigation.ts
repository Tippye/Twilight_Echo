import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipcChannels.ts'
import { historyCommandFromAppCommand } from '../../shared/appHistory.ts'

// Mouse side buttons are browser commands, not DOM mouse events: Windows sends
// WM_APPCOMMAND_BROWSER_BACKWARD/FORWARD and Linux reports the same app commands
// (Electron docs: BrowserWindow `app-command`, win32/linux). The renderer owns
// the page history stack, so forward each press there instead of navigating here.
export function installMouseHistoryNavigation(win: BrowserWindow): void {
  win.on('app-command', (event, command) => {
    const direction = historyCommandFromAppCommand(command)
    if (!direction) return
    event.preventDefault()
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(IPC.app.historyCommand, direction)
  })
}
