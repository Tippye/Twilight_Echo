import type { PluginPlaylistImportNotice } from '../../shared/pluginPlaylistImport.ts'

/** Requests outlive window creation/reload; IPC events only announce pending work. */
export function createPlaylistImportQueue() {
  let pending: PluginPlaylistImportNotice[] = []
  return {
    enqueue(request: PluginPlaylistImportNotice): void {
      pending.push(request)
    },
    take(): PluginPlaylistImportNotice[] {
      const requests = pending
      pending = []
      return requests
    }
  }
}
