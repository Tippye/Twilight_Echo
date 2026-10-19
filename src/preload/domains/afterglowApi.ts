import { ipcRenderer } from 'electron'
import type {
  AfterglowModeStatus,
  AfterglowRendererSnapshot,
  AfterglowRestoreState
} from '../../shared/afterglowMode.ts'

export const afterglowApi = {
  getStatus: (): Promise<AfterglowModeStatus> => ipcRenderer.invoke('app:afterglow:getStatus'),
  enter: (): Promise<AfterglowModeStatus> => ipcRenderer.invoke('app:afterglow:enter'),
  restore: (): Promise<AfterglowModeStatus> => ipcRenderer.invoke('app:afterglow:restore'),
  /** Live engine state for a renderer recreated after Afterglow. */
  getRestoreState: (): Promise<AfterglowRestoreState | null> =>
    ipcRenderer.invoke('app:afterglow:getRestoreState'),
  /** Reports that the recreated renderer adopted the live state. */
  rendererAdoptComplete: (): Promise<void> =>
    ipcRenderer.invoke('app:afterglow:rendererAdoptComplete'),
  /**
   * Hands the current queue to main right before it unloads this renderer.
   * Kept in memory only; it is never a playback-resume record.
   */
  publishRendererSnapshot: (snapshot: AfterglowRendererSnapshot): Promise<boolean> =>
    ipcRenderer.invoke('app:afterglow:publishRendererSnapshot', snapshot)
}
