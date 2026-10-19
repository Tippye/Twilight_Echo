import type { AppHistoryCommand } from '../../../shared/appHistory.ts'

// One physical mouse-button press can reach the renderer twice: once as the
// app-command IPC forwarded by the main process (Windows/Linux) and, on
// platforms whose Chromium build also dispatches XBUTTON as a DOM event, once
// as `mouseup` with button 3 (back) or 4 (forward). Both deliveries describe
// the same press, so collapse them. The window is far shorter than a human
// double click, which keeps two deliberate presses as two steps.
const DUPLICATE_DELIVERY_WINDOW_MS = 80

export interface HistoryCommandTargets {
  back: () => boolean
  forward: () => boolean
}

export interface HistoryCommandRouter {
  run: (command: AppHistoryCommand) => boolean
  handleMouseUp: (event: MouseEvent) => boolean
}

export function createHistoryCommandRouter(
  targets: HistoryCommandTargets,
  now: () => number = Date.now
): HistoryCommandRouter {
  const lastHandled: Record<AppHistoryCommand, number> = { back: -Infinity, forward: -Infinity }

  function run(command: AppHistoryCommand): boolean {
    if (command !== 'back' && command !== 'forward') return false
    const startedAt = now()
    if (startedAt - lastHandled[command] < DUPLICATE_DELIVERY_WINDOW_MS) return false
    const handled = command === 'back' ? targets.back() : targets.forward()
    if (handled) lastHandled[command] = startedAt
    return handled
  }

  function handleMouseUp(event: MouseEvent): boolean {
    const command: AppHistoryCommand | null =
      event.button === 3 ? 'back' : event.button === 4 ? 'forward' : null
    if (!command) return false
    event.preventDefault()
    run(command)
    return true
  }

  return { run, handleMouseUp }
}
