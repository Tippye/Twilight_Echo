import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { PluginOperationQueue } from './operationQueue.ts'
import {
  dedupeProviderRegistrations,
  findProviderRoute,
  getProviderCallTimeoutMs,
  getProviderMethodStats
} from './providerRouting.ts'
import {
  PluginRpcCoordinator,
  PluginRpcLifecycleError,
  resolveProviderIdempotencyKey
} from './rpcCoordinator.ts'
import { ipcError, parseAppError } from '../../shared/errors/appError.ts'
import { translate } from '../../shared/i18n/translate.ts'
import { ProviderPlaybackIdentityRegistry } from '../audio/providerPlaybackIdentity.ts'
import type {
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration,
  TwilightPluginDescriptor
} from './types.ts'

const source = readFileSync(new URL('./manager.ts', import.meta.url), 'utf8').replaceAll(
  '\r\n',
  '\n'
)
const classStart = source.indexOf('export class TwilightPluginManager')
const classSource = source.slice(classStart, source.indexOf('\n}\n', classStart) + 3)
const pluginId = 'com.twilightecho.provider.ncm'

type Snapshot = {
  descriptor: TwilightPluginDescriptor
  providers: TwilightMediaProviderRegistration[]
}

interface WakeTestManager {
  running: Map<string, Snapshot>
  hibernated: Map<string, Snapshot>
  wakeOperations: Map<string, Promise<Snapshot>>
  state: Record<string, { enabled: boolean }>
  rpcCalls: PluginRpcCoordinator
  listProviders(): TwilightMediaProviderRegistration[]
  callProvider(
    providerId: string,
    method: TwilightMediaProviderMethod,
    args: unknown[],
    options?: { signal?: AbortSignal }
  ): Promise<unknown>
}

type HostCall = { kind: string; method?: string; requestId?: string }

function createWakeHarness(): {
  manager: WakeTestManager
  child: EventEmitter & { postMessage(message: HostCall): void }
  started: Promise<void>
  forkCount: () => number
  calls: string[]
  messages: HostCall[]
} {
  let resolveStarted!: () => void
  const started = new Promise<void>((done) => {
    resolveStarted = done
  })
  const calls: string[] = []
  const messages: HostCall[] = []
  let forks = 0
  const child = Object.assign(new EventEmitter(), {
    postMessage(message: HostCall): void {
      messages.push(message)
      if (message.kind === 'activate') resolveStarted()
      if (message.kind === 'provider-call') calls.push(message.method!)
      if (message.kind === 'deactivate') {
        queueMicrotask(() => child.emit('message', { ...message, kind: 'deactivated' }))
      }
    },
    kill(): void {
      queueMicrotask(() => child.emit('exit', 0))
    }
  })
  const Manager = runInNewContext(
    `${stripTypeScriptTypes(classSource.replace('export class', 'class'))}\nTwilightPluginManager`,
    {
      EventEmitter,
      AbortController,
      AbortSignal,
      Error,
      resolve,
      randomUUID,
      dedupeProviderRegistrations,
      findProviderRoute,
      getProviderCallTimeoutMs,
      getProviderMethodStats,
      resolveProviderIdempotencyKey,
      PluginRpcLifecycleError,
      providerPlaybackIdentities: new ProviderPlaybackIdentityRegistry(),
      ipcError,
      mt: (key: string) => translate('zh-CN', key),
      isCompatibleTwilightRange: () => true,
      resolvePluginFile: (path: string) => path,
      mkdirSync: () => undefined,
      toManifest: (descriptor: TwilightPluginDescriptor) => descriptor,
      setTimeout,
      clearTimeout,
      PLUGIN_ACTIVATE_TIMEOUT_MS: 5000,
      PLUGIN_DEACTIVATE_TIMEOUT_MS: 1500,
      QISHUI_PLUGIN_ID: 'com.twilightecho.provider.qishui',
      QQMUSIC_PLUGIN_ID: 'com.twilightecho.provider.qqmusic',
      utilityProcess: {
        fork: () => {
          forks++
          return child
        }
      }
    }
  ) as { prototype: WakeTestManager }
  const descriptor = {
    id: pluginId,
    enabled: true,
    status: 'enabled',
    main: 'index.mjs',
    engines: { twilightEcho: '*' },
    paths: { versionRoot: '/test/plugin', dataDir: '/test/data' }
  } as TwilightPluginDescriptor
  const manager = Object.assign(Object.create(Manager.prototype) as WakeTestManager, {
    running: new Map(),
    hibernated: new Map<string, Snapshot>([
      [
        pluginId,
        {
          descriptor,
          providers: [
            {
              id: 'ncm',
              name: 'Cached NCM',
              capabilities: ['login', 'playbackUrl', 'search'],
              supportedMethods: ['checkLogin', 'getPlaybackUrl', 'searchSongs']
            }
          ]
        }
      ]
    ]),
    wakeOperations: new Map(),
    stopOperations: new Map(),
    hibernating: new Set(),
    internalNcmRequests: new Map(),
    providerHealth: new Map(),
    contributionsCache: {},
    state: { [pluginId]: { enabled: true } },
    hostIdle: null,
    bundledPlugins: [{ id: pluginId }],
    pluginOperationQueue: new PluginOperationQueue(),
    rpcCalls: {
      request: async (request: { dispatch: () => void }) => {
        request.dispatch()
        return { loggedIn: true }
      },
      cancelPlugin: () => undefined
    },
    findDescriptor: async () => descriptor,
    appendLog: () => undefined,
    queueStateSave: () => undefined,
    handleHostMessage: () => undefined
  })
  return { manager, child, started, forkCount: () => forks, calls, messages }
}

