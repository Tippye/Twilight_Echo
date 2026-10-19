import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import { installMouseHistoryNavigation } from './windowHistoryNavigation.ts'
import { IPC } from '../../shared/ipcChannels.ts'

function createMainWindow(options: { destroyed?: () => boolean } = {}) {
  const sent: Array<[string, unknown]> = []
  const webContents = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => sent.push([channel, payload])
  }
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: options.destroyed ?? (() => false),
    webContents
  }) as unknown as BrowserWindow
  let prevented = 0
  const press = (command: unknown): void => {
    win.emit('app-command', { preventDefault: () => prevented++ }, command)
  }
  return { win, sent, press, prevented: () => prevented }
}

test('mouse side buttons forward app commands to the renderer history stack', () => {
  const { win, sent, press, prevented } = createMainWindow()
  installMouseHistoryNavigation(win)

  press('browser-backward')
  press('browser-forward')
  press('browser-backward')

  assert.deepEqual(sent, [
    [IPC.app.historyCommand, 'back'],
    [IPC.app.historyCommand, 'forward'],
    [IPC.app.historyCommand, 'back']
  ])
  assert.equal(prevented(), 3)
})

test('other app commands keep their default handling', () => {
  const { win, sent, press, prevented } = createMainWindow()
  installMouseHistoryNavigation(win)

  for (const command of [
    'media-next-track',
    'browser-refresh',
    'browser-stop',
    '',
    'back',
    'constructor'
  ])
    press(command)

  assert.deepEqual(sent, [])
  assert.equal(prevented(), 0)
})

test('a destroyed window ignores late app commands', () => {
  let destroyed = false
  const { win, sent, press, prevented } = createMainWindow({ destroyed: () => destroyed })
  installMouseHistoryNavigation(win)

  destroyed = true
  press('browser-backward')
  press('browser-forward')

  assert.deepEqual(sent, [])
  assert.equal(prevented(), 2)
})

test('the main window installs mouse history navigation before loading the renderer', async () => {
  const source = await readFile(new URL('./window.ts', import.meta.url), 'utf8')
  const install = source.indexOf('installMouseHistoryNavigation(runtime.mainWindow)')
  const load = Math.min(source.indexOf('.loadURL('), source.indexOf('.loadFile('))

  assert.notEqual(install, -1)
  assert.notEqual(load, -1)
  assert.ok(install < load)
})
