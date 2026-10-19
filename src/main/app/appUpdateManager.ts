import { randomUUID } from 'node:crypto'
import { writeDiagnostic } from '../diagnostics/logger.ts'
import {
  createInitialAppUpdateSnapshot,
  type AppUpdateCheckResult,
  type AppUpdateDownloadResult,
  type AppUpdateInstallResult,
  type AppUpdatePreferencePatch,
  type AppUpdateProgress,
  type AppUpdateSnapshot
} from '../../shared/appUpdate.ts'
import { compareAppVersions, parseAppVersion } from './appUpdateHelpers.ts'
import { AppUpdateRepository, type UpdateRecord } from './appUpdateRepository.ts'
import {
  AppUpdateReleaseClient,
  UpdateError,
  updateError,
  type UpdateAsset
} from './appUpdateRelease.ts'
import { downloadVerifiedUpdate, hashUpdateFile } from './appUpdateDownload.ts'

export interface AppUpdateManagerOptions {
  directory: string
  currentVersion: string
  platform: string
  arch: string
  fetch: typeof fetch
  publish: (state: AppUpdateSnapshot) => void
  prepareInstall: () => Promise<void>
  openInstaller: (path: string) => Promise<string>
  quit: () => void
  now?: () => number
  downloadOptions?: { timeoutMs?: number; retryDelayMs?: number }
}

export class AppUpdateManager {
  private readonly options: AppUpdateManagerOptions
  private readonly repository: AppUpdateRepository
  private readonly releases: AppUpdateReleaseClient
  private state = createInitialAppUpdateSnapshot()
  private record: UpdateRecord = {
    preferences: { ...this.state.preferences },
    checkedAt: 0,
    check: null,
    asset: null,
    ready: null,
    pendingInstall: null
  }
  private initialized: Promise<void> | null = null
  private checkTask: Promise<AppUpdateCheckResult> | null = null
  private downloadTask: { id: string; controller: AbortController } | null = null
  private installing = false
  private installLaunched = false
  private lastAutomaticAttempt = 0
  private diagnosticPhase = ''

  constructor(options: AppUpdateManagerOptions) {
    this.options = options
    this.repository = new AppUpdateRepository(options.directory)
    this.releases = new AppUpdateReleaseClient(options.fetch)
  }
  private now(): number {
    return (this.options.now ?? Date.now)()
  }
  snapshot(): AppUpdateSnapshot {
    return structuredClone(this.state)
  }
  private publish(): void {
    if (this.state.progress.phase !== this.diagnosticPhase) {
      this.diagnosticPhase = this.state.progress.phase
      writeDiagnostic('app.update', 'phase.changed', { phase: this.diagnosticPhase, receivedBytes: this.state.progress.receivedBytes, totalBytes: this.state.progress.totalBytes, version: this.state.progress.version, errorCode: this.state.progress.errorCode }, this.diagnosticPhase === 'error' ? 'error' : 'info')
    }
    this.state.revision++
    this.options.publish(this.snapshot())
  }
  private progress(progress: AppUpdateProgress): void {
    this.state.progress = progress
    this.publish()
  }
  private save(): void {
    try {
      this.repository.write(this.record)
    } catch {
      throw new UpdateError('persistence', '无法保存更新状态，请检查磁盘空间和目录权限后重试')
    }
  }
  private notice(kind: 'available' | 'ready' | 'installed', version: string): void {
    const prefs = this.state.preferences
    if (
      kind !== 'installed' &&
      (prefs.skippedVersion === version || prefs.remindAfter > this.now())
    )
      return
    if (this.state.notice?.kind === kind && this.state.notice.version === version) return
    this.state.notice = { id: `${kind}:${version}:${this.now()}`, kind, version }
  }
  private ready(asset: UpdateAsset): void {
    this.record.ready = { ...asset }
    this.state.readyVersion = asset.version
    this.progress({
      phase: 'ready',
      percent: 100,
      receivedBytes: asset.size,
      totalBytes: asset.size,
      assetName: asset.name,
      version: asset.version,
      installerPath: this.repository.installer(asset),
      message: 'SHA-256 校验通过，可以安装'
    })
  }

