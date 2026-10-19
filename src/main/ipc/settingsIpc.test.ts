import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

test('music folder picker remembers an existing or removed root across registration and cancellation', async () => {
  const runtime = {
    appSettings: { libraryFolders: ['D:/Music/A', 'D:/Music/B'], lastLibraryFolder: '' }
  }
  const defaults: (string | undefined)[] = []
  let selected: string | null = 'D:/Music/A'
  let saved = ''
  const dependencies: Record<string, unknown> = {
    electron: {
      BrowserWindow: { getFocusedWindow: () => ({}) },
      dialog: {
        showOpenDialog: async (_window: unknown, options: { defaultPath?: string }) => {
          defaults.push(options.defaultPath)
          return { canceled: selected === null, filePaths: selected ? [selected] : [] }
        }
      }
    },
    path: {},
    'fs/promises': {},
    '../core/runtime': { runtime },
    '../core/settings': {},
    '../core/settingsBackup': {},
    '../themes/themeLibrary.ts': {},
    './themes.ts': {},
    '../cache/ncmCache': {},
    '../cache/musicCacheLayout.ts': {},
    '../library/coverCache': {},
    '../app/settingsRuntime.ts': {
      updateAppSettings: async (patch: Partial<typeof runtime.appSettings>) => {
        runtime.appSettings = { ...runtime.appSettings, ...patch }
        saved = JSON.stringify(runtime.appSettings)
      }
    },
    '../integrations/shortcutsTray': {},
    '../security/localPaths': {
      grantUserSelectedLibraryRoot: async (folder: string) => folder,
      resolveAuthorizedLibraryRootSettings: async (folders: string[]) => [...new Set(folders)]
    },
    '../security/ipcValidation.ts': {},
    '../security/electronSecurity.ts': { assertTrustedIpcSender() {} }
  }
  const register = () => {
    const exports: { registerSettingsIpc?: (ipc: unknown) => void } = {}
    runInNewContext(
      ts.transpileModule(readFileSync(new URL('./settingsIpc.ts', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports,
        require: (id: string) => {
          assert.ok(id in dependencies, id)
          return dependencies[id]
        }
      }
    )
    const handlers = new Map<string, (event: unknown) => Promise<string | null>>()
    exports.registerSettingsIpc!({
      handle: (channel: string, handler: (event: unknown) => Promise<string | null>) =>
        handlers.set(channel, handler)
    })
    return handlers.get('dialog:openFolder')!
  }

  let pick = register()
  assert.equal(await pick({}), 'D:/Music/A')
  assert.equal(defaults.at(-1), 'D:/Music/B', 'legacy settings use the last library root')
  assert.equal(runtime.appSettings.lastLibraryFolder, 'D:/Music/A')
  assert.deepEqual(Array.from(runtime.appSettings.libraryFolders), ['D:/Music/A', 'D:/Music/B'])

  runtime.appSettings = JSON.parse(saved)
  runtime.appSettings.libraryFolders = []
  pick = register()
  selected = null
  assert.equal(await pick({}), null)
  assert.equal(defaults.at(-1), 'D:/Music/A', 'removed roots remain picker history after restart')
  assert.equal(runtime.appSettings.lastLibraryFolder, 'D:/Music/A')

  selected = 'E:/New Music'
  assert.equal(await pick({}), selected)
  assert.equal(runtime.appSettings.lastLibraryFolder, selected)
  assert.deepEqual(Array.from(runtime.appSettings.libraryFolders), [selected])
})
