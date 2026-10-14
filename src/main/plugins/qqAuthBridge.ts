import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

export const QQMUSIC_PLUGIN_ID = 'com.twilightecho.provider.qqmusic'
const QQ_APP_ID = '100497308'
const PTLOGIN_APP_ID = '716027609'
const CALLBACK_URL = 'https://y.qq.com/wk_v17/common_login.html?type=QQ'
const SESSION_TIMEOUT_MS = 10 * 60 * 1000
const QR_TIMEOUT_MS = 12_000

export interface QqAuthLogin {
  key: string
  imageDataUrl: string
  expiresInSeconds: number
}

export interface QqAuthCheckResult {
  status: 'waiting' | 'authorized' | 'closed' | 'expired'
  code?: string
}

type Listener = (...args: unknown[]) => void
interface EventSource {
  on(event: string, listener: Listener): unknown
  off(event: string, listener: Listener): unknown
}
export interface QqAuthFrame {
  url: string
  executeJavaScript(source: string): Promise<unknown>
}
export interface QqAuthWindow extends EventSource {
  webContents: EventSource & {
    mainFrame: { framesInSubtree: QqAuthFrame[] }
    setWindowOpenHandler(handler: () => { action: 'deny' }): void
  }
  loadURL(url: string): Promise<unknown>
  isDestroyed(): boolean
  destroy(): void
}
export interface QqAuthWindowOptions {
  title: string
  width: number
  height: number
  show: true
  autoHideMenuBar: true
  webPreferences: {
    partition: string
    nodeIntegration: false
    contextIsolation: true
    sandbox: true
    webSecurity: true
    allowRunningInsecureContent: false
  }
}
export interface QqAuthBrowser {
  window: QqAuthWindow
  dispose(): Promise<void>
}
export interface QqAuthBridgeOptions {
  createBrowser?: (options: QqAuthWindowOptions) => Promise<QqAuthBrowser>
  now?: () => number
  randomKey?: () => string
  sleep?: (milliseconds: number) => Promise<void>
  qrTimeoutMs?: number
  sessionTimeoutMs?: number
}

interface Attempt {
  key: string
  root: string
  status: QqAuthCheckResult['status']
  expiresAt: number
  code?: string
  browser?: QqAuthBrowser
  listeners: Array<{ source: EventSource; event: string; listener: Listener }>
  expiryTimer?: ReturnType<typeof setTimeout>
  rejectPending?: (error: Error) => void
  cleanup?: Promise<void>
}

// Official c_login_2.js (SHA256 7716861550c4b520b025b0e765ab3edd499458024090035b99e44edfc487374d)
// defines LoginState.QLogin=2 and switchpage(2) shows the QR login panel. These
// are fixed page operations; plugin code and input never enter the renderer.
const SHOW_QR_PANEL = `(() => {
  const login = window.pt && window.pt.plogin;
  if (!login || typeof login.switchpage !== 'function') return false;
  login.switchpage(2);
  return true;
})()`
const READ_QR_IMAGE = `(() => {
  const image = document.getElementById('qrlogin_img');
  if (!(image instanceof HTMLImageElement) || !image.complete ||
      image.naturalWidth < 1 || image.naturalHeight < 1 ||
      image.naturalWidth > 1024 || image.naturalHeight > 1024) return null;
  const source = new URL(image.currentSrc || image.src, location.href);
  if (source.origin !== location.origin || source.pathname !== '/ssl/ptqrshow' ||
      source.searchParams.get('appid') !== '${PTLOGIN_APP_ID}' ||
      source.searchParams.get('pt_3rd_aid') !== '${QQ_APP_ID}') return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
})()`

export function readQqAuthorizationCode(value: string, expectedState: string): string | null {
  try {
    const url = new URL(value)
    if (
      url.origin !== 'https://y.qq.com' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/wk_v17/common_login.html' ||
      url.hash ||
      url.searchParams.getAll('type').length !== 1 ||
      url.searchParams.get('type') !== 'QQ' ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== expectedState ||
      url.searchParams.getAll('code').length !== 1
    ) {
      return null
    }
    const code = url.searchParams.get('code') || ''
    return /^[a-zA-Z0-9_-]{1,2048}$/.test(code) ? code : null
  } catch {
    return null
  }
}

