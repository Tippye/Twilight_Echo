import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  QqAuthBridge,
  readQqAuthorizationCode,
  type QqAuthBrowser,
  type QqAuthFrame,
  type QqAuthWindowOptions
} from './qqAuthBridge.ts'

const ROOT = 'E:/qq-provider-version'
const KEY = 'local-opaque-state'
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII='
const FRAME_URL =
  'https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=716027609&daid=383&pt_3rd_aid=100497308'
const turn = (): Promise<void> => new Promise((done) => setImmediate(done))
const callbackUrl = (code = 'official_code', state = KEY): string =>
  `https://y.qq.com/wk_v17/common_login.html?type=QQ&code=${code}&state=${state}`

test('QR retrieval survives disposed frame-tree and frame-URL getters during navigation', async () => {
  let executedDisposed = false
  const disposed = {
    get url(): string { throw new Error('Render frame was disposed before WebFrameMain could be accessed') },
    async executeJavaScript(): Promise<unknown> { executedDisposed = true; return null }
  }
  const live = frame()
  const f = fixture([disposed, live])
  const mainFrame = f.win.webContents.mainFrame
  let reads = 0
  Object.defineProperty(f.win.webContents, 'mainFrame', {
    get() {
      if (reads++ === 0) throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      return mainFrame
    }
  })
  const result = await f.bridge.getQrLogin(ROOT)
  assert.equal(result.imageDataUrl, PNG)
  assert.equal(executedDisposed, false)
  assert.equal(live.scripts.length, 2)
  assert.ok(reads >= 2)
  await f.bridge.clear(ROOT)
})

class FakeContents extends EventEmitter {
  mainFrame: { framesInSubtree: QqAuthFrame[] }
  openHandler?: () => { action: 'deny' }
  constructor(frames: QqAuthFrame[]) {
    super()
    this.mainFrame = { framesInSubtree: frames }
  }
  setWindowOpenHandler(handler: () => { action: 'deny' }): void {
    this.openHandler = handler
  }
}
class FakeWindow extends EventEmitter {
  webContents: FakeContents
  url = ''
  destroyed = false
  destroyCount = 0
  loadFailure?: (reason: Error) => void
  constructor(frames: QqAuthFrame[]) {
    super()
    this.webContents = new FakeContents(frames)
  }
  async loadURL(url: string): Promise<void> {
    this.url = url
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.destroyCount += 1
    this.emit('closed')
    this.loadFailure?.(new Error('destroyed during load'))
  }
}
function frame(image: unknown = PNG): QqAuthFrame & { scripts: string[] } {
  return {
    url: FRAME_URL,
    scripts: [],
    async executeJavaScript(source) {
      this.scripts.push(source)
      return source.includes('switchpage(2)') ? true : image
    }
  }
}
function fixture(frames: QqAuthFrame[] = [frame()]): {
  win: FakeWindow
  browser: QqAuthBrowser
  disposeCount: () => number
  options: () => QqAuthWindowOptions | undefined
  bridge: QqAuthBridge
} {
  const win = new FakeWindow(frames)
  let disposed = 0
  let options: QqAuthWindowOptions | undefined
  const browser: QqAuthBrowser = {
    window: win,
    async dispose() {
      disposed += 1
    }
  }
  const bridge = new QqAuthBridge({
    randomKey: () => KEY,
    createBrowser: async (received) => {
      options = received
      return browser
    }
  })
  return { win, browser, disposeCount: () => disposed, options: () => options, bridge }
}

test('returns only an actual PNG from the selected QQ frame in an isolated visible window', async () => {
  let foreignCalls = 0
  const selected = frame()
  const foreign: QqAuthFrame = {
    url: FRAME_URL.replace('xui.ptlogin2.qq.com', 'example.com'),
    async executeJavaScript() {
      foreignCalls += 1
      return PNG
    }
  }
  const { bridge, win, options } = fixture([foreign, selected])
  try {
    const qr = await bridge.getQrLogin(ROOT)
    assert.equal(qr.key, KEY)
    assert.equal(qr.imageDataUrl, PNG)
    assert.ok(qr.expiresInSeconds > 0 && qr.expiresInSeconds <= 600)
    assert.equal('qrContent' in qr, false)
    assert.equal(foreignCalls, 0)
    assert.equal(selected.scripts.length, 2)
    assert.match(selected.scripts[0], /switchpage\(2\)/)
    assert.match(selected.scripts[1], /getElementById\('qrlogin_img'\)/)
    assert.match(selected.scripts[1], /source\.origin !== location\.origin/)
    assert.doesNotMatch(
      selected.scripts.join(''),
      /document\.cookie|localStorage|require\(|ipcRenderer/
    )
    assert.deepEqual(options()?.webPreferences, {
      partition: `qqmusic-auth-${KEY}`,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    })
    assert.equal(options()?.show, true)
    assert.equal(options()?.webPreferences.partition.startsWith('persist:'), false)
    assert.deepEqual(win.webContents.openHandler?.(), { action: 'deny' })
    const url = new URL(win.url)
    assert.equal(url.origin, 'https://graph.qq.com')
    assert.equal(url.pathname, '/oauth2.0/authorize')
    assert.equal(url.searchParams.get('client_id'), '100497308')
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://y.qq.com/wk_v17/common_login.html?type=QQ'
    )
    assert.equal(url.searchParams.get('state'), KEY)
    assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), { status: 'waiting' })
  } finally {
    await bridge.clear()
  }
})