  initialize(): Promise<void> {
    this.initialized ??= this.restore()
    return this.initialized
  }
  private async restore(): Promise<void> {
    try {
      this.record = this.repository.read()
      this.state.preferences = { ...this.record.preferences }
      this.state.checkedAt = this.record.checkedAt
      this.state.check = this.record.check
      const pending = this.record.pendingInstall
      if (
        pending &&
        parseAppVersion(pending) &&
        compareAppVersions(this.options.currentVersion, pending) >= 0
      ) {
        this.state.completedVersion = pending
        this.notice('installed', pending)
        this.record.pendingInstall = null
      } else this.state.pendingInstallVersion = pending
      for (const key of ['ready', 'asset'] as const) {
        const asset = this.record[key]
        if (asset && compareAppVersions(asset.version, this.options.currentVersion) <= 0)
          this.record[key] = null
      }
      if (this.record.check) {
        this.record.check.currentVersion = this.options.currentVersion
        this.record.check.hasUpdate =
          !!parseAppVersion(this.record.check.latestVersion) &&
          compareAppVersions(this.record.check.latestVersion!, this.options.currentVersion) > 0
      }
      const cached = this.record.ready ?? this.record.asset
      if (cached && (await this.repository.size(this.repository.installer(cached))) > 0) {
        this.progress({
          phase: 'verifying',
          percent: 100,
          receivedBytes: cached.size,
          totalBytes: cached.size,
          version: cached.version,
          message: '正在恢复已下载的更新…'
        })
        if ((await hashUpdateFile(this.repository.installer(cached))) === cached.sha256)
          this.ready(cached)
        else {
          this.record.ready = null
          await this.repository.remove(cached)
          throw new UpdateError('checksum', '更新缓存校验失败，已清理，请重新下载')
        }
      } else {
        this.record.ready = null
        const partial = this.record.asset
          ? await this.repository.size(this.repository.partial(this.record.asset))
          : 0
        if (partial && this.record.asset)
          this.progress({
            phase: 'cancelled',
            percent: Math.floor((partial / this.record.asset.size) * 100),
            receivedBytes: partial,
            totalBytes: this.record.asset.size,
            version: this.record.asset.version,
            message: '上次下载尚未完成，可以继续下载'
          })
      }
      await this.repository.cleanup(
        [this.record.ready, this.record.asset].filter((a): a is UpdateAsset => !!a)
      )
      this.save()
    } catch (error) {
      const failure =
        error instanceof UpdateError
          ? error
          : new UpdateError('persistence', '无法恢复更新缓存，请重新检查更新')
      this.progress({
        phase: 'error',
        percent: 0,
        receivedBytes: 0,
        totalBytes: 0,
        error: failure.message,
        errorCode: failure.code
      })
    }
    this.publish()
  }