function isQqLoginFrame(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.origin === 'https://xui.ptlogin2.qq.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/cgi-bin/xlogin' &&
      url.searchParams.get('appid') === PTLOGIN_APP_ID &&
      url.searchParams.get('daid') === '383' &&
      url.searchParams.get('pt_3rd_aid') === QQ_APP_ID
    )
  } catch {
    return false
  }
}

function isOfficialLoginNavigation(value: string, isMainFrame: boolean): boolean {
  if (value === 'about:blank') return !isMainFrame
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    if (
      ['qq.com', 'tencent.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    )
      return true
    // The exact CAPTCHA frame URL is referenced by the official xlogin HTML.
    // Other gtimg hosts remain outside the navigation boundary.
    return url.hostname === 'captcha.gtimg.com' && url.pathname.startsWith('/1/tcaptcha-frame')
  } catch {
    return false
  }
}

function isPngDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512 * 1024) return false
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value)
  if (!match) return false
  const image = Buffer.from(match[1], 'base64')
  return image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

async function createQqAuthBrowser(options: QqAuthWindowOptions): Promise<QqAuthBrowser> {
  // Electron belongs to the main process, never to the plugin utility process.
  const { BrowserWindow, session } = await import('electron')
  const isolatedSession = session.fromPartition(options.webPreferences.partition, { cache: false })
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  const window = new BrowserWindow({
    ...options,
    webPreferences: { ...options.webPreferences, session: isolatedSession }
  })
  return {
    window: window as unknown as QqAuthWindow,
    async dispose() {
      await isolatedSession.closeAllConnections().catch(() => undefined)
      await isolatedSession.clearStorageData().catch(() => undefined)
      await isolatedSession.clearCache().catch(() => undefined)
    }
  }
}

export class QqAuthBridge {
  private readonly createBrowser: NonNullable<QqAuthBridgeOptions['createBrowser']>
  private readonly now: () => number
  private readonly randomKey: () => string
  private readonly sleep: NonNullable<QqAuthBridgeOptions['sleep']>
  private readonly qrTimeoutMs: number
  private readonly sessionTimeoutMs: number
  private current: Attempt | null = null

