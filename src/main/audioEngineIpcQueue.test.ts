import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCueRange } from '../shared/cue.ts'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { resolveAuthorizationBatch } from './security/authorizationBatch.ts'
import {
  bindPlaybackSourceMetadata,
  providerPlaybackIdentities,
  ProviderPlaybackIdentityRegistry
} from './audio/providerPlaybackIdentity.ts'
import { normalizeFiniteNumber } from './security/ipcValidation.ts'

function readPreloadSources(): string {
  const root = new URL('../preload/', import.meta.url)
  return [
    'index.ts',
    'types.ts',
    'index.d.ts',
    'sleepTimerEvents.ts',
    'domains/dataApi.ts',
    'domains/audioEngineApi.ts',
    'domains/desktopLyricsApi.ts',
    'domains/libraryApi.ts',
    'domains/mediaSubscriptionsApi.ts',
    'domains/networkSourcesApi.ts',
    'domains/settingsApi.ts',
    'domains/themesApi.ts',
    'domains/pluginsApi.ts',
    'domains/systemApi.ts',
    'domains/versionedData.ts'
  ]
    .map((rel) => readFileSync(new URL(rel, root), 'utf8'))
    .join('\n')
}

const source = readFileSync(new URL('./audio/engineIpc.ts', import.meta.url), 'utf8')
const preloadSource = readPreloadSources()
const preloadTypes = readFileSync(new URL('../preload/types.ts', import.meta.url), 'utf8')
const preloadDeclaration = readFileSync(new URL('../preload/index.d.ts', import.meta.url), 'utf8')
const deviceHotplugSource = readFileSync(
  new URL('./audio/deviceHotplug.ts', import.meta.url),
  'utf8'
)
const windowSource = readFileSync(new URL('./app/window.ts', import.meta.url), 'utf8')

test('plugin queue events preserve ordinary source metadata without mutating native queue', () => {
  const start = source.indexOf("runtime.audioEngineManager.on('queue-change'")
  const declaration = source.slice(
    start,
    source.indexOf('\n  runtime.audioEngineManager.on(', start + 1)
  )
  let callback!: (queue: unknown[]) => void
  let received: unknown
  runInNewContext(stripTypeScriptTypes(declaration), {
    runtime: {
      audioEngineManager: {
        on: (_event: string, value: typeof callback) => {
          callback = value
        }
      },
      pluginManager: {
        broadcastEvent: (_event: string, payload: unknown) => {
          received = payload
        }
      }
    }
  })
  const item = {
    id: 'public-song',
    source: 'public.flac',
    sourceBytes: 123456,
    rendererSource: 'twilight-media://public'
  }
  callback([item])
  assert.deepEqual(JSON.parse(JSON.stringify(received)), {
    queue: [
      {
        id: 'public-song',
        source: 'public.flac',
        sourceBytes: 123456,
        rendererSource: 'twilight-media://public'
      }
    ]
  })
  assert.equal(item.sourceBytes, 123456)
  assert.notEqual((received as { queue: unknown[] }).queue[0], item)
})

