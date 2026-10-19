import { createRequire, syncBuiltinESMExports } from 'node:module'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeDiagnostic, diagnosticContext } from './logger.ts'
import { summarizeDiagnosticAddress } from './sanitize.ts'

export function installNetworkDiagnostics(): void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const started = performance.now()
    const context = { ...diagnosticContext(), requestId: randomUUID() }
    const address =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const details = {
      address: summarizeDiagnosticAddress(address),
      method: init?.method ?? (input instanceof Request ? input.method : 'GET')
    }
    writeDiagnostic('network.fetch', 'request.start', details, 'debug', context)
    try {
      const response = await originalFetch(input, init)
      writeDiagnostic(
        'network.fetch',
        'response.headers',
        {
          ...details,
          status: response.status,
          durationMs: performance.now() - started,
          contentLength: Number(response.headers.get('content-length')) || null
        },
        response.ok ? 'debug' : 'warn',
        context
      )
      return response
    } catch (error) {
      writeDiagnostic(
        'network.fetch',
        'request.failed',
        { ...details, durationMs: performance.now() - started, error },
        'error',
        context
      )
      throw error
    }
  }
  const require = createRequire(import.meta.url)
  for (const protocol of ['http', 'https']) {
    const module = require(`node:${protocol}`)
    const original = module.request
    module.request = function (...args: any[]) {
      const started = performance.now()
      const context = { ...diagnosticContext(), requestId: randomUUID() }
      const input = args[0]
      const address =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : `${protocol}://${input?.hostname ?? input?.host ?? 'unknown'}${input?.path ?? ''}`
      const details = {
        address: summarizeDiagnosticAddress(address),
        method: (typeof input === 'object' ? input?.method : args[1]?.method) ?? 'GET'
      }
      writeDiagnostic('network.http', 'request.start', details, 'debug', context)
      const request = original.apply(this, args)
      const emit = request.emit
      // Observe emission rather than adding an error/response listener: an
      // unhandled error must still throw and unconsumed responses still drain.
      request.emit = function (event: string, ...values: any[]) {
        if (event === 'error')
          writeDiagnostic(
            'network.http',
            'request.failed',
            { ...details, durationMs: performance.now() - started, error: values[0] },
            'error',
            context
          )
        else if (event === 'response')
          writeDiagnostic(
            'network.http',
            'response.headers',
            {
              ...details,
              status: values[0]?.statusCode,
              durationMs: performance.now() - started,
              contentLength: Number(values[0]?.headers?.['content-length']) || null
            },
            (values[0]?.statusCode ?? 0) >= 400 ? 'warn' : 'debug',
            context
          )
        else if (event === 'timeout' || event === 'abort')
          writeDiagnostic(
            'network.http',
            `request.${event}`,
            { ...details, durationMs: performance.now() - started },
            'warn',
            context
          )
        return emit.call(this, event, ...values)
      }
      return request
    }
    module.get = function (...args: any[]) {
      const request = module.request.apply(this, args)
      request.end()
      return request
    }
  }
  syncBuiltinESMExports()
}
