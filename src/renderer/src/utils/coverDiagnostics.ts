import { recordRendererDiagnostic } from '../app/diagnostics.ts'
import type { DiagnosticLevel } from '../../../shared/diagnostics.ts'

// Main hashes URL/path fields before persistence, matching media.remote's
// handleUrl/source fingerprints. Never send embedded artwork over diagnostic IPC.
function diagnosticCoverAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const source = value.trim()
  if (/^data:/i.test(source)) return 'data:'
  return source.slice(0, 4096)
}

export function recordCoverDiagnostic(
  event: string,
  handle: string | null | undefined,
  source: string | null | undefined,
  details: Record<string, unknown> = {},
  level: DiagnosticLevel = 'debug'
): void {
  recordRendererDiagnostic({
    module: 'cover.renderer',
    event,
    level,
    details: {
      ...details,
      handleUrl: diagnosticCoverAddress(handle),
      source: diagnosticCoverAddress(source)
    }
  })
}