  check(manual = true): Promise<AppUpdateCheckResult> {
    if (this.checkTask) return this.checkTask
    const task = this.runCheck(manual).finally(() => {
      if (this.checkTask === task) this.checkTask = null
      this.state.checking = false
      this.publish()
    })
    this.checkTask = task
    return task
  }
  private async runCheck(manual: boolean): Promise<AppUpdateCheckResult> {
    await this.initialize()
    if (this.downloadTask || this.installing)
      return {
        hasUpdate: false,
        currentVersion: this.options.currentVersion,
        error: 'busy',
        message: '请等待当前更新任务结束'
      }
    this.state.checking = true
    this.publish()
    try {
      const result = await this.releases.resolve(
        this.options.currentVersion,
        this.state.preferences.channel,
        this.options.platform,
        this.options.arch,
        new AbortController().signal
      )
      this.record.asset = result.asset
      this.record.check = result.check
      this.record.checkedAt = this.now()
      this.state.check = result.check
      this.state.checkedAt = this.record.checkedAt
      if (manual) {
        this.record.preferences.skippedVersion = ''
        this.record.preferences.remindAfter = 0
        this.state.preferences = { ...this.record.preferences }
      }
      if (!result.check.hasUpdate) this.state.notice = null
      else if (!manual)
        this.notice(
          this.record.ready ? 'ready' : 'available',
          this.record.ready?.version ?? result.check.latestVersion!
        )
      if (!this.record.ready && ['error', 'cancelled'].includes(this.state.progress.phase)) {
        this.state.progress = { phase: 'idle', percent: 0, receivedBytes: 0, totalBytes: 0 }
      }
      this.save()
      return result.check
    } catch (error) {
      const failure = updateError(error)
      const check: AppUpdateCheckResult = {
        hasUpdate: false,
        currentVersion: this.options.currentVersion,
        error: failure.code,
        message: failure.message
      }
      this.state.check = check
      // Never keep an actionable old candidate behind a failed check.
      this.record.asset = null
      return check
    }
  }
  async automaticCheck(): Promise<void> {
    await this.initialize()
    if (!this.state.preferences.autoCheck || this.checkTask || this.downloadTask || this.installing)
      return
    const now = this.now()
    if (now - this.lastAutomaticAttempt < 30 * 60_000) return
    if (
      this.state.checkedAt <= now &&
      now - this.state.checkedAt < this.state.preferences.checkIntervalHours * 3600_000
    )
      return
    this.lastAutomaticAttempt = now
    await this.check(false)
  }
  async preferences(patch: AppUpdatePreferencePatch): Promise<AppUpdateSnapshot> {
    await this.initialize()
    if (this.checkTask || this.downloadTask || this.installing)
      throw new UpdateError('busy', '请等待当前更新任务结束')
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((k) => !['autoCheck', 'channel', 'checkIntervalHours'].includes(k)) ||
      ('autoCheck' in patch && typeof patch.autoCheck !== 'boolean') ||
      ('channel' in patch && patch.channel !== 'stable' && patch.channel !== 'preview') ||
      ('checkIntervalHours' in patch && ![6, 24, 72].includes(patch.checkIntervalHours!))
    )
      throw new Error('无效的更新设置')
    const next = { ...this.record.preferences, ...patch }
    const changedChannel = next.channel !== this.record.preferences.channel
    const previous = structuredClone(this.record)
    this.record.preferences = next
    if (changedChannel) {
      next.skippedVersion = ''
      next.remindAfter = 0
      this.record.asset = null
      this.record.check = null
      this.record.checkedAt = 0
    }
    try {
      this.save()
    } catch (error) {
      this.record = previous
      throw error
    }
    this.state.preferences = { ...next }
    if (changedChannel) {
      this.state.check = null
      this.state.checkedAt = 0
      this.state.notice = null
    }
    this.publish()
    return this.snapshot()
  }
  async dismiss(action: 'skip' | 'later'): Promise<AppUpdateSnapshot> {
    await this.initialize()
    if (action !== 'skip' && action !== 'later') throw new Error('无效的提醒操作')
    const version =
      this.state.notice?.version ?? this.state.readyVersion ?? this.state.check?.latestVersion
    if (!version) return this.snapshot()
    const old = { ...this.record.preferences }
    if (action === 'skip') this.record.preferences.skippedVersion = version
    else this.record.preferences.remindAfter = this.now() + 24 * 3600_000
    try {
      this.save()
    } catch (error) {
      this.record.preferences = old
      throw error
    }
    this.state.preferences = { ...this.record.preferences }
    this.state.notice = null
    this.publish()
    return this.snapshot()
  }

  cancel(): boolean {
    if (!this.downloadTask || this.downloadTask.controller.signal.aborted) return false
    this.downloadTask.controller.abort()
    this.progress({
      ...this.state.progress,
      phase: 'cancelling',
      message: '正在取消，已下载部分将保留…'
    })
    return true
  }
  async download(): Promise<AppUpdateDownloadResult> {
    if (this.downloadTask || this.installing || this.checkTask)
      return { ok: false, error: '请等待当前更新任务结束', errorCode: 'busy' }
    const task = { id: randomUUID(), controller: new AbortController() }
    this.downloadTask = task
    const signal = task.controller.signal
    try {
      await this.initialize()
      signal.throwIfAborted()
      if (this.options.platform !== 'win32')
        throw new UpdateError('unsupported-platform', '当前平台请从发布页手动下载')
      const asset = this.record.asset ?? this.record.ready
      if (!asset) throw new UpdateError('no-asset', '请先检查更新，获取可校验的安装包')
      this.progress({
        phase: 'resolving',
        percent: 0,
        receivedBytes: 0,
        totalBytes: asset.size,
        taskId: task.id,
        version: asset.version,
        message: '正在准备下载…'
      })
      this.save()
      const installerPath = await downloadVerifiedUpdate(
        { ...asset },
        this.repository,
        this.options.fetch,
        signal,
        (progress) => {
          if (this.downloadTask === task && !signal.aborted)
            this.progress({ ...progress, taskId: task.id })
        },
        this.options.downloadOptions
      )
      signal.throwIfAborted()
      const previous = this.record.ready
      this.record.ready = { ...asset }
      try {
        this.save()
      } catch (error) {
        this.record.ready = previous
        throw error
      }
      this.notice('ready', asset.version)
      this.ready(asset)
      await this.repository.cleanup([asset]).catch(() => {})
      return {
        ok: true,
        installerPath,
        assetName: asset.name,
        verified: true,
        sha256: asset.sha256
      }
    } catch (error) {
      if (signal.aborted) {
        this.progress({
          ...this.state.progress,
          phase: 'cancelled',
          message: '已取消，可继续下载',
          error: undefined,
          errorCode: undefined,
          bytesPerSecond: undefined,
          remainingSeconds: undefined
        })
        return { ok: false, error: '已取消下载', cancelled: true }
      }
      const failure = updateError(error)
      this.progress({
        ...this.state.progress,
        phase: 'error',
        error: failure.message,
        errorCode: failure.code
      })
      return { ok: false, error: failure.message, errorCode: failure.code }
    } finally {
      if (this.downloadTask === task) this.downloadTask = null
    }
  }

  async install(): Promise<AppUpdateInstallResult> {
    if (this.installing || this.downloadTask || this.checkTask)
      return { ok: false, error: '请等待当前更新任务结束', errorCode: 'busy' }
    this.installing = true
    let installerPath: string | null = null
    try {
      await this.initialize()
      if (this.options.platform !== 'win32')
        throw new UpdateError('unsupported-platform', '当前平台请从发布页手动下载')
      const asset = this.record.ready && { ...this.record.ready }
      if (!asset) throw new UpdateError('install', '请先下载更新包')
      installerPath = this.repository.installer(asset)
      this.progress({
        phase: 'installing',
        percent: 100,
        receivedBytes: asset.size,
        totalBytes: asset.size,
        version: asset.version,
        message: '正在校验并保存播放状态…'
      })
      if (
        (await this.repository.size(installerPath)) !== asset.size ||
        (await hashUpdateFile(installerPath)) !== asset.sha256
      ) {
        this.record.ready = null
        this.state.readyVersion = null
        await this.repository.remove(asset)
        installerPath = null
        this.save()
        throw new UpdateError('checksum', '安装包校验失败（安装前 SHA-256 不匹配），已删除下载文件')
      }
      // The renderer must acknowledge durable persistence before the installer is launched.
      try {
        await this.options.prepareInstall()
      } catch {
        throw new UpdateError('persistence', '播放状态保存失败，应用保持打开，请重试安装')
      }
      this.record.pendingInstall = asset.version
      this.save()
      let openError: string
      try {
        openError = await this.options.openInstaller(installerPath)
      } catch (error) {
        openError = error instanceof Error ? error.message : '系统拒绝打开安装程序'
      }
      if (openError) {
        this.record.pendingInstall = null
        this.save()
        throw new UpdateError('install', `无法启动安装程序：${openError}`)
      }
      this.state.pendingInstallVersion = asset.version
      this.installLaunched = true
      this.publish()
      this.options.quit()
      return { ok: true }
    } catch (error) {
      const failure = updateError(error)
      this.progress({
        ...this.state.progress,
        phase: 'error',
        error: failure.message,
        errorCode: failure.code,
        installerPath: installerPath ?? undefined
      })
      return { ok: false, error: failure.message, errorCode: failure.code, installerPath }
    } finally {
      if (!this.installLaunched) this.installing = false
    }
  }
}