test('audioEngine loadQueue IPC accepts renderer queue items with source field', () => {
  const start = source.indexOf('function toQueueItem')
  const end = source.indexOf('ipcMain.handle(IPC.audioEngine.loadQueue', start)
  assert.notEqual(start, -1, 'toQueueItem should exist')
  assert.notEqual(end, -1, 'audioEngine:loadQueue handler should exist')
  const toQueueItem = source.slice(start, end)

  assert.match(toQueueItem, /typeof item\.source === 'string'/)
  assert.match(toQueueItem, /source: normalizedSource,\s*\n\s*title:/)
  assert.match(toQueueItem, /normalizeIpcString\(source, 'queue item source'/)
  assert.equal(
    /typeof item\.filePath === 'string'[\s\S]*typeof item\.source === 'string'/.test(toQueueItem),
    false,
    'source must be checked before filePath because renderer queue items no longer include filePath'
  )
})

test('queue normalization drops untrusted renderer source aliases and byte counts', () => {
  const start = source.indexOf('export function toQueueItem(')
  const declaration = source
    .slice(start, source.indexOf('\nasync function authorizeAudioProcessingSettings', start))
    .replace('export function', 'function')
  const textStart = source.indexOf('function normalizeQueueText(')
  const textDeclaration = source.slice(
    textStart,
    source.indexOf('\nasync function resolveAuthorizedPlaybackSource', textStart)
  )
  const context = {
    normalizeIpcString: (value: string) => value,
    MAX_AUDIO_SOURCE_LENGTH: 8192,
    normalizeCueRange,
    result: null as Record<string, unknown> | null
  }
  runInNewContext(
    stripTypeScriptTypes(`${textDeclaration}\n${declaration}\nresult = toQueueItem({
    id: 'qq:fixture', source: 'twilight-media://audio/fixture',
    rendererSource: 'twilight-media://audio/forged', sourceBytes: 123,
    unknownField: 'untrusted'
  })`),
    context
  )
  assert.equal(context.result?.source, 'twilight-media://audio/fixture')
  assert.equal(Object.hasOwn(context.result!, 'rendererSource'), false)
  assert.equal(Object.hasOwn(context.result!, 'sourceBytes'), false)
  assert.equal(Object.hasOwn(context.result!, 'unknownField'), false)
})

test('audio engine cold start passes persisted software volume into the manager', () => {
  assert.match(source, /volume: runtime\.appSettings\.softwareVolume/)
})

test('audioEngine play IPC forwards validated paused options and preserves the omitted option', async () => {
  const helperStart = source.indexOf('function normalizePlayOptions(')
  const helper = source.slice(
    helperStart,
    source.indexOf('\nexport function toQueueItem', helperStart)
  )
  const channel = source.indexOf('IPC.audioEngine.play,')
  const start = source.lastIndexOf('ipcMain.handle(', channel)
  assert.ok(channel >= 0 && start >= 0)
  const declaration = source.slice(start, source.indexOf('\n  ipcMain.handle(', start + 1))
  let handler!: (
    event: unknown,
    source: string,
    time?: number,
    options?: unknown
  ) => Promise<unknown>
  const plays: unknown[][] = []
  let authorized = 0
  runInNewContext(stripTypeScriptTypes(`${helper}\n${declaration}`), {
    IPC: { audioEngine: { play: 'play' } },
    ipcMain: {
      handle: (_channel: string, callback: typeof handler) => {
        handler = callback
      }
    },
    assertTrustedIpcSender: () => {},
    normalizeIpcString: (value: string) => value,
    normalizeFiniteNumber: (value: number | undefined) => value ?? 0,
    MAX_AUDIO_SOURCE_LENGTH: 4096,
    resolveAuthorizedPlaybackSource: async (value: string) => {
      authorized++
      return value
    },
    audioDiagnosticRecorder: null,
    providerPlaybackIdentities,
    outputTest: { stop: async () => {} },
    ensureAudioEngineRuntime: async () => ({
      play: async (...args: unknown[]) => {
        plays.push(args)
        return { nativeStarted: true, fallbackReason: '' }
      }
    })
  })
  await handler({}, 'public.flac', 12, { paused: true })
  await handler({}, 'legacy.flac')
  assert.deepEqual(JSON.parse(JSON.stringify(plays)), [
    ['public.flac', 12, { paused: true }],
    ['legacy.flac', 0, {}]
  ])
  for (const invalid of [
    null,
    [],
    true,
    { paused: 'true' },
    { paused: 1 },
    { paused: null },
    { paused: false, unknown: 1 }
  ]) {
    await assert.rejects(handler({}, 'invalid.flac', 0, invalid), /Invalid playback options/)
  }
  assert.equal(authorized, 2)
  assert.equal(plays.length, 2)
  assert.match(
    preloadSource,
    /ipcRenderer\.invoke\(IPC\.audioEngine\.play, filePath, startTime, options\)/
  )
  assert.match(preloadDeclaration, /options\?: AudioEnginePlayOptions/)
})

function registerSeekIpcHandler(
  seek: (position: number) => Promise<void>
): (event: unknown, position: number) => Promise<void> {
  const start = source.indexOf('ipcMain.handle(IPC.audioEngine.seek,')
  assert.ok(start >= 0)
  const declaration = source.slice(start, source.indexOf('\n  ipcMain.handle(', start + 1))
  let handler!: (event: unknown, position: number) => Promise<void>
  runInNewContext(stripTypeScriptTypes(declaration), {
    IPC: { audioEngine: { seek: 'audio:seek' } },
    ipcMain: {
      handle: (channel: string, callback: typeof handler) => {
        assert.equal(channel, 'audio:seek')
        handler = callback
      }
    },
    assertTrustedIpcSender: () => {},
    normalizeFiniteNumber,
    ensureAudioEngineRuntime: async () => ({ seek })
  })
  return handler
}

test('audioEngine seek IPC waits for the controller acknowledgement and position readback', async () => {
  let acknowledge!: () => void
  let confirmPosition!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const acknowledgement = new Promise<void>((resolve) => {
    acknowledge = resolve
  })
  const readback = new Promise<void>((resolve) => {
    confirmPosition = resolve
  })
  let position = 209
  const requested: number[] = []
  const handler = registerSeekIpcHandler(async (target) => {
    requested.push(target)
    entered()
    await acknowledgement
    await readback
    position = target
  })
  let completed = false
  let positionWhenResolved = Number.NaN
  const pending = handler({}, 45).then(() => {
    completed = true
    positionWhenResolved = position
  })
  try {
    await started
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(completed, false, 'IPC must not resolve while native Seek is in flight')
    acknowledge()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(completed, false, 'IPC must wait for controller position confirmation too')
    confirmPosition()
    await pending
    assert.deepEqual(requested, [45])
    assert.equal(positionWhenResolved, 45)
  } finally {
    acknowledge()
    confirmPosition()
    await pending
  }
})

test('audioEngine seek IPC propagates a rejected controller position confirmation', async () => {
  let rejectSeek!: (error: Error) => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const completion = new Promise<void>((_resolve, reject) => {
    rejectSeek = reject
  })
  // Observe the synthetic promise even when the old handler discards it. The
  // regression concerns IPC rejection, rather than an unhandled test rejection.
  void completion.catch(() => {})
  const handler = registerSeekIpcHandler(() => {
    entered()
    return completion
  })
  const pending = handler({}, 45)
  await started
  const failure = new Error('native seek position was not confirmed')
  rejectSeek(failure)
  await assert.rejects(pending, (error) => error === failure)
})

test('audioEngine IPC normalizes untrusted renderer parameters', () => {
  assert.match(source, /const MAX_AUDIO_QUEUE_ITEMS = MAX_NATIVE_QUEUE_ITEMS/)
  assert.match(
    source,
    /normalizeIpcArray\(items, 'audio queue', MAX_AUDIO_QUEUE_ITEMS, toQueueItem\)/
  )
  assert.match(source, /queue\.length !== items\.length/)
  assert.match(source, /await resolveAuthorizationBatch\(/)
  assert.match(source, /normalizeIpcString\(source, 'audio source'/)
  assert.match(source, /await resolveAuthorizedPlaybackSource\(/)
  assert.match(source, /normalizeFiniteNumber\(time, 'seek time', 0, 0, Number\.MAX_SAFE_INTEGER\)/)
  assert.match(source, /normalizeFiniteNumber\(volume, 'volume', 1, 0, 1\)/)
  assert.match(source, /normalizeInteger\(points, 'spectrum points', 128, 8, 4096\)/)
  assert.match(
    source,
    /const cueRange = item\.cueRange === undefined \? undefined : normalizeCueRange\(item\.cueRange\)/
  )
  assert.match(source, /if \(cueRange === null\) return null/)
  assert.deepEqual(normalizeCueRange({ startSeconds: 10, endSeconds: 20 }), {
    startSeconds: 10,
    endSeconds: 20,
    pregapSeconds: 0,
    virtualPregapSeconds: 0,
    sourcePregapSeconds: 0
  })
  assert.equal(normalizeCueRange({ startSeconds: 20, endSeconds: 10 }), null)
  assert.equal(normalizeCueRange({ startSeconds: 0, endSeconds: 10, pregapSeconds: -1 }), null)
})

test('loadQueue authorizes duplicate sources once, retains CUE entries, and awaits native completion', async () => {
  const start = source.indexOf('ipcMain.handle(IPC.audioEngine.loadQueue')
  const declaration = source.slice(start, source.indexOf('\n  ipcMain.handle(', start + 1))
  let handler!: (event: unknown, items: unknown[], index: number) => Promise<void>
  let finish!: () => void
  const nativeCompletion = new Promise<void>((resolve) => {
    finish = resolve
  })
  let resolutions = 0
  let received: { id: string; source: string; cueRange: unknown }[] = []
  const diagnostics: string[] = []
  runInNewContext(stripTypeScriptTypes(declaration), {
    IPC: { audioEngine: { loadQueue: 'queue' } },
    ipcMain: {
      handle: (_channel: string, callback: typeof handler) => {
        handler = callback
      }
    },
    assertTrustedIpcSender: () => {},
    MAX_AUDIO_QUEUE_ITEMS: 5000,
    normalizeIpcArray: (items: unknown[]) => items,
    toQueueItem: () => {},
    normalizeInteger: (index: number) => index,
    resolveAuthorizationBatch,
    bindPlaybackSourceMetadata,
    providerPlaybackIdentities,
    resolveAuthorizedPlaybackSource: async () => {
      resolutions++
      return 'canonical.flac'
    },
    ensureAudioEngineRuntime: async () => ({
      loadQueue: (items: typeof received) => {
        received = items
        return nativeCompletion
      }
    }),
    audioDiagnosticRecorder: { record: (kind: string) => diagnostics.push(kind) }
  })
  const items = Array.from({ length: 5000 }, (_, index) => ({
    id: String(index),
    source: 'same.flac',
    cueRange: { startSeconds: index }
  }))
  let completed = false
  const pending = handler({}, items, 17).then(() => {
    completed = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(resolutions, 1)
  assert.equal(received.length, 5000)
  assert.equal(received[17].source, 'canonical.flac')
  assert.equal((received[17] as { rendererSource?: string }).rendererSource, 'same.flac')
  assert.equal(received[17].id, '17')
  assert.equal(received[17].cueRange, items[17].cueRange)
  assert.equal(completed, false)
  assert.deepEqual(diagnostics, [])
  finish()
  await pending
  assert.deepEqual(diagnostics, ['queue-loaded'])
})

test('queue authorization is checked again after awaited runtime startup', async () => {
  const start = source.indexOf('ipcMain.handle(IPC.audioEngine.loadQueue')
  const declaration = source.slice(start, source.indexOf('\n  ipcMain.handle(', start + 1))
  for (const mutation of ['revoke', 'replace', 'expire']) {
    const identities = new ProviderPlaybackIdentityRegistry()
    const stream = 'http://127.0.0.1:1234/audio/public-' + mutation
    const plugin = 'com.twilightecho.provider.qqmusic'
    identities.record(
      'qq',
      'song',
      'flac',
      {
        streamUrl: stream,
        providerSource: {
          actualQuality: 'flac',
          expiresAt: Date.now() + 60000
        }
      },
      plugin
    )
    let handler!: (event: unknown, items: unknown[], index: number) => Promise<unknown>
    let ready!: () => void, announce!: () => void
    const runtime = new Promise<void>((resolve) => {
      ready = resolve
    })
    const entered = new Promise<void>((resolve) => {
      announce = resolve
    })
    let committed = 0
    runInNewContext(stripTypeScriptTypes(declaration), {
      IPC: { audioEngine: { loadQueue: 'queue' } },
      ipcMain: {
        handle: (_channel: string, callback: typeof handler) => {
          handler = callback
        }
      },
      assertTrustedIpcSender: () => {},
      MAX_AUDIO_QUEUE_ITEMS: 5000,
      normalizeIpcArray: (items: unknown[]) => items,
      toQueueItem: () => {},
      normalizeInteger: (value: number) => value,
      resolveAuthorizationBatch,
      bindPlaybackSourceMetadata: (
        item: Parameters<typeof bindPlaybackSourceMetadata>[0],
        value: string
      ) => bindPlaybackSourceMetadata(item, value, identities),
      providerPlaybackIdentities: identities,
      resolveAuthorizedPlaybackSource: async () => stream,
      ensureAudioEngineRuntime: async () => {
        announce()
        await runtime
        return {
          loadQueue: async () => {
            committed++
          }
        }
      },
      audioDiagnosticRecorder: null
    })
    const pending = handler({}, [{ id: 'song', source: 'twilight-media://audio/public' }], 0)
    await entered
    if (mutation === 'revoke') identities.revokePlugin(plugin)
    else
      identities.record(
        'qq',
        'song',
        'flac',
        {
          streamUrl: stream,
          providerSource: {
            actualQuality: '128',
            expiresAt: mutation === 'expire' ? 1 : Date.now() + 60000
          }
        },
        plugin
      )
    ready()
    await assert.rejects(pending, /resolution_changed|expired/, mutation)
    assert.equal(committed, 0, mutation)
  }
})

test('the native queue ceiling is one shared constant on both sides of the IPC', () => {
  const sharedSource = readFileSync(new URL('../shared/nativeQueue.ts', import.meta.url), 'utf8')
  const preparationSource = readFileSync(
    new URL('../renderer/src/utils/nativeQueuePreparation.ts', import.meta.url),
    'utf8'
  )

  assert.match(sharedSource, /export const MAX_NATIVE_QUEUE_ITEMS = 5000/)
  assert.match(
    source,
    /import \{ MAX_NATIVE_QUEUE_ITEMS \} from '\.\.\/\.\.\/shared\/nativeQueue\.ts'/
  )
  // The renderer must prepare a bounded native queue rather than issue a
  // request this handler rejects: the rejection happens before audioEngine:play,
  // so playback dies on every backend and every output device.
  assert.match(
    preparationSource,
    /import \{ MAX_NATIVE_QUEUE_ITEMS \} from '\.\.\/\.\.\/\.\.\/shared\/nativeQueue\.ts'/
  )
  assert.match(
    preparationSource,
    /if \(options\.queue\.length > MAX_NATIVE_QUEUE_ITEMS\) \{\s*return prepareNcmWindow\(options, currentItem, currentIndex\)/
  )
})

test('queue cursor IPC freshly authorizes its source before forwarding the main-owned token', async () => {
  const start = source.indexOf('ipcMain.handle(IPC.audioEngine.selectQueueItem')
  const declaration = source.slice(start, source.indexOf('\n  ipcMain.handle(', start + 1))
  let handler!: (event: unknown, selection: unknown) => Promise<boolean>
  let denied = false
  const calls: string[] = []
  const selections: unknown[] = []
  runInNewContext(stripTypeScriptTypes(declaration), {
    IPC: { audioEngine: { selectQueueItem: 'select' } },
    ipcMain: {
      handle: (_channel: string, callback: typeof handler) => {
        handler = callback
      }
    },
    assertTrustedIpcSender: () => calls.push('trusted'),
    MAX_AUDIO_QUEUE_ITEMS: 5000,
    MAX_AUDIO_SOURCE_LENGTH: 8192,
    normalizeIpcString: (value: string) => value,
    normalizeInteger: (value: number) => value,
    resolveAuthorizedPlaybackSource: async () => {
      calls.push('authorize')
      if (denied) throw new Error('denied')
      return 'canonical.flac'
    },
    outputTest: { stop: async () => calls.push('stop-test') },
    providerPlaybackIdentities,
    ensureAudioEngineRuntime: async () => ({
      selectQueueItem: async (selection: unknown) => {
        calls.push('select')
        selections.push(selection)
        return false // A stale token stays rejected by main.
      }
    })
  })
  const selection = { queueToken: 'stale', index: 3, id: 'cue:3', source: 'alias.flac' }
  assert.equal(await handler({}, selection), false)
  assert.deepEqual(calls, ['trusted', 'authorize', 'stop-test', 'select'])
  assert.equal(
    JSON.stringify(selections[0]),
    JSON.stringify({ ...selection, source: 'canonical.flac' })
  )
  denied = true
  await assert.rejects(handler({}, selection), /denied/)
  assert.equal(selections.length, 1)
  await assert.rejects(handler({}, []), /Invalid queue selection/)
})

test('loadQueue outcomes reach the audio diagnostics log', () => {
  assert.match(source, /const requestedItemCount = Array\.isArray\(items\) \? items\.length : -1/)
  assert.match(source, /audioDiagnosticRecorder\?\.record\('queue-loaded', \{/)
  assert.match(source, /audioDiagnosticRecorder\?\.record\(\s*'queue-load-failed',/)
  assert.match(source, /requestedItems: requestedItemCount/)
  assert.match(source, /limit: MAX_AUDIO_QUEUE_ITEMS/)
})

test('config-applied crosses the manager, IPC, and preload boundary', () => {
  assert.match(source, /audioEngineManager\.on\('config-applied'/)
  assert.match(source, /webContents\.send\(IPC\.audioEngine\.configApplied, event\)/)
  assert.match(preloadSource, /ipcRenderer\.on\(IPC\.audioEngine\.configApplied/)
  assert.match(preloadSource, /audioEngineConfigAppliedCallbacks/)
  assert.match(preloadSource, /onConfigApplied:/)

  assert.match(preloadTypes, /export interface AudioEngineConfigAppliedEvent/)
  assert.match(preloadTypes, /requestedConfigRevision: number/)
  assert.match(preloadTypes, /appliedConfigRevision: number/)
  assert.match(
    preloadDeclaration,
    /import type\s*\{[^}]*\bAudioEngineConfigAppliedEvent\b[^}]*\}\s*from '\.\/types\.ts'/
  )
  assert.match(
    preloadDeclaration,
    /onConfigApplied: \(cb: \(event: AudioEngineConfigAppliedEvent\) => void\) => \(\) => void/
  )
})

test('offline analysis is routed away from the playback audio service', () => {
  const managerSource = readFileSync(new URL('./audioEngineManager.ts', import.meta.url), 'utf8')
  const typesSource = readFileSync(new URL('./audio/audioEngineTypes.ts', import.meta.url), 'utf8')
  const serviceClientSource = readFileSync(
    new URL('./audioEngineServiceClient.ts', import.meta.url),
    'utf8'
  )
  const analysisClientSource = readFileSync(
    new URL('./audioAnalysisServiceClient.ts', import.meta.url),
    'utf8'
  )
  const nativeHeaderSource = readFileSync(
    new URL('../../audio-engine/include/twilight_audio_engine.h', import.meta.url),
    'utf8'
  )
  const nativeBridgeSource = readFileSync(
    new URL('../../audio-engine/napi/twilight_audio_node.cpp', import.meta.url),
    'utf8'
  )

  assert.match(typesSource, /AnalyzeBpm\?: \(source: string, optionsJson\?: string\)/)
  assert.match(managerSource, /async analyzeBpm\(/)
  assert.doesNotMatch(managerSource, /audioServiceBinding\.callAsync\?\.\('AnalyzeBpm'/)
  assert.match(serviceClientSource, /must use the isolated audio analysis service/)
  assert.match(analysisClientSource, /class AudioAnalysisServiceClient/)
  assert.match(analysisClientSource, /maxConcurrency/)
  assert.match(analysisClientSource, /maxQueueSize/)
  assert.match(nativeHeaderSource, /TAE_AnalyzeBpm/)
  assert.match(nativeBridgeSource, /define\(env, exports, "AnalyzeBpm", AnalyzeBpm\)/)
})

test('main window installs Windows audio device hotplug watcher', () => {
  assert.match(deviceHotplugSource, /const WM_DEVICECHANGE = 0x0219/)
  assert.match(deviceHotplugSource, /process\.platform !== 'win32'/)
  assert.match(deviceHotplugSource, /win\.hookWindowMessage\(WM_DEVICECHANGE/)
  assert.match(deviceHotplugSource, /AUDIO_DEVICE_CHANGE_DEBOUNCE_MS = 250/)
  assert.match(
    deviceHotplugSource,
    /notifyAudioDeviceOptionsChanged\(\s*'platform-device-change:wm-devicechange'\s*\)/
  )
  assert.match(windowSource, /installAudioDeviceHotplugWatcher\(runtime\.mainWindow\)/)
})

test('audio hotplug watcher listens for ALSA hw device node changes on Linux', () => {
  assert.match(deviceHotplugSource, /const ALSA_DEVICE_DIR = '\/dev\/snd'/)
  assert.match(deviceHotplugSource, /const ALSA_DEVICE_WATCH_RETRY_MS = 5000/)
  assert.match(deviceHotplugSource, /process\.platform === 'linux'/)
  assert.match(deviceHotplugSource, /installAlsaDeviceHotplugWatcher\(\)/)
  assert.match(deviceHotplugSource, /watch\(ALSA_DEVICE_DIR, \{ persistent: false \}/)
  assert.match(deviceHotplugSource, /scheduleAlsaDeviceWatchRetry\(\)/)
  assert.match(deviceHotplugSource, /watcher\.on\('error'/)
  assert.match(deviceHotplugSource, /watcher\.on\('close'/)
  assert.match(deviceHotplugSource, /alsaWatchRetryTimer\.unref\?\.\(\)/)
  assert.match(
    deviceHotplugSource,
    /notifyAudioDeviceOptionsChanged\(\s*'platform-device-change:alsa-dev-snd'\s*\)/
  )
})
