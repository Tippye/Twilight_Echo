import type { IpcMain } from 'electron'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import {
  enterAfterglowMode,
  getAfterglowModeStatus,
  getAfterglowRestoreState,
  notifyAfterglowRendererAdoptComplete,
  publishAfterglowRendererSnapshot,
  restoreAfterglowMode
} from '../app/AfterglowModeService.ts'

export function registerAfterglowModeIpc(ipc: IpcMain): void {
  ipc.handle('app:afterglow:getStatus', (event) => {
    assertTrustedIpcSender(event, 'afterglow status IPC')
    return getAfterglowModeStatus()
  })

  ipc.handle('app:afterglow:enter', async (event) => {
    assertTrustedIpcSender(event, 'afterglow entry IPC')
    return await enterAfterglowMode()
  })

  ipc.handle('app:afterglow:restore', async (event) => {
    assertTrustedIpcSender(event, 'afterglow restore IPC')
    return await restoreAfterglowMode()
  })

  ipc.handle('app:afterglow:getRestoreState', async (event) => {
    assertTrustedIpcSender(event, 'afterglow restore state IPC')
    return await getAfterglowRestoreState()
  })

  ipc.handle('app:afterglow:rendererAdoptComplete', (event) => {
    assertTrustedIpcSender(event, 'afterglow restore adoption IPC')
    notifyAfterglowRendererAdoptComplete()
  })

  // One-shot queue snapshot captured immediately before the renderer unloads.
  // It stays in main memory and never becomes a resume record on disk.
  ipc.handle('app:afterglow:publishRendererSnapshot', (event, payload: unknown) => {
    assertTrustedIpcSender(event, 'afterglow renderer snapshot IPC')
    return publishAfterglowRendererSnapshot(payload)
  })
}
