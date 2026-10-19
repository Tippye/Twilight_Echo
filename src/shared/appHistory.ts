/**
 * Page history commands produced by the mouse side buttons. Windows and Linux
 * deliver them to Electron as app commands rather than DOM mouse events, so the
 * main process forwards one of these directions to the renderer.
 */
export type AppHistoryCommand = 'back' | 'forward'

export function isAppHistoryCommand(value: unknown): value is AppHistoryCommand {
  return value === 'back' || value === 'forward'
}

/** Maps `APPCOMMAND_BROWSER_*` names emitted by Electron's app-command event. */
export function historyCommandFromAppCommand(command: unknown): AppHistoryCommand | null {
  if (typeof command !== 'string') return null
  switch (command.trim().toLowerCase()) {
    case 'browser-backward':
      return 'back'
    case 'browser-forward':
      return 'forward'
    default:
      return null
  }
}
