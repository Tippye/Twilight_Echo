import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { cpus, release, totalmem } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { IPC } from '../../shared/ipcChannels.ts'
import { runtime } from '../core/runtime.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { inspectJsonValueWithLimits } from '../security/jsonSafety.ts'
import { writeDiagnostic, diagnosticIdentity, forwardDiagnosticEvent } from './logger.ts'
import { diagnosticInFlight } from './observation.ts'
import { exportDiagnosticBundle, type DiagnosticCollector } from './bundle.ts'
import type { DiagnosticWriterClient } from './client.ts'
import { utilityDiagnosticStatuses } from './utilityObservation.ts'

export function createApplicationDiagnosticCollectors(): DiagnosticCollector[] {
  return [
    {
      name: 'environment',
      collect: async () => ({
        appVersion: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        architecture: process.arch,
        osRelease: release(),
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        memoryBytes: totalmem(),
        versions: process.versions,
        gpu: app.getGPUFeatureStatus()
      })
    },
    { name: 'settings', collect: () => runtime.appSettings },
    {
      name: 'processes',
      collect: () => ({
        metrics: app.getAppMetrics().map((entry) => ({
          pid: entry.pid,
          type: entry.type,
          cpu: entry.cpu,
          memory: entry.memory
        })),
        inFlight: diagnosticInFlight(),
        utilityProcesses: utilityDiagnosticStatuses(),
        analysis: runtime.audioAnalysisService?.getStatus(),
        libraryScan: { initialized: Boolean(runtime.localLibraryScanService) }
      })
    },
    {
      name: 'audio.cached',
      collect: () =>
        runtime.audioEngineManager?.getCachedDiagnosticSnapshot() ?? {
          available: false,
          reason: 'audio engine not initialized'
        }
    },
    {
      name: 'native.identity',
      collect: () => runtime.audioEngineManager?.getNativeRuntimeIdentity() ?? { available: false }
    },
    {
      name: 'native.capabilities',
      collect: async () => {
        const identity = runtime.audioEngineManager?.getNativeRuntimeIdentity()
        if (!identity?.addonPath) return { available: false }
        const path = join(identity.addonPath, '..', 'audio-capabilities.json')
        return JSON.parse(await readFile(path, 'utf8'))
      }
    },
    {
      name: 'plugins',
      collect: async () =>
        ((await runtime.pluginManager?.list()) ?? []).map((plugin) => ({
          id: plugin.id,
          version: plugin.version,
          enabled: plugin.enabled,
          error: plugin.error
        }))
    }
  ]
}

