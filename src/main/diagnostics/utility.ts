import {
  configureDiagnosticLogger,
  diagnosticIdentity,
  installConsoleDiagnostics,
  writeDiagnostic
} from './logger.ts'
import { installNetworkDiagnostics } from './network.ts'
import { DIAGNOSTICS_MAX_QUEUE_BYTES } from '../../shared/diagnostics.ts'

export const DIAGNOSTIC_OUTPUT_PREFIX = '[TwilightDiagnostic]'

export function initializeUtilityDiagnostics(role: string): void {
  if (!process.env.TWILIGHT_LOG_SESSION_ID) return
  const stdout = process.stdout.write.bind(process.stdout)
  let dropped = 0
  configureDiagnosticLogger(
    { sessionId: process.env.TWILIGHT_LOG_SESSION_ID, processRole: role },
    (event) => {
      const line = `${DIAGNOSTIC_OUTPUT_PREFIX}${JSON.stringify(event)}\n`
      if (process.stdout.writableLength + Buffer.byteLength(line) > DIAGNOSTICS_MAX_QUEUE_BYTES) {
        dropped++
        return
      }
      stdout(line)
    }
  )
  process.stdout.on('drain', () => {
    if (dropped) {
      const count = dropped
      dropped = 0
      writeDiagnostic(role, 'events.dropped', { count }, 'warn')
    }
  })
  installConsoleDiagnostics(role)
  installNetworkDiagnostics()
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    writeDiagnostic(role, 'process.uncaught-exception', { error, origin }, 'fatal')
  })
  writeDiagnostic(role, 'process.start', {
    versions: process.versions,
    identity: diagnosticIdentity()
  })
  process.on('exit', (code) => {
    writeDiagnostic(role, 'process.exit', { code })
  })
}
