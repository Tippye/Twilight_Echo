// Execute with Electron, passing the resources/app.asar extracted from the installer.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const asarPath = path.resolve(process.argv[2])
const output = path.resolve(process.argv[3])
app.setPath('userData', path.join(output, 'profile'))
app.setAppLogsPath(path.join(output, 'logs'))
app.setAppPath(asarPath)
Object.defineProperty(process, 'resourcesPath', { value: path.dirname(asarPath) })
process.env.TWILIGHT_LOG_DIRECTORY = path.join(output, 'logs', 'diagnostics')
app.on('browser-window-created', (_event, window) => {
  window.show = () => {}
  window.hide()
})
dialog.showSaveDialog = async () => ({
  canceled: false,
  filePath: path.join(output, 'diagnostics.zip')
})
require(path.join(asarPath, 'out', 'main', 'index.js'))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const watchdog = setTimeout(() => {
  console.error('Diagnostic package smoke timed out')
  app.exit(2)
}, 90000)

app
  .whenReady()
  .then(async () => {
    await fs.mkdir(output, { recursive: true })
    let window
    for (let i = 0; i < 300; i++) {
      window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('index.html')
      )
      if (window && !window.webContents.isLoading()) break
      await pause(100)
    }
    assert.ok(window, 'main window must load')
    const evaluate = (expression) => window.webContents.executeJavaScript(expression)
    await pause(1500)
    const status = await evaluate('window.api.diagnostics.getStatus()')
    assert.equal(status.error, null)
    assert.equal(status.level, 'debug')
    const settings = await evaluate('window.api.settings.get()')
    assert.ok(settings && typeof settings === 'object', 'legacy business API remains compatible')
    await evaluate(
      `setTimeout(() => { throw new Error('diagnostic-renderer-smoke Bearer private-secret') }, 0); true`
    )
    const marker = await evaluate(
      `window.api.diagnostics.markProblem('package-smoke password=private-secret')`
    )
    assert.ok(marker.markerId)
    await evaluate('window.api.audioEngine.getPlaybackInfo()')
    await pause(3500)
    const exported = await evaluate('window.api.diagnostics.exportBundle()')
    assert.equal(exported.filePath, path.join(output, 'diagnostics.zip'))
    const zipBytes = (await fs.stat(exported.filePath)).size
    assert.ok(zipBytes > 1000)
    const logs = []
    for (const name of await fs.readdir(status.directory))
      if (name.endsWith('.jsonl')) {
        for (const line of (await fs.readFile(path.join(status.directory, name), 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean))
          logs.push(JSON.parse(line))
      }
    assert.ok(logs.some((entry) => entry.event === 'javascript.error'))
    assert.ok(logs.some((entry) => entry.event === 'problem.marked'))
    assert.ok(logs.some((entry) => entry.processRole === 'renderer'))
    assert.ok(
      logs.some((entry) => entry.processRole === 'native' && entry.event === 'health.sample')
    )
    assert.ok(!JSON.stringify(logs).includes('private-secret'))
    // The public diagnostics API must reject unrelated renderer documents.
    const untrusted = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(asarPath, 'out', 'preload', 'index.js'),
        sandbox: true,
        contextIsolation: true
      }
    })
    await untrusted.loadURL('data:text/html,<body>diagnostic-source-test</body>')
    const rejection = await untrusted.webContents.executeJavaScript(
      `window.api.diagnostics.getStatus().then(() => false, () => true)`
    )
    assert.equal(rejection, true)
    untrusted.destroy()
    await fs.writeFile(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          ok: true,
          status,
          marker,
          zipBytes,
          logEvents: logs.length,
          nativeSamples: logs.filter((entry) => entry.event === 'health.sample').length,
          trustedSourceRejected: rejection,
          workerPath: path.join(asarPath, 'out/main/diagnosticWriter.js')
        },
        null,
        2
      )
    )
    clearTimeout(watchdog)
    console.log('DIAGNOSTICS_PACKAGE_SMOKE_OK')
    app.quit()
  })
  .catch(async (error) => {
    console.error(error)
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(
      path.join(output, 'result.json'),
      JSON.stringify({ ok: false, error: String(error), stack: error.stack }, null, 2)
    )
    clearTimeout(watchdog)
    app.exit(1)
  })