  constructor(options: QqAuthBridgeOptions = {}) {
    this.createBrowser = options.createBrowser || createQqAuthBrowser
    this.now = options.now || Date.now
    this.randomKey = options.randomKey || randomUUID
    this.sleep =
      options.sleep || ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)))
    this.qrTimeoutMs = options.qrTimeoutMs || QR_TIMEOUT_MS
    this.sessionTimeoutMs = options.sessionTimeoutMs || SESSION_TIMEOUT_MS
  }

  hasActiveLogin(): boolean {
    return this.current?.status === 'waiting' || Boolean(this.current?.code)
  }

  async getQrLogin(versionRoot: string, signal?: AbortSignal): Promise<QqAuthLogin> {
    await this.clear()
    if (signal?.aborted) throw new Error('QQ 登录请求已取消')
    const attempt: Attempt = {
      key: this.randomKey(),
      root: resolve(versionRoot),
      status: 'waiting',
      expiresAt: this.now() + this.sessionTimeoutMs,
      listeners: []
    }
    this.current = attempt
    const cancel = new Promise<never>((_done, reject) => {
      attempt.rejectPending = reject
    })
    const onAbort = (): void => {
      this.finish(attempt, 'closed', 'QQ 登录请求已取消')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const qrTimer = setTimeout(() => {
      this.finish(attempt, 'closed', '官方 QQ 网页没有及时返回二维码，请重试并留意官方验证提示')
    }, this.qrTimeoutMs)
    attempt.expiryTimer = setTimeout(() => {
      if (attempt.status === 'waiting') this.finish(attempt, 'expired')
      else attempt.code = undefined
    }, this.sessionTimeoutMs)
    attempt.expiryTimer.unref?.()
    try {
      return await Promise.race([this.obtainQr(attempt), cancel])
    } catch (error) {
      if (attempt.status === 'waiting') this.finish(attempt, 'closed')
      await attempt.cleanup
      throw error
    } finally {
      clearTimeout(qrTimer)
      attempt.rejectPending = undefined
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async checkQrLogin(versionRoot: string, key: string): Promise<QqAuthCheckResult> {
    const attempt = this.current
    if (!attempt || attempt.root !== resolve(versionRoot) || attempt.key !== key) {
      return { status: 'closed' }
    }
    if (attempt.status === 'waiting' && this.now() >= attempt.expiresAt)
      this.finish(attempt, 'expired')
    const result: QqAuthCheckResult = { status: attempt.status }
    if (attempt.status === 'authorized' && attempt.code) {
      result.code = attempt.code
      attempt.code = undefined
      if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer)
    }
    await attempt.cleanup
    return result
  }

  async clear(versionRoot?: string): Promise<void> {
    const attempt = this.current
    if (!attempt || (versionRoot && resolve(versionRoot) !== attempt.root)) return
    this.current = null
    attempt.code = undefined
    if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer)
    this.finish(attempt, 'closed')
    await attempt.cleanup
  }

  private async obtainQr(attempt: Attempt): Promise<QqAuthLogin> {
    const browser = await this.createBrowser({
      title: 'QQ 扫码登录',
      width: 760,
      height: 600,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        partition: `qqmusic-auth-${attempt.key}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })
    if (this.current !== attempt || attempt.status !== 'waiting') {
      if (!browser.window.isDestroyed()) browser.window.destroy()
      await browser.dispose()
      throw new Error('QQ 登录请求已结束')
    }
    attempt.browser = browser
    const win = browser.window
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const onNavigation: Listener = (...args) => {
      const event = args[0] as
        | { url?: string; isMainFrame?: boolean; preventDefault?: () => void }
        | undefined
      const url = event?.url || (typeof args[1] === 'string' ? args[1] : '')
      const code = readQqAuthorizationCode(url, attempt.key)
      if (!code) {
        const isMainFrame = event?.isMainFrame ?? (typeof args[3] === 'boolean' ? args[3] : true)
        if (!isOfficialLoginNavigation(url, isMainFrame)) event?.preventDefault?.()
        return
      }
      event?.preventDefault?.()
      if (this.current !== attempt || attempt.status !== 'waiting') return
      attempt.code = code
      this.finish(attempt, 'authorized')
    }
    for (const event of ['will-frame-navigate', 'will-navigate', 'will-redirect']) {
      this.listen(attempt, win.webContents, event, onNavigation)
    }
    this.listen(attempt, win, 'closed', () => this.finish(attempt, 'closed'))
    const url = new URL('https://graph.qq.com/oauth2.0/authorize')
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: QQ_APP_ID,
      redirect_uri: CALLBACK_URL,
      state: attempt.key,
      display: 'pc',
      scope: 'get_user_info'
    }).toString()
    void win
      .loadURL(url.href)
      .catch(() => this.finish(attempt, 'closed', 'QQ 官方登录网页加载失败'))
    const initializedFrames = new WeakSet<QqAuthFrame>()
    while (this.current === attempt && attempt.status === 'waiting' && !win.isDestroyed()) {
      for (const frame of win.webContents.mainFrame.framesInSubtree) {
        if (!isQqLoginFrame(frame.url)) continue
        try {
          if (!initializedFrames.has(frame)) {
            if (await frame.executeJavaScript(SHOW_QR_PANEL)) initializedFrames.add(frame)
          }
          const imageDataUrl = await frame.executeJavaScript(READ_QR_IMAGE)
          if (this.current !== attempt || attempt.status !== 'waiting') break
          if (isPngDataUrl(imageDataUrl)) {
            return {
              key: attempt.key,
              imageDataUrl,
              expiresInSeconds: Math.ceil((attempt.expiresAt - this.now()) / 1000)
            }
          }
        } catch {
          // Frames may disappear while the official page navigates or validates.
        }
      }
      await this.sleep(150)
    }
    throw new Error('QQ 登录请求已结束')
  }

  private listen(attempt: Attempt, source: EventSource, event: string, listener: Listener): void {
    source.on(event, listener)
    attempt.listeners.push({ source, event, listener })
  }

  private finish(
    attempt: Attempt,
    status: QqAuthCheckResult['status'],
    reason = 'QQ 登录请求已结束'
  ): void {
    if (attempt.status !== 'waiting') return
    attempt.status = status
    if (status === 'expired' || status === 'closed') attempt.code = undefined
    if (status !== 'authorized' && attempt.expiryTimer) clearTimeout(attempt.expiryTimer)
    attempt.rejectPending?.(new Error(reason))
    if (attempt.cleanup) return
    for (const item of attempt.listeners) item.source.off(item.event, item.listener)
    attempt.listeners = []
    const browser = attempt.browser
    if (browser && !browser.window.isDestroyed()) browser.window.destroy()
    attempt.cleanup = browser ? browser.dispose().catch(() => undefined) : Promise.resolve()
  }
}
