import type { App } from 'vue'
import type { DiagnosticRendererEvent } from '../../../shared/diagnostics.ts'

export function recordRendererDiagnostic(event: DiagnosticRendererEvent): void {
  try {
    window.api?.diagnostics?.record([event])
  } catch {
    /* Main-process console capture is an independent fallback. */
  }
}
export function installRendererDiagnostics(): void {
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null
      const resource = target?.getAttribute?.('src') ?? target?.getAttribute?.('href')
      recordRendererDiagnostic({
        level: 'error',
        module: 'renderer',
        event: event.error ? 'javascript.error' : 'resource.failed',
        details: {
          message: event.message,
          stack: event.error?.stack,
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
          element: target?.tagName,
          resourceUrl: resource
            ? /^data:/i.test(resource)
              ? 'data:'
              : resource.slice(0, 4096)
            : null
        }
      })
    },
    true
  )
  window.addEventListener('unhandledrejection', (event) =>
    recordRendererDiagnostic({
      level: 'error',
      module: 'renderer',
      event: 'promise.unhandled-rejection',
      details:
        event.reason instanceof Error
          ? { name: event.reason.name, message: event.reason.message, stack: event.reason.stack }
          : { reason: String(event.reason) }
    })
  )
  recordRendererDiagnostic({
    level: 'info',
    module: 'renderer',
    event: 'renderer.start',
    details: { windowKind: new URLSearchParams(location.search).get('window') ?? 'main' }
  })
}
export function installVueDiagnostics(app: App): void {
  const previous = app.config.errorHandler
  app.config.errorHandler = (error, instance, info) => {
    recordRendererDiagnostic({
      level: 'error',
      module: 'renderer.vue',
      event: 'component.error',
      details: {
        info,
        component: instance?.$options.name,
        ...(error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { error: String(error) })
      }
    })
    if (previous) previous(error, instance, info)
    else console.error(error)
  }
}