export function registerDiagnosticsIpc(writer: DiagnosticWriterClient): void {
  let exporting = false
  const budgets = new Map<number, { started: number; events: number; dropped: number }>()
  ipcMain.handle(IPC.diagnostics.status, (event) => {
    assertTrustedIpcSender(event, 'diagnostics')
    return writer.status()
  })
  ipcMain.handle(IPC.diagnostics.directory, async (event) => {
    assertTrustedIpcSender(event, 'diagnostics')
    const error = await shell.openPath(writer.directory)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.diagnostics.marker, (event, note?: unknown) => {
    assertTrustedIpcSender(event, 'diagnostics')
    if (note !== undefined && (typeof note !== 'string' || note.length > 1024))
      throw new Error('Problem note must be at most 1024 characters')
    const markerId = randomUUID()
    writeDiagnostic(
      'diagnostics',
      'problem.marked',
      {
        markerId,
        note: note ?? '',
        beforeSeconds: 120,
        afterSeconds: 30,
        inFlight: diagnosticInFlight(),
        audio: runtime.audioEngineManager?.getCachedDiagnosticSnapshot()
      },
      'warn'
    )
    const timer = setTimeout(
      () =>
        writeDiagnostic('diagnostics', 'problem.context-complete', {
          markerId,
          audio: runtime.audioEngineManager?.getCachedDiagnosticSnapshot()
        }),
      30000
    )
    timer.unref()
    return { markerId }
  })
  ipcMain.handle(IPC.diagnostics.clear, async (event) => {
    assertTrustedIpcSender(event, 'diagnostics')
    if (exporting) throw new Error('Diagnostic export is in progress')
    await writer.clearHistory()
    writeDiagnostic('diagnostics', 'history.cleared')
    return writer.status()
  })
  ipcMain.on(IPC.diagnostics.record, (event, events: unknown) => {
    assertTrustedIpcSender(event, 'diagnostics')
    if (
      !Array.isArray(events) ||
      events.length > 32 ||
      !inspectJsonValueWithLimits(events, 64 * 1024).ok
    )
      return
    const id = event.sender.id
    let budget = budgets.get(id)
    if (!budget || Date.now() - budget.started >= 1000) {
      if (budget?.dropped)
        writeDiagnostic(
          'renderer',
          'events.dropped',
          { windowId: id, count: budget.dropped },
          'warn'
        )
      budget = { started: Date.now(), events: 0, dropped: 0 }
      budgets.set(id, budget)
      if (budgets.size > 64) budgets.delete(budgets.keys().next().value!)
    }
    for (const entry of events) {
      if (++budget.events > 100) {
        budget.dropped++
        continue
      }
      if (
        !entry ||
        !['debug', 'info', 'warn', 'error', 'fatal'].includes(entry.level) ||
        typeof entry.module !== 'string' ||
        !/^[\w.-]{1,96}$/.test(entry.module) ||
        typeof entry.event !== 'string' ||
        !/^[\w.-]{1,128}$/.test(entry.event)
      )
        continue
      if (
        typeof entry.processInstanceId === 'string' &&
        /^[\w-]{1,128}$/.test(entry.processInstanceId) &&
        Number.isSafeInteger(entry.sequence)
      ) {
        forwardDiagnosticEvent({
          ...diagnosticIdentity(),
          schemaVersion: 1,
          eventId: `${entry.processInstanceId}:${entry.sequence}`,
          timestamp: entry.timestamp,
          monotonicMs: entry.monotonicMs,
          sequence: entry.sequence,
          processRole: 'renderer',
          processId: event.sender.getOSProcessId(),
          processInstanceId: entry.processInstanceId,
          module: entry.module,
          event: entry.event,
          level: entry.level,
          details: { windowId: id, data: entry.details }
        })
      } else
        writeDiagnostic(
          entry.module,
          entry.event,
          { windowId: id, data: entry.details },
          entry.level
        )
    }
  })
  ipcMain.handle(IPC.diagnostics.export, async (event) => {
    assertTrustedIpcSender(event, 'diagnostics')
    if (exporting) throw new Error('Diagnostic export is already in progress')
    exporting = true
    try {
      const win = BrowserWindow.getFocusedWindow()
      const options = {
        title: '导出完整诊断包',
        defaultPath: `TwilightEcho-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: '诊断包 ZIP', extensions: ['zip'] }]
      }
      const chosen = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) return { filePath: null }
      writeDiagnostic('diagnostics', 'bundle.requested')
      const legacyFiles = ['audio-diagnostics.jsonl', 'audio-diagnostics.previous.jsonl'].map(
        (name) => ({ source: join(app.getPath('logs'), 'audio', name), name, module: 'audio' })
      )
      const pluginRoot = join(app.getPath('userData'), 'logs', 'plugins')
      for (const name of await readdir(pluginRoot).catch(() => []))
        if (/^[\w.-]+\.log(?:\.1)?$/.test(name))
          legacyFiles.push({ source: join(pluginRoot, name), name, module: 'plugin' })
      const result = await exportDiagnosticBundle({
        destination: chosen.filePath,
        collectors: createApplicationDiagnosticCollectors(),
        snapshot: (directory) => writer.snapshot(directory),
        memoryEvents: writer.memoryEvents(),
        status: await writer.status(),
        legacyFiles
      })
      writeDiagnostic('diagnostics', 'bundle.complete', {
        eventCount: result.manifest.coverage.events,
        missing: result.manifest.missing.length
      })
      return { filePath: result.filePath }
    } catch (error) {
      writeDiagnostic('diagnostics', 'bundle.failed', { error }, 'error')
      throw error
    } finally {
      exporting = false
    }
  })
}