test('cached startup providers stay visible and concurrent calls wait for wake activation', async () => {
  const { manager, child, started, forkCount, calls } = createWakeHarness()
  const first = manager.callProvider('ncm', 'checkLogin', [])
  await started
  const duringWake = manager.listProviders()
  const second = manager.callProvider('ncm', 'checkLogin', [])
  const settled = Promise.allSettled([first, second])
  await new Promise<void>((done) => setImmediate(done))
  const callsBeforeActivation = [...calls]
  const running = manager.running.get(pluginId)!
  running.providers = [
    { id: 'ncm', name: 'Fresh NCM', capabilities: ['login'], supportedMethods: ['checkLogin'] }
  ]
  const duringRegistration = manager.listProviders()
  const third = manager.callProvider('ncm', 'checkLogin', [])
  await new Promise<void>((done) => setImmediate(done))
  const callsDuringRegistration = [...calls]
  child.emit('message', { kind: 'activated', pluginId })
  const results = [...(await settled), ...(await Promise.allSettled([third]))]

  assert.equal(duringWake.length, 1, 'startup health queries must retain cached providers')
  assert.equal(duringWake[0].health?.available, true)
  assert.equal(
    duringRegistration[0].name,
    'Cached NCM',
    'publish fresh registrations after activation'
  )
  assert.deepEqual(callsBeforeActivation, [], 'no RPC can reach an activating host')
  assert.deepEqual(callsDuringRegistration, [], 'registered methods must still wait for activation')
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'fulfilled', 'fulfilled']
  )
  assert.equal(forkCount(), 1)
  assert.deepEqual(calls, ['checkLogin', 'checkLogin', 'checkLogin'])
  assert.equal(manager.hibernated.has(pluginId), false)
  assert.equal(manager.wakeOperations.size, 0)
  assert.equal(manager.listProviders().length, 1)
  assert.equal(manager.listProviders()[0].name, 'Fresh NCM')
})

test('wake activation failure rejects all waiters and removes cached contributions', async () => {
  const { manager, child, started, forkCount, calls } = createWakeHarness()
  const first = manager.callProvider('ncm', 'checkLogin', [])
  await started
  const second = manager.callProvider('ncm', 'checkLogin', [])
  const settled = Promise.allSettled([first, second])
  await new Promise<void>((done) => setImmediate(done))
  child.emit('message', { kind: 'host-error', message: 'activation failed' })
  const results = await settled

  assert.equal(forkCount(), 1)
  assert.deepEqual(calls, [])
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.match(result.reason.message, /activation failed/)
  }
  assert.equal(manager.hibernated.has(pluginId), false)
  assert.equal(manager.running.has(pluginId), false)
  assert.equal(manager.wakeOperations.size, 0)
  assert.equal(manager.state[pluginId].enabled, true, 'retain user intent for the next startup')
  assert.equal(manager.listProviders().length, 0)
})