test('callback authority rejects wrong origins, paths, account types, states and duplicate values', () => {
  assert.equal(readQqAuthorizationCode(callbackUrl(), KEY), 'official_code')
  const rejected = [
    callbackUrl().replace('https:', 'http:'),
    callbackUrl().replace('y.qq.com', 'y.qq.com.evil.example'),
    callbackUrl().replace('y.qq.com', 'user:pass@y.qq.com'),
    callbackUrl().replace('y.qq.com', 'y.qq.com:444'),
    callbackUrl().replace('common_login.html', 'common_login.html/extra'),
    callbackUrl().replace('type=QQ', 'type=WX'),
    callbackUrl('official_code', 'foreign-state'),
    callbackUrl() + '&code=second',
    callbackUrl() + '&type=QQ',
    callbackUrl() + '&state=' + KEY,
    callbackUrl() + '#code=hidden',
    callbackUrl().replace('code=official_code', 'code='),
    callbackUrl().replace('code=official_code', 'code=%0Asecret')
  ]
  for (const url of rejected) assert.equal(readQqAuthorizationCode(url, KEY), null)
})

test('top and frame navigation stays inside the official HTTPS login boundary', async () => {
  const { bridge, win } = fixture()
  try {
    await bridge.getQrLogin(ROOT)
    for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      for (const isMainFrame of [true, false]) {
        const blocked = [
          'https://example.com/login',
          'http://graph.qq.com/oauth2.0/authorize',
          'https://qq.com.evil.example/',
          'https://user:pass@graph.qq.com/',
          'https://graph.qq.com:444/',
          'file:///C:/private.txt',
          'javascript:alert(1)',
          'qqmusic://login',
          'data:text/html,hello',
          'https://unrelated.gtimg.com/frame',
          'https://captcha.gtimg.com/unrelated'
        ]
        for (const url of blocked) {
          let prevented = false
          win.webContents.emit(eventName, {
            url,
            isMainFrame,
            preventDefault() {
              prevented = true
            }
          })
          assert.equal(prevented, true, `${eventName} blocks ${url}`)
        }
        const allowed = [
          'https://graph.qq.com/oauth2.0/login_jump',
          FRAME_URL,
          'https://xui.ptlogin2.qq.com/web/verify/iframe',
          'https://t.captcha.qq.com/cap_union_new_show',
          'https://captcha.gtimg.com/1/tcaptcha-frame.html',
          'https://support.tencent.com/official'
        ]
        for (const url of allowed) {
          let prevented = false
          win.webContents.emit(eventName, {
            url,
            isMainFrame,
            preventDefault() {
              prevented = true
            }
          })
          assert.equal(prevented, false, `${eventName} allows ${url}`)
        }
      }
    }
    let topBlank = false,
      frameBlank = false
    win.webContents.emit('will-frame-navigate', {
      url: 'about:blank',
      isMainFrame: true,
      preventDefault() {
        topBlank = true
      }
    })
    win.webContents.emit('will-frame-navigate', {
      url: 'about:blank',
      isMainFrame: false,
      preventDefault() {
        frameBlank = true
      }
    })
    assert.equal(topBlank, true)
    assert.equal(frameBlank, false)
    assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), { status: 'waiting' })
  } finally {
    await bridge.clear()
  }
})

test('navigation consumes the code once and late load failures cannot erase authorization', async () => {
  const { bridge, win, disposeCount } = fixture()
  win.loadURL = (url) => {
    win.url = url
    return new Promise((_done, reject) => {
      win.loadFailure = reject
    })
  }
  try {
    await bridge.getQrLogin(ROOT)
    let prevented = 0
    win.webContents.emit('will-frame-navigate', {
      url: callbackUrl(),
      preventDefault() {
        prevented += 1
      }
    })
    await turn()
    assert.equal(prevented, 1)
    assert.equal(win.destroyCount, 1)
    assert.equal(disposeCount(), 1)
    assert.equal(win.webContents.listenerCount('will-redirect'), 0)
    assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), {
      status: 'authorized',
      code: 'official_code'
    })
    assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), { status: 'authorized' })
    assert.equal(bridge.hasActiveLogin(), false)
    assert.deepEqual(await bridge.checkQrLogin('E:/other-version', KEY), { status: 'closed' })
  } finally {
    await bridge.clear()
  }
})

