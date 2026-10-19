import { IPC } from './ipcChannels.ts'
export const DIAGNOSTICS_SCHEMA_VERSION = 1
export const DIAGNOSTICS_MAX_EVENT_BYTES = 16 * 1024
export const DIAGNOSTICS_MAX_QUEUE_BYTES = 4 * 1024 * 1024
export const DIAGNOSTICS_MAX_FILE_BYTES = 8 * 1024 * 1024
export const DIAGNOSTICS_MAX_TOTAL_BYTES = 256 * 1024 * 1024
export const DIAGNOSTICS_RETENTION_DAYS = 7

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export interface DiagnosticContext {
  operationId?: string
  requestId?: string
  serviceGeneration?: number
  streamToken?: number
}
export interface DiagnosticEvent extends DiagnosticContext {
  schemaVersion: 1
  eventId: string
  timestamp: string
  monotonicMs: number
  sessionId: string
  processId: number
  processRole: string
  processInstanceId: string
  sequence: number
  level: DiagnosticLevel
  module: string
  event: string
  details: unknown
}
export interface DiagnosticStatus {
  enabled: true
  level: 'debug'
  sessionId: string
  directory: string
  bytes: number
  files: number
  retentionDays: number
  maxTotalBytes: number
  queuedBytes: number
  droppedEvents: number
  lastWriteAt: string | null
  error: string | null
  warnings?: string[]
}
export interface DiagnosticRendererEvent {
  timestamp?: string
  monotonicMs?: number
  sequence?: number
  processInstanceId?: string
  level: DiagnosticLevel
  module: string
  event: string
  details?: unknown
}
export interface DiagnosticsApi {
  getStatus(): Promise<DiagnosticStatus>
  markProblem(note?: string): Promise<{ markerId: string }>
  openDirectory(): Promise<void>
  exportBundle(): Promise<{ filePath: string | null }>
  clearHistory(): Promise<DiagnosticStatus>
  record(events: DiagnosticRendererEvent[]): void
}
export const DIAGNOSTICS_CHANNELS = IPC.diagnostics

// The envelope is internal to preload/main. Business handlers still receive
// their original arguments, and callers without an envelope remain compatible.
export interface ObservedIpcEnvelope {
  __twilightDiagnosticEnvelope: 1
  context: DiagnosticContext
  args: unknown[]
}
