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
import { resolveProviderIdempotencyKey } from './rpcCoordinator.ts'
import type { TwilightMediaProviderRegistration, TwilightPluginDescriptor } from './types.ts'

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
  listProviders(): TwilightMediaProviderRegistration[]
  callProvider(providerId: string, method: 'checkLogin', args: unknown[]): Promise<unknown>
}

function createWakeHarness(): {
  manager: WakeTestManager
  child: EventEmitter
  started: Promise<void>
  forkCount: () => number
  calls: string[]
} {
  let resolveStarted!: () => void
  const started = new Promise<void>((done) => {
    resolveStarted = done
  })
  const calls: string[] = []
  let forks = 0
  const child = Object.assign(new EventEmitter(), {
    postMessage(message: { kind: string; method?: string; requestId?: string }): void {
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
      Error,
      resolve,
      randomUUID,
      dedupeProviderRegistrations,
      findProviderRoute,
      getProviderCallTimeoutMs,
      getProviderMethodStats,
      resolveProviderIdempotencyKey,
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
              capabilities: ['login'],
              supportedMethods: ['checkLogin']
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
  return { manager, child, started, forkCount: () => forks, calls }
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