test('closing the official window ends a pending image read without revival', async () => {
  let releaseImage: (image: string) => void = () => undefined
  let reading = false
  const selected: QqAuthFrame = {
    url: FRAME_URL,
    async executeJavaScript(source) {
      if (source.includes('switchpage(2)')) return true
      reading = true
      return new Promise<string>((done) => {
        releaseImage = done
      })
    }
  }
  const { bridge, win, disposeCount } = fixture([selected])
  const request = bridge.getQrLogin(ROOT)
  await turn()
  assert.equal(reading, true)
  win.destroy()
  await assert.rejects(request, /已结束/)
  releaseImage(PNG)
  await turn()
  assert.equal(disposeCount(), 1)
  assert.equal(win.destroyCount, 1)
  assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), { status: 'closed' })
  await bridge.clear()
})

test('abort during browser creation disposes a late browser and never attaches listeners', async () => {
  const win = new FakeWindow([frame()])
  let disposed = 0
  let releaseBrowser: (browser: QqAuthBrowser) => void = () => undefined
  const bridge = new QqAuthBridge({
    randomKey: () => KEY,
    createBrowser: () =>
      new Promise<QqAuthBrowser>((done) => {
        releaseBrowser = done
      })
  })
  const controller = new AbortController()
  const request = bridge.getQrLogin(ROOT, controller.signal)
  await turn()
  controller.abort()
  await assert.rejects(request, /已取消/)
  releaseBrowser({
    window: win,
    async dispose() {
      disposed += 1
    }
  })
  await turn()
  assert.equal(win.destroyCount, 1)
  assert.equal(disposed, 1)
  assert.equal(win.url, '')
  assert.equal(win.webContents.listenerCount('will-frame-navigate'), 0)
  await bridge.clear()
})

test('a blocked QR image request times out and cannot return an OAuth URL as a QR', async () => {
  const win = new FakeWindow([frame('https://graph.qq.com/oauth2.0/authorize')])
  let disposed = 0
  const bridge = new QqAuthBridge({
    randomKey: () => KEY,
    qrTimeoutMs: 15,
    createBrowser: async () => ({
      window: win,
      async dispose() {
        disposed += 1
      }
    })
  })
  await assert.rejects(bridge.getQrLogin(ROOT), /没有及时返回二维码/)
  assert.equal(win.destroyCount, 1)
  assert.equal(disposed, 1)
  assert.equal(win.webContents.listenerCount('will-navigate'), 0)
  assert.deepEqual(await bridge.checkQrLogin(ROOT, KEY), { status: 'closed' })
  await bridge.clear()
})

test('waiting attempts expire and replacement clears the previous browser and code', async () => {
  let now = Date.now()
  let serial = 0
  const windows: FakeWindow[] = []
  let disposed = 0
  const bridge = new QqAuthBridge({
    now: () => now,
    randomKey: () => `opaque-${++serial}`,
    createBrowser: async () => {
      const window = new FakeWindow([frame()])
      windows.push(window)
      return {
        window,
        async dispose() {
          disposed += 1
        }
      }
    }
  })
  try {
    const first = await bridge.getQrLogin(ROOT)
    const second = await bridge.getQrLogin(ROOT)
    assert.equal(windows[0].destroyCount, 1)
    assert.deepEqual(await bridge.checkQrLogin(ROOT, first.key), { status: 'closed' })
    await bridge.clear('E:/foreign-version')
    assert.equal(windows[1].destroyCount, 0)
    now += 600_001
    assert.deepEqual(await bridge.checkQrLogin(ROOT, second.key), { status: 'expired' })
    assert.deepEqual(await bridge.checkQrLogin(ROOT, second.key), { status: 'expired' })
    assert.equal(windows[1].destroyCount, 1)
    assert.equal(disposed, 2)
  } finally {
    await bridge.clear()
  }
})

test('page initialization retries until the official QR switch function becomes available', async () => {
  let attempts = 0
  const selected: QqAuthFrame = {
    url: FRAME_URL,
    async executeJavaScript(source) {
      if (source.includes('switchpage(2)')) return ++attempts > 1
      return attempts > 1 ? PNG : null
    }
  }
  const win = new FakeWindow([selected])
  const bridge = new QqAuthBridge({
    randomKey: () => KEY,
    sleep: async () => undefined,
    createBrowser: async () => ({ window: win, async dispose() {} })
  })
  try {
    assert.equal((await bridge.getQrLogin(ROOT)).imageDataUrl, PNG)
    assert.equal(attempts, 2)
  } finally {
    await bridge.clear()
  }
})
