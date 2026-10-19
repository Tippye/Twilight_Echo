import type { PluginPlaylistImportNotice } from '../../../shared/pluginPlaylistImport.ts'

/** Subscribe and pull backlog only after both stores have hydrated successfully. */
export async function consumePluginPlaylistImports(options: {
  ready: Promise<unknown>
  subscribe: (callback: () => void) => () => void
  take: () => Promise<PluginPlaylistImportNotice[]>
  apply: (request: PluginPlaylistImportNotice) => void
  onError: (error: unknown) => void
}): Promise<() => void> {
  await options.ready
  let stopped = false
  let drain = Promise.resolve()
  const requestDrain = (): Promise<void> => {
    drain = drain
      .then(async () => {
        if (stopped) return
        const requests = await options.take()
        for (const request of requests) {
          try {
            options.apply(request)
          } catch (error) {
            options.onError(error)
          }
        }
      })
      .catch(options.onError)
    return drain
  }
  const unsubscribe = options.subscribe(() => {
    void requestDrain()
  })
  await requestDrain()
  return () => {
    stopped = true
    unsubscribe()
  }
}