test('disabled providers are not woken by a provider call', async () => {
  const { manager, forkCount, calls } = createWakeHarness()
  manager.hibernated.clear()
  manager.state[pluginId].enabled = false

  await assert.rejects(manager.callProvider('ncm', 'checkLogin', []), /Provider 未启用/)
  assert.equal(forkCount(), 0)
  assert.deepEqual(calls, [])
})

async function activeRpcHarness(
  options: ConstructorParameters<typeof PluginRpcCoordinator>[0] = {}
) {
  const f = createWakeHarness()
  const warming = f.manager.callProvider('ncm', 'checkLogin', [])
  await f.started
  f.manager.running.get(pluginId)!.providers = f.manager.hibernated.get(pluginId)!.providers
  f.child.emit('message', { kind: 'activated', pluginId })
  await warming
  const coordinator = new PluginRpcCoordinator(options)
  f.manager.rpcCalls = coordinator
  f.messages.length = 0
  return { ...f, coordinator }
}

function terminalPlaybackFailure(kind: PluginRpcLifecycleError['kind']) {
  return (error: unknown): boolean => {
    const parsed = parseAppError(error)
    assert.equal(parsed.code, 'provider.playbackUnavailable')
    assert.equal(parsed.params.reason, translate('zh-CN', `error.provider.playbackRpc.${kind}`))
    assert.doesNotMatch(String(parsed.params.reason), /private|https?:|Plugin /)
    return true
  }
}

test('real playback RPC timeout becomes terminal before a cancelled utility can reply', async (t) => {
  const f = await activeRpcHarness()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = f.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }])
  const rejected = assert.rejects(pending, terminalPlaybackFailure('timeout'))
  await new Promise<void>((done) => setImmediate(done))
  const sent = f.messages.find((message) => message.kind === 'provider-call')
  assert.ok(sent?.requestId)
  assert.equal(getProviderCallTimeoutMs('getPlaybackUrl'), 30_000)
  t.mock.timers.tick(30_000)
  await rejected
  assert.equal(f.messages.filter((message) => message.kind === 'cancel').length, 1)
  assert.equal(f.coordinator.getPendingCount(pluginId), 0)
  assert.equal(
    f.coordinator.complete(pluginId, sent.requestId, { ok: true, value: 'late playback URL' })
      .status,
    'late'
  )
})

test('playback queued timeout is terminal without dispatch or cancellation of unsent work', async (t) => {
  const f = await activeRpcHarness({ maxConcurrencyPerPlugin: 1 })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const blocker = f.coordinator.request({
    requestId: 'blocker',
    pluginId,
    kind: 'provider',
    timeoutMs: 60_000,
    metadata: {},
    dispatch: () => {}
  })
  const pending = f.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }])
  const rejected = assert.rejects(pending, terminalPlaybackFailure('timeout'))
  await new Promise<void>((done) => setImmediate(done))
  assert.equal(f.coordinator.getPendingCount(pluginId), 2)
  t.mock.timers.tick(30_000)
  await rejected
  assert.deepEqual(f.messages, [])
  f.coordinator.complete(pluginId, 'blocker', { ok: true, value: true })
  await blocker
  assert.equal(f.coordinator.getPendingCount(pluginId), 0)
})

test('playback cancellation and host stop are terminal with safe reasons and inert late ACKs', async () => {
  for (const cause of ['cancelled', 'host-stopped'] as const) {
    const f = await activeRpcHarness()
    const controller = new AbortController()
    const pending = f.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }], {
      signal: controller.signal
    })
    const rejected = assert.rejects(pending, terminalPlaybackFailure(cause))
    await new Promise<void>((done) => setImmediate(done))
    const sent = f.messages.find((message) => message.kind === 'provider-call')
    assert.ok(sent?.requestId)
    if (cause === 'cancelled') controller.abort(new Error('private cancellation reason'))
    else f.coordinator.cancelPlugin(pluginId, 'private host stopped reason')
    await rejected
    assert.equal(f.coordinator.getPendingCount(pluginId), 0)
    assert.equal(
      f.coordinator.complete(pluginId, sent.requestId, { ok: true, value: 'late' }).status,
      'late'
    )
  }
})

