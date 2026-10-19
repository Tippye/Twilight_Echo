import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

for (const watchLibrary of [true, false]) {
  test(`adding a library folder imports existing files with watching ${watchLibrary}`, async () => {
    const scans: unknown[] = []
    const runtime = {
      appSettings: { libraryFolders: ['/music/existing'], watchLibrary },
      launchSettings: {},
      localLibraryIndexCoordinator: {
        enqueueWatcherChanges: (changes: unknown) => {
          assert.deepEqual(Array.from(runtime.appSettings.libraryFolders), [
            '/music/existing',
            '/music/new'
          ])
          scans.push(JSON.parse(JSON.stringify(changes)))
        }
      }
    }
    const dependencies: Record<string, unknown> = {
      electron: {},
      '../core/runtime': { runtime },
      '../../shared/twilightAutoMix.ts': {},
      '../core/settings': {
        normalizeAppSettings: (settings: unknown) => settings,
        writeAppSettings() {},
        createSettingsSnapshot: (settings: unknown) => ({ settings })
      },
      '../integrations/miniPlayer': {},
      '../integrations/desktopLyrics': {},
      '../integrations/shortcutsTray': { applyRuntimeSettings() {} },
      './AfterglowModeService.ts': { reassertAfterglowShortcuts() {} },
      '../audio/state.ts': {},
      './windowAppearance.ts': {},
      '../cache/ncmCache': {},
      '../integrations/discord': {},
      '../library/watcher': { applyLibraryWatchers() {} }
    }
    const exports: { updateAppSettings?: (patch: Record<string, unknown>) => Promise<unknown> } = {}
    runInNewContext(
      ts.transpileModule(readFileSync(new URL('./settingsRuntime.ts', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      {
        exports,
        require: (id: string) => {
          assert.ok(id in dependencies, id)
          return dependencies[id]
        },
        console,
        process
      }
    )
    await exports.updateAppSettings!({ libraryFolders: ['/music/existing', '/music/new'] })
    assert.deepEqual(scans, [[{ kind: 'reconcile', path: '/music/new' }]])
    await exports.updateAppSettings!({ libraryFolders: ['/music/existing', '/music/new'] })
    await exports.updateAppSettings!({ libraryFolders: ['/music/existing'] })
    await exports.updateAppSettings!({ watchLibrary: !watchLibrary })
    assert.equal(scans.length, 1, 'unchanged roots, removals and watcher toggles must not reimport')
  })
}
