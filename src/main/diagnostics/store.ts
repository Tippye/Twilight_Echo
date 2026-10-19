import { appendFile, copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  DIAGNOSTICS_MAX_FILE_BYTES,
  DIAGNOSTICS_MAX_TOTAL_BYTES,
  DIAGNOSTICS_RETENTION_DAYS
} from '../../shared/diagnostics.ts'

export interface DiagnosticFile {
  name: string
  bytes: number
  modifiedAt: number
  active: boolean
}
export interface DiagnosticStoreOptions {
  directory: string
  maxFileBytes?: number
  maxTotalBytes?: number
  retentionDays?: number
  now?: () => number
}
const OWNED_FILE = /^(?:app|native|emergency)-[a-zA-Z0-9._-]+\.jsonl$/

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class DiagnosticStore {
  readonly directory: string
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly retentionDays: number
  private readonly prefix = `app-${process.pid}-${randomUUID()}`
  private part = 0
  private bytes = 0
  private writeChain = Promise.resolve()
  private now: () => number
  lastWriteAt: string | null = null

  constructor(options: DiagnosticStoreOptions) {
    this.directory = options.directory
    this.maxFileBytes = options.maxFileBytes ?? DIAGNOSTICS_MAX_FILE_BYTES
    this.maxTotalBytes = options.maxTotalBytes ?? DIAGNOSTICS_MAX_TOTAL_BYTES
    this.retentionDays = options.retentionDays ?? DIAGNOSTICS_RETENTION_DAYS
    this.now = options.now ?? Date.now
  }
  private currentPath() {
    return join(this.directory, `${this.prefix}-${this.part}.active.jsonl`)
  }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await this.prune()
  }
  append(lines: string[]): Promise<void> {
    const next = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const reserve = lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0)
        await this.prune(reserve)
        const disk = await this.status()
        if (disk.bytes + reserve > this.maxTotalBytes)
          throw Object.assign(new Error('Diagnostic capacity reached; active logs retained'), {
            code: 'LOG_CAPACITY'
          })
        let group: string[] = []
        let groupBytes = 0
        const writeGroup = async () => {
          if (!group.length) return
          await appendFile(this.currentPath(), group.join(''), 'utf8')
          this.bytes += groupBytes
          this.lastWriteAt = new Date(this.now()).toISOString()
          group = []
          groupBytes = 0
        }
        for (const line of lines) {
          const size = Buffer.byteLength(line)
          if (size > this.maxFileBytes) throw new Error('Diagnostic entry exceeds segment capacity')
          if (this.bytes + groupBytes && this.bytes + groupBytes + size > this.maxFileBytes) {
            await writeGroup()
            await rename(
              this.currentPath(),
              join(this.directory, `${this.prefix}-${this.part}.jsonl`)
            )
            this.part++
            this.bytes = 0
            await this.prune(size)
          }
          group.push(line)
          groupBytes += size
        }
        await writeGroup()
      })
    this.writeChain = next
    return next
  }
  async flush(): Promise<void> {
    await this.writeChain
  }
  async listFiles(): Promise<DiagnosticFile[]> {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => [])
    const files: DiagnosticFile[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !OWNED_FILE.test(entry.name)) continue
      const info = await stat(join(this.directory, entry.name)).catch(() => null)
      if (!info) continue
      const pid = Number(/^(?:app|native|emergency)-(\d+)-/.exec(entry.name)?.[1])
      const active = entry.name.includes('.active.') && processAlive(pid)
      files.push({ name: entry.name, bytes: info.size, modifiedAt: info.mtimeMs, active })
    }
    return files.sort((a, b) => a.modifiedAt - b.modifiedAt || a.name.localeCompare(b.name))
  }
  async prune(reserveBytes = 0): Promise<void> {
    const files = await this.listFiles()
    let total = files.reduce((sum, file) => sum + file.bytes, 0)
    const cutoff = this.now() - this.retentionDays * 86400000
    for (const file of files) {
      if (file.active || (file.modifiedAt >= cutoff && total + reserveBytes <= this.maxTotalBytes))
        continue
      await rm(join(this.directory, file.name), { force: true })
      total -= file.bytes
    }
  }
  async clearHistory(): Promise<void> {
    await this.flush()
    for (const file of await this.listFiles())
      if (!file.active) await rm(join(this.directory, file.name), { force: true })
  }
  async status() {
    const files = await this.listFiles()
    return {
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files: files.length,
      lastWriteAt: this.lastWriteAt
    }
  }
  /** Open each source before copying: a concurrent native rename cannot change
   * the selected inode or include bytes appended after this snapshot's cutoff. */
  async snapshot(destination: string): Promise<{ files: DiagnosticFile[]; missing: string[] }> {
    await this.flush()
    await mkdir(destination, { recursive: true })
    const copied: DiagnosticFile[] = []
    const missing: string[] = []
    for (const file of await this.listFiles()) {
      let handle: Awaited<ReturnType<typeof open>> | undefined
      let output: Awaited<ReturnType<typeof open>> | undefined
      try {
        handle = await open(join(this.directory, file.name), 'r')
        const cutoff = Math.min(file.bytes, (await handle.stat()).size)
        output = await open(join(destination, file.name), 'w')
        const buffer = Buffer.alloc(64 * 1024)
        let offset = 0
        while (offset < cutoff) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.length, cutoff - offset),
            offset
          )
          if (!bytesRead) break
          let written = 0
          while (written < bytesRead)
            written += (await output.write(buffer, written, bytesRead - written)).bytesWritten
          offset += bytesRead
        }
        copied.push({ ...file, bytes: offset })
      } catch {
        missing.push(file.name)
      } finally {
        await handle?.close()
        await output?.close()
      }
    }
    return { files: copied, missing }
  }
}

// Kept outside the store so emergency files can be imported by future tooling.
export async function copyDiagnosticFile(source: string, destination: string): Promise<void> {
  await copyFile(source, destination)
}