test('playback dispatch failure is terminal while invalid provider and method errors remain validation', async () => {
  const f = await activeRpcHarness()
  f.child.postMessage = () => {
    throw new Error('private postMessage failure')
  }
  await assert.rejects(
    f.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }]),
    terminalPlaybackFailure('dispatch')
  )
  for (const [provider, unsupported] of [
    ['unknown', false],
    ['ncm', true]
  ] as const) {
    if (unsupported) f.manager.running.get(pluginId)!.providers[0].supportedMethods = ['checkLogin']
    await assert.rejects(
      f.manager.callProvider(provider, 'getPlaybackUrl', []),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error instanceof PluginRpcLifecycleError, false)
        assert.equal(parseAppError(error).code, null)
        assert.match(error.message, unsupported ? /does not implement/ : /Provider 未启用/)
        return true
      }
    )
  }
})

test('playback wake failure is terminal before RPC but ordinary remote business errors stay unchanged', async () => {
  const sleeping = createWakeHarness()
  const waking = sleeping.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }])
  const rejected = assert.rejects(waking, terminalPlaybackFailure('host-stopped'))
  await sleeping.started
  sleeping.child.emit('message', { kind: 'host-error', message: 'private activation failure' })
  await rejected
  assert.deepEqual(sleeping.calls, [])

  const f = await activeRpcHarness()
  for (const message of [
    'Remote business rejected quality with HTTP 403',
    ipcError('provider.playbackUnavailable', 'Remote business rejection', {
      reason: 'Provider already exhausted the current track'
    }).message
  ]) {
    const pending = f.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }])
    const rejected = assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error instanceof PluginRpcLifecycleError, false)
      assert.equal(error.message, message)
      return true
    })
    await new Promise<void>((done) => setImmediate(done))
    const sent = f.messages.filter((item) => item.kind === 'provider-call').at(-1)
    assert.ok(sent?.requestId)
    f.coordinator.complete(pluginId, sent.requestId, { ok: false, error: message })
    await rejected
  }
})

test('non-playback methods retain lifecycle failure messages instead of receiving a playback terminal', async () => {
  const f = await activeRpcHarness()
  const pending = f.manager.callProvider('ncm', 'searchSongs', ['public'])
  const rejected = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof PluginRpcLifecycleError)
    assert.equal(error.kind, 'host-stopped')
    assert.equal(error.message, 'host stopped before search completed')
    assert.equal(parseAppError(error).code, null)
    return true
  })
  await new Promise<void>((done) => setImmediate(done))
  f.coordinator.cancelPlugin(pluginId, 'host stopped before search completed')
  await rejected
})

test('playback circuit rejection and bounded-queue overload produce terminal fixed reasons', async () => {
  const circuit = await activeRpcHarness({ circuitFailureThreshold: 1 })
  const failing = circuit.coordinator.request({
    requestId: 'trip-circuit',
    pluginId,
    kind: 'provider',
    timeoutMs: 1000,
    metadata: {},
    dispatch: () => {}
  })
  const failed = assert.rejects(failing, /remote business failure/)
  circuit.coordinator.complete(pluginId, 'trip-circuit', {
    ok: false,
    error: 'remote business failure'
  })
  await failed
  await assert.rejects(
    circuit.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }]),
    terminalPlaybackFailure('circuit')
  )
  assert.deepEqual(circuit.messages, [])

  const overload = await activeRpcHarness({ maxConcurrencyPerPlugin: 1, maxQueuePerPlugin: 1 })
  const blockers = ['active-blocker', 'queued-blocker'].map((requestId) =>
    overload.coordinator.request({
      requestId,
      pluginId,
      kind: 'provider',
      timeoutMs: 1000,
      metadata: {},
      dispatch: () => {}
    })
  )
  await assert.rejects(
    overload.manager.callProvider('ncm', 'getPlaybackUrl', [{ id: 'ncm:public' }]),
    terminalPlaybackFailure('overload')
  )
  assert.deepEqual(overload.messages, [])
  overload.coordinator.complete(pluginId, 'active-blocker', { ok: true, value: true })
  overload.coordinator.complete(pluginId, 'queued-blocker', { ok: true, value: true })
  await Promise.all(blockers)
  assert.equal(overload.coordinator.getPendingCount(pluginId), 0)
})
