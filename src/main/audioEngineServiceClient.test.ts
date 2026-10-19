import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { AudioEngineServiceBinding } from './audioEngineServiceClient.ts'
import { AudioAnalysisServiceClient } from './audioAnalysisServiceClient.ts'
import { createAudioServiceCapabilities } from '../shared/audioServiceContract.ts'
import type { DspGraphStatus } from '../shared/dspGraph.ts'

class SilentUtilityProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killCount = 0
  postMessage(): void {}
  kill(): void {
    this.killCount += 1
    this.emit('exit', 0)
  }
}

class ManualUtilityProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  messages: unknown[] = []
  killCount = 0
  postMessage(message: unknown): void {
    this.messages.push(message)
  }
  kill(): void {
    this.killCount += 1
    this.emit('exit', 0)
  }
}

class ThrowingUtilityProcess extends ManualUtilityProcess {
  override postMessage(): void {
    throw new Error('utility pipe closed')
  }
}

function markAnalysisWorkerReady(child: ManualUtilityProcess): void {
  child.emit('message', {
    kind: 'ready',
    protocolVersion: 1,
    analyses: ['bpm', 'loudness']
  })
}

function startAudioServiceForTest(binding: AudioEngineServiceBinding): void {
  ;(binding as unknown as { start: () => void }).start()
}

test('audio services fork only on their first operation', async () => {
  const audioChildren: ManualUtilityProcess[] = []
  const analysisChildren: ManualUtilityProcess[] = []
  const playback = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          audioChildren.push(child)
          return child
        }
      }
    }
  })
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          analysisChildren.push(child)
          return child
        }
      }
    }
  })

  assert.equal(audioChildren.length, 0)
  assert.equal(analysisChildren.length, 0)

  const pendingPlayback = playback.callAsync('GetPlaybackInfo', [])
  assert.equal(audioChildren.length, 1)
  audioChildren[0].emit('message', {
    kind: 'response',
    requestId: (audioChildren[0].messages[0] as { requestId: string }).requestId,
    ok: true,
    value: '{"state":"stopped"}'
  })
  await pendingPlayback

  const pendingAnalysis = analysis.analyzeBpm('first-request.flac', '{}')
  assert.equal(analysisChildren.length, 1)
  markAnalysisWorkerReady(analysisChildren[0])
  respondWithBpm(analysisChildren[0], 0, 120)
  assert.equal((await pendingAnalysis).bpm, 120)

  playback.destroy()
  analysis.destroy()
})

test('audio analysis rejects its first request when utilityProcess is unavailable', async () => {
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    electron: {}
  })
  await assert.rejects(
    analysis.analyzeBpm('unavailable.flac', '{}'),
    /current runtime does not support Electron utilityProcess/
  )
  analysis.destroy()
})
test('real AudioEngineServiceBinding applies one DSP state transaction and confirms the native revision ACK', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  startAudioServiceForTest(binding)
  child.emit('message', {
    kind: 'ready',
    capabilities: createAudioServiceCapabilities(['ApplyDspState', 'GetDspGraphStatus'])
  })

  try {
    assert.equal(typeof binding.ApplyDspState, 'function')
    assert.equal(typeof binding.GetDspGraphStatus, 'function')
    const payload = {
      revision: 7,
      processing: { eqEnabled: true, eqPreamp: 1.5 },
      sceneId: 'studio',
      graph: {
        version: 2,
        nodes: [{ id: 'width', type: 'stereoField', enabled: true, params: { width: 1.2 } }],
        outputStage: { targetSampleRate: 96000, resamplerQuality: 'ultra', dither: 'tpdf' }
      }
    }
    const applied = binding.applyDspState(7, payload)

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal((child.messages[0] as { method: string }).method, 'ApplyDspState')
    const setRequest = child.messages[0] as { requestId: string; args: [number, string] }
    assert.equal(setRequest.args[0], 7)
    assert.equal(JSON.parse(setRequest.args[1]).processing.eqPreamp, 1.5)
    child.emit('message', {
      kind: 'response',
      requestId: setRequest.requestId,
      ok: true,
      value: undefined
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal((child.messages[1] as { method: string }).method, 'GetDspGraphStatus')
    child.emit('message', {
      kind: 'response',
      requestId: (child.messages[1] as { requestId: string }).requestId,
      ok: true,
      value: JSON.stringify({
        revision: 7,
        activeSceneId: 'studio',
        totalLatencyFrames: 32,
        totalTailFrames: 0,
        compileState: 'ready',
        nodes: [{ id: 'width', type: 'stereoField', enabled: true, active: true }]
      })
    })

    const status = await applied
    assert.equal(status.revision, 7)
    assert.equal(status.requestedRevision, 7)
    assert.equal(status.appliedRevision, 7)
    assert.equal(status.applyState, 'applied')

    binding.ApplyDspState(
      8,
      JSON.stringify({
        revision: 8,
        processing: { eqEnabled: false },
        sceneId: 'studio',
        graph: { nodes: [] }
      })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const directSetRequest = child.messages[2] as { requestId: string; method: string }
    assert.equal(directSetRequest.method, 'ApplyDspState')
    child.emit('message', {
      kind: 'response',
      requestId: directSetRequest.requestId,
      ok: true,
      value: undefined
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const directStatusRequest = child.messages[3] as { requestId: string; method: string }
    assert.equal(directStatusRequest.method, 'GetDspGraphStatus')
    child.emit('message', {
      kind: 'response',
      requestId: directStatusRequest.requestId,
      ok: true,
      value: JSON.stringify({
        revision: 8,
        activeSceneId: 'studio',
        totalLatencyFrames: 0,
        totalTailFrames: 0,
        nodes: []
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal((binding.GetDspGraphStatus() as { revision: number }).revision, 8)
  } finally {
    binding.destroy()
  }
})

test('1000 DSP slider updates merge by field into one latest-revision transaction', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  startAudioServiceForTest(binding)
  child.emit('message', {
    kind: 'ready',
    capabilities: createAudioServiceCapabilities(['ApplyDspState', 'GetDspGraphStatus'])
  })

  try {
    const updates: Array<Promise<unknown>> = []
    for (let revision = 1; revision <= 1000; revision += 1) {
      updates.push(
        binding.applyDspState(revision, {
          revision,
          processing:
            revision % 2 === 0
              ? { eqPreamp: revision / 100 }
              : { crossfeedStrength: revision / 1000 },
          sceneId: 'slider-stress',
          graph: {
            version: 2,
            nodes: [
              {
                id: 'balance',
                type: 'stereoField',
                enabled: true,
                params: { balance: revision / 1000 }
              }
            ]
          }
        })
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(child.messages.length, 1)
    const applyRequest = child.messages[0] as {
      requestId: string
      method: string
      args: [number, string]
    }
    assert.equal(applyRequest.method, 'ApplyDspState')
    assert.equal(applyRequest.args[0], 1000)
    const merged = JSON.parse(applyRequest.args[1]) as {
      revision: number
      processing: { eqPreamp?: number; crossfeedStrength?: number }
      graph: { nodes: Array<{ params: { balance: number } }> }
    }
    assert.equal(merged.revision, 1000)
    assert.equal(merged.processing.eqPreamp, 10)
    assert.equal(merged.processing.crossfeedStrength, 0.999)
    assert.equal(merged.graph.nodes[0].params.balance, 1)

    child.emit('message', {
      kind: 'response',
      requestId: applyRequest.requestId,
      ok: true,
      value: undefined
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(child.messages.length, 2)
    const statusRequest = child.messages[1] as { requestId: string; method: string }
    assert.equal(statusRequest.method, 'GetDspGraphStatus')
    child.emit('message', {
      kind: 'response',
      requestId: statusRequest.requestId,
      ok: true,
      value: JSON.stringify({
        revision: 1000,
        activeSceneId: 'slider-stress',
        totalLatencyFrames: 0,
        totalTailFrames: 0,
        nodes: []
      })
    })

    const statuses = await Promise.all(updates)
    assert.equal(statuses.length, 1000)
    assert.equal(child.messages.length, 2)
    assert.equal((binding.GetDspGraphStatus() as DspGraphStatus).revision, 1000)
  } finally {
    binding.destroy()
  }
})

test('queued DSP graph patches retain other nodes and merge each node params by id', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  startAudioServiceForTest(binding)
  child.emit('message', {
    kind: 'ready',
    capabilities: createAudioServiceCapabilities(['ApplyDspState', 'GetDspGraphStatus'])
  })

  try {
    const baseline = binding.applyDspState(1, {
      revision: 1,
      graphUpdateMode: 'replace',
      processing: { eqEnabled: true, crossfeedEnabled: true },
      sceneId: 'multi-node-slider-stress',
      graph: {
        version: 2,
        nodes: [
          {
            id: 'eq',
            type: 'equalizer',
            enabled: true,
            params: { preamp: 1, bandGain: 2 }
          },
          {
            id: 'stereo',
            type: 'stereoField',
            enabled: true,
            params: { balance: 0, width: 1 }
          }
        ],
        outputStage: { targetSampleRate: 96000, dither: 'tpdf' }
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const baselineRequest = child.messages[0] as { requestId: string }
    child.emit('message', { kind: 'response', requestId: baselineRequest.requestId, ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const baselineStatus = child.messages[1] as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: baselineStatus.requestId,
      ok: true,
      value: JSON.stringify({
        revision: 1,
        activeSceneId: 'multi-node-slider-stress',
        totalLatencyFrames: 0,
        totalTailFrames: 0,
        nodes: []
      })
    })
    await baseline

    const balanceUpdate = binding.applyDspState(2, {
      revision: 2,
      processing: { crossfeedStrength: 0.35 },
      sceneId: 'multi-node-slider-stress',
      graph: { nodes: [{ id: 'stereo', params: { balance: 0.35 } }] }
    })
    const eqUpdate = binding.applyDspState(3, {
      revision: 3,
      processing: { eqPreamp: 4 },
      sceneId: 'multi-node-slider-stress',
      graph: {
        nodes: [
          { id: 'eq', params: { bandGain: 5 } },
          { id: 'stereo', params: { width: 1.35 } }
        ],
        outputStage: { dither: 'noiseShaped' }
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const patchRequest = child.messages[2] as {
      requestId: string
      method: string
      args: [number, string]
    }
    assert.equal(patchRequest.method, 'ApplyDspState')
    assert.equal(patchRequest.args[0], 3)
    const merged = JSON.parse(patchRequest.args[1]) as {
      processing: Record<string, unknown>
      graph: {
        nodes: Array<{ id: string; enabled?: boolean; params: Record<string, unknown> }>
        outputStage: Record<string, unknown>
      }
    }
    assert.deepEqual(merged.processing, {
      eqEnabled: true,
      crossfeedEnabled: true,
      crossfeedStrength: 0.35,
      eqPreamp: 4
    })
    assert.deepEqual(merged.graph.nodes, [
      {
        id: 'eq',
        type: 'equalizer',
        enabled: true,
        params: { preamp: 1, bandGain: 5 }
      },
      {
        id: 'stereo',
        type: 'stereoField',
        enabled: true,
        params: { balance: 0.35, width: 1.35 }
      }
    ])
    assert.deepEqual(merged.graph.outputStage, { targetSampleRate: 96000, dither: 'noiseShaped' })

    child.emit('message', { kind: 'response', requestId: patchRequest.requestId, ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const patchStatus = child.messages[3] as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: patchStatus.requestId,
      ok: true,
      value: JSON.stringify({
        revision: 3,
        activeSceneId: 'multi-node-slider-stress',
        totalLatencyFrames: 0,
        totalTailFrames: 0,
        nodes: []
      })
    })
    await Promise.all([balanceUpdate, eqUpdate])

    const clearGraph = binding.applyDspState(4, {
      revision: 4,
      graphUpdateMode: 'replace',
      processing: { eqEnabled: false, crossfeedEnabled: false },
      sceneId: 'multi-node-slider-stress',
      graph: {
        version: 2,
        nodes: [],
        outputStage: { targetSampleRate: 48000 }
      }
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const clearRequest = child.messages[4] as {
      requestId: string
      args: [number, string]
    }
    const cleared = JSON.parse(clearRequest.args[1]) as {
      graphUpdateMode?: string
      graph: { nodes: unknown[] }
    }
    assert.equal(cleared.graphUpdateMode, 'replace')
    assert.deepEqual(cleared.graph.nodes, [])
    child.emit('message', {
      kind: 'response',
      requestId: clearRequest.requestId,
      ok: true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const clearStatus = child.messages[5] as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: clearStatus.requestId,
      ok: true,
      value: JSON.stringify({
        revision: 4,
        activeSceneId: 'multi-node-slider-stress',
        totalLatencyFrames: 0,
        totalTailFrames: 0,
        nodes: []
      })
    })
    await clearGraph
  } finally {
    binding.destroy()
  }
})

test('audio service capability negotiation fails closed when revision ACK is unavailable', () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  let reason = ''
  binding.on('crash', (value: string) => {
    reason = value
  })

  binding.GetPlaybackInfo()
  child.emit('message', {
    kind: 'ready',
    capabilities: {
      protocolVersion: 2,
      methods: ['ApplyDspState'],
      dspGraphRevisionAck: false
    }
  })

  assert.equal(child.killCount, 1)
  assert.match(reason, /GetDspGraphStatus|revision ACK/)
  binding.destroy()
})

test('cached audio service calls swallow timeout rejections', async () => {
  const child = new SilentUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      restartDelayMs: 1000,
      electron
    })
    assert.equal(binding.EnumerateDevices(), '[]')
    assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(unhandled.length, 0)
    assert.match(binding.GetLastError(), /音频服务调用超时/)
    // Device enumeration is slow-tier: while it is legitimately in flight, the
    // fast-tier playback-info timeout must be treated as collateral blocking,
    // not as a wedged child. No kill.
    assert.equal(child.killCount, 0)
    binding.destroy()
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('timed out audio service RPC terminates and restarts the unresponsive generation once', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    restartDelayMs: 5,
    electron
  })
  const crashes: string[] = []
  binding.on('crash', (reason: string) => crashes.push(reason))

  try {
    // A fast-tier status RPC: with no slow-tier request in flight, a timeout
    // here is genuine evidence of a wedged child and must recover the service.
    await assert.rejects(() => binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.equal(children[0].killCount, 1)
    assert.equal(children.length, 2)
    assert.equal(crashes.length, 1)
    assert.match(crashes[0], /GetPlaybackInfo/)
  } finally {
    binding.destroy()
  }
})

test('slow-tier native RPCs time out without killing the audio service', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    restartDelayMs: 5,
    electron
  })

  try {
    // GetMetadata runs a synchronous FFmpeg probe on the service's JS thread;
    // it may legally outlive the control deadline and must not trigger the
    // unresponsive-service kill.
    await assert.rejects(() => binding.getMetadataAsync('slow-probe.flac'), /音频服务调用超时/)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(children[0].killCount, 0)
    assert.equal(children.length, 1)
  } finally {
    binding.destroy()
  }
})

test('native completion grace rejects invalid timer bounds', () => {
  for (const nativeCompletionGraceMs of [0, -1, 1.5, Number.NaN, Infinity, 0x80000000]) {
    assert.throws(
      () => new AudioEngineServiceBinding({ serviceEntry: 'unused.js', nativeCompletionGraceMs }),
      /bounded positive integer/
    )
  }
})

async function confirmPauseState(
  binding: AudioEngineServiceBinding,
  child: ManualUtilityProcess,
  value: unknown
): Promise<void> {
  const read = binding.callAsync('GetPlaybackInfo', [])
  const request = child.messages.at(-1) as { requestId: string }
  child.emit('message', { kind: 'response', requestId: request.requestId, ok: true, value })
  await read
}

const freshSharedPauseState = {
  state: 'paused',
  outputInfo: {
    outputReleased: false,
    exclusive: false,
    accessMode: 'shared',
    actualBackend: 'wasapi'
  }
}

test('Pause with unknown released or exclusive output uses the existing slow admission tier', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const value of [
    undefined,
    'malformed JSON',
    '{"state":"paused"}',
    { state: 'paused', outputInfo: { outputReleased: true } },
    {
      state: 'playing',
      outputInfo: { outputReleased: false, exclusive: true, accessMode: 'exclusive' }
    },
    {
      state: 'paused',
      outputInfo: { outputReleased: false, exclusive: false, accessMode: 'unknown' }
    }
  ]) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      topologyRequestTimeoutMs: 20,
      nativeCompletionGraceMs: 30,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      if (value !== undefined) await confirmPauseState(binding, child, value)
      let settled = false
      const pause = binding.callAsync('Pause', []).finally(() => {
        settled = true
      })
      const rejected = assert.rejects(pause, /音频服务调用超时/)
      t.mock.timers.tick(5)
      await Promise.resolve()
      assert.equal(settled, false, 'Unknown/reopening Pause must not use the fast caller deadline')
      assert.equal(child.killCount, 0)
      t.mock.timers.tick(15)
      await rejected
      assert.equal(child.killCount, 0)
    } finally {
      binding.destroy()
    }
  }
})

test('Pause with fresh authoritative stopped or paused shared output retains the fast watchdog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const value of ['{"state":"stopped"}', freshSharedPauseState]) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      topologyRequestTimeoutMs: 20,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      await confirmPauseState(binding, child, value)
      const rejected = assert.rejects(binding.callAsync('Pause', []), /音频服务调用超时/)
      t.mock.timers.tick(5)
      await rejected
      assert.equal(
        child.killCount,
        1,
        'Known ordinary Pause must keep the fast unresponsive-child check'
      )
    } finally {
      binding.destroy()
    }
  }
})

test('Pause cannot infer a fast path from playing shared output across autonomous native queue advancement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    await confirmPauseState(binding, child, { ...freshSharedPauseState, state: 'playing' })
    // The native clock may auto-advance into a DSD/exclusive route without an
    // IPC mutation. An earlier Playing/shared read cannot fence that change.
    const pause = binding.callAsync('Pause', [])
    void pause.catch(() => {})
    const request = child.messages.at(-1) as { requestId: string }
    t.mock.timers.tick(5)
    assert.equal(child.killCount, 0)
    child.emit('message', { kind: 'response', requestId: request.requestId, ok: true })
    await pause
  } finally {
    binding.destroy()
  }
})

test('Pause mutation invalidates its prior ordinary observation without clearing the presentation cache', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    await confirmPauseState(binding, child, freshSharedPauseState)
    const first = binding.callAsync('Pause', [])
    const firstRequest = child.messages.at(-1) as { requestId: string }
    child.emit('message', { kind: 'response', requestId: firstRequest.requestId, ok: true })
    await first
    const pause = binding.callAsync('Pause', [])
    void pause.catch(() => {})
    const request = child.messages.at(-1) as { requestId: string }
    t.mock.timers.tick(5)
    assert.equal(child.killCount, 0, 'A prior Pause ACK is not a fresh output-state readback')
    child.emit('message', { kind: 'response', requestId: request.requestId, ok: true })
    await pause
    assert.deepEqual(binding.GetPlaybackInfo(), freshSharedPauseState)
  } finally {
    binding.destroy()
  }
})

test('Pause cannot treat old or overlapping playback readback as fresh after a state-mutator admission', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const readBeforeMutation of [true, false]) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      topologyRequestTimeoutMs: 20,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      await confirmPauseState(binding, child, freshSharedPauseState)
      let read: Promise<unknown> | undefined
      let readRequest: { requestId: string } | undefined
      if (readBeforeMutation) {
        read = binding.callAsync('GetPlaybackInfo', [])
        readRequest = child.messages.at(-1) as { requestId: string }
      }
      const mutation = binding.callAsync('SetOutputConfig', ['{"releaseExclusiveOnPause":true}'])
      const mutationRequest = child.messages.at(-1) as { requestId: string }
      if (!readBeforeMutation) {
        read = binding.callAsync('GetPlaybackInfo', [])
        readRequest = child.messages.at(-1) as { requestId: string }
      }
      child.emit('message', {
        kind: 'response',
        requestId: readRequest!.requestId,
        ok: true,
        value: freshSharedPauseState
      })
      await read
      child.emit('message', { kind: 'response', requestId: mutationRequest.requestId, ok: true })
      await mutation
      const pause = binding.callAsync('Pause', [])
      void pause.catch(() => {})
      const request = child.messages.at(-1) as { requestId: string }
      t.mock.timers.tick(5)
      assert.equal(child.killCount, 0, 'Old/overlapping readback cannot restore fast eligibility')
      child.emit('message', { kind: 'response', requestId: request.requestId, ok: true })
      await pause
      await confirmPauseState(binding, child, freshSharedPauseState)
      const ordinary = assert.rejects(binding.callAsync('Pause', []), /音频服务调用超时/)
      t.mock.timers.tick(5)
      await ordinary
      assert.equal(
        child.killCount,
        1,
        'A new non-overlapping native observation restores ordinary fast policy'
      )
    } finally {
      binding.destroy()
    }
  }
})

test('Pause slow ownership survives its caller timeout until late completion and keeps the grace bounded', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const completesLate of [true, false]) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      topologyRequestTimeoutMs: 20,
      nativeCompletionGraceMs: 30,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      await confirmPauseState(binding, child, {
        state: 'paused',
        outputInfo: { outputReleased: true }
      })
      let completed = false
      const pause = binding.callAsync('Pause', []).then(() => {
        completed = true
      })
      const rejected = assert.rejects(pause, /音频服务调用超时/)
      const request = child.messages.at(-1) as { requestId: string }
      t.mock.timers.tick(20)
      await rejected
      const polling = assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
      t.mock.timers.tick(5)
      await polling
      assert.equal(child.killCount, 0)
      if (completesLate) {
        child.emit('message', { kind: 'response', requestId: request.requestId, ok: true })
        await Promise.resolve()
        assert.equal(completed, false)
        const wedged = assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
        t.mock.timers.tick(5)
        await wedged
        assert.equal(child.killCount, 1)
      } else {
        t.mock.timers.tick(25)
        assert.equal(child.killCount, 1, 'Polling cannot renew the existing completion grace')
      }
    } finally {
      binding.destroy()
    }
  }
})

test('Pause behind a slow readonly predecessor keeps slow ownership without renewing that predecessor grace', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const predecessorCallerExpired of [false, true]) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'audioEngineService.js',
      requestTimeoutMs: 5,
      topologyRequestTimeoutMs: 20,
      nativeCompletionGraceMs: 30,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      await confirmPauseState(binding, child, freshSharedPauseState)
      const metadata = binding.getMetadataAsync('synthetic-slow-read.flac')
      void metadata.catch(() => {})
      const metadataRequest = child.messages.at(-1) as { requestId: string }
      if (predecessorCallerExpired) {
        const rejected = assert.rejects(metadata, /音频服务调用超时/)
        t.mock.timers.tick(20)
        await rejected
      }
      let settled = false
      const pause = binding.callAsync('Pause', []).finally(() => {
        settled = true
      })
      void pause.catch(() => {})
      const pauseRequest = child.messages.at(-1) as { requestId: string }
      t.mock.timers.tick(5)
      await Promise.resolve()
      assert.equal(
        settled,
        false,
        'Fresh shared state cannot bypass an outstanding slow readonly call'
      )
      assert.equal(child.killCount, 0)
      if (!predecessorCallerExpired) {
        child.emit('message', {
          kind: 'response',
          requestId: metadataRequest.requestId,
          ok: true,
          value: '{}'
        })
        await metadata
        child.emit('message', { kind: 'response', requestId: pauseRequest.requestId, ok: true })
        await pause
      } else {
        const polling = assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
        t.mock.timers.tick(5)
        await polling
        const rejected = assert.rejects(pause, /音频服务调用超时/)
        t.mock.timers.tick(10)
        await rejected
        assert.equal(child.killCount, 0)
        t.mock.timers.tick(10)
        assert.equal(
          child.killCount,
          1,
          'Predecessor original deadline20+grace30 remains authoritative'
        )
      }
    } finally {
      binding.destroy()
    }
  }
})

test('Pause policy uses the authoritative observation rather than an older presentation refresh callback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    binding.GetPlaybackInfo()
    const older = child.messages.at(-1) as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: older.requestId,
      ok: true,
      value: freshSharedPauseState
    })
    const newer = binding.callAsync('GetPlaybackInfo', [])
    const request = child.messages.at(-1) as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: { state: 'paused', outputInfo: { outputReleased: true } }
    })
    await newer
    const pause = binding.callAsync('Pause', [])
    void pause.catch(() => {})
    const pauseRequest = child.messages.at(-1) as { requestId: string }
    t.mock.timers.tick(5)
    assert.equal(
      child.killCount,
      0,
      'An older presentation callback cannot reclassify released output as ordinary'
    )
    child.emit('message', { kind: 'response', requestId: pauseRequest.requestId, ok: true })
    await pause
  } finally {
    binding.destroy()
  }
})

test('Pause output-state eligibility is invalidated across child exit and replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const children: ManualUtilityProcess[] = []
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })
  try {
    binding.GetPlaybackInfo()
    const first = children[0]
    const read = first.messages.at(-1) as { requestId: string }
    first.emit('message', {
      kind: 'response',
      requestId: read.requestId,
      ok: true,
      value: freshSharedPauseState
    })
    await Promise.resolve()
    first.emit('exit', 1)
    t.mock.timers.tick(1)
    const child = children[1]
    const pause = binding.callAsync('Pause', [])
    void pause.catch(() => {})
    const request = child.messages.at(-1) as { requestId: string }
    first.emit('message', {
      kind: 'response',
      requestId: read.requestId,
      ok: true,
      value: freshSharedPauseState
    })
    t.mock.timers.tick(5)
    assert.equal(
      child.killCount,
      0,
      'Synthetic stopped fallback/old child must not authorize a fast Pause'
    )
    child.emit('message', { kind: 'response', requestId: request.requestId, ok: true })
    await pause
  } finally {
    binding.destroy()
  }
})

test('slow native ownership survives caller timeout and late completion restores the ordinary watchdog', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    nativeCompletionGraceMs: 30,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    let completed = false
    const play = binding.callAsync('Play', ['slow-source.flac', 0]).then(() => {
      completed = true
    })
    const rejected = assert.rejects(play, /音频服务调用超时/)
    const request = child.messages[0] as { requestId: string }
    t.mock.timers.tick(20)
    await rejected
    for (let i = 0; i < 3; i++) {
      const polling = assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
      t.mock.timers.tick(5)
      await polling
      assert.equal(child.killCount, 0)
    }
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: undefined
    })
    await Promise.resolve()
    assert.equal(completed, false, 'Late completion must not revive the caller')
    const unresponsive = assert.rejects(
      binding.callAsync('GetPlaybackInfo', []),
      /音频服务调用超时/
    )
    t.mock.timers.tick(5)
    await unresponsive
    assert.equal(
      child.killCount,
      1,
      'Completed native work must stop protecting an unresponsive child'
    )
  } finally {
    binding.destroy()
  }
})

test('slow completion grace is bounded and repeated status polling cannot renew it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const children: ManualUtilityProcess[] = []
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    nativeCompletionGraceMs: 30,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })
  const crashes: string[] = []
  binding.on('crash', (reason) => crashes.push(reason))
  try {
    const rejected = assert.rejects(binding.callAsync('Play', ['held.flac', 0]), /音频服务调用超时/)
    t.mock.timers.tick(20)
    await rejected
    const oldRequest = children[0].messages[0] as { requestId: string }
    for (let i = 0; i < 5; i++) {
      const polling = assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
      t.mock.timers.tick(5)
      await polling
      assert.equal(children[0].killCount, 0)
    }
    t.mock.timers.tick(5)
    assert.equal(children[0].killCount, 1)
    assert.equal(crashes.length, 1)
    t.mock.timers.tick(1)
    assert.equal(children.length, 2)
    children[0].emit('message', {
      kind: 'response',
      requestId: oldRequest.requestId,
      ok: true,
      value: undefined
    })
    children[0].emit('exit', 1)
    assert.equal(children[1].killCount, 0)
    assert.equal(crashes.length, 1)
    const recovered = binding.callAsync('GetPlaybackInfo', [])
    const request = children[1].messages.at(-1) as { requestId: string }
    children[1].emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: '{"state":"paused"}'
    })
    assert.equal(await recovered, '{"state":"paused"}')
  } finally {
    binding.destroy()
  }
})

test('late slow completion clears its recovery timer and retains the original capacity bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    nativeCompletionGraceMs: 30,
    maxInFlightRequests: 1,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    const rejected = assert.rejects(binding.getMetadataAsync('slow.flac'), /音频服务调用超时/)
    const oldRequest = child.messages[0] as { requestId: string }
    t.mock.timers.tick(20)
    await rejected
    await assert.rejects(binding.callAsync('GetPlaybackInfo', []), /音频服务请求过多/)
    child.emit('message', {
      kind: 'response',
      requestId: oldRequest.requestId,
      ok: false,
      error: 'late native failure'
    })
    const fresh = binding.callAsync('GetPlaybackInfo', [])
    const request = child.messages.at(-1) as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: '{"state":"paused"}'
    })
    await fresh
    // Duplicate late replies cannot release ownership twice or poison caches.
    child.emit('message', {
      kind: 'response',
      requestId: oldRequest.requestId,
      ok: true,
      value: '{"state":"playing"}'
    })
    t.mock.timers.tick(30)
    assert.equal(child.killCount, 0)
    assert.equal(binding.GetPlaybackInfo(), '{"state":"paused"}')
  } finally {
    binding.destroy()
  }
})

test('exit and destroy retire outstanding slow completion timers before a replacement generation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const children: ManualUtilityProcess[] = []
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 20,
    nativeCompletionGraceMs: 30,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })
  try {
    const rejected = assert.rejects(binding.callAsync('Play', ['held.flac', 0]), /音频服务调用超时/)
    t.mock.timers.tick(20)
    await rejected
    children[0].emit('exit', 1)
    t.mock.timers.tick(1)
    assert.equal(children.length, 2)
    const newPlay = binding.callAsync('Play', ['replacement.flac', 0])
    const request = children[1].messages[0] as { requestId: string }
    children[1].emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: undefined
    })
    await newPlay
    t.mock.timers.tick(29)
    assert.equal(children[1].killCount, 0, 'Old grace must not kill a replacement generation')
    const heldAgain = assert.rejects(binding.callAsync('Seek', [12]), /音频服务调用超时/)
    t.mock.timers.tick(20)
    await heldAgain
    binding.destroy()
    t.mock.timers.tick(100)
    assert.equal(
      children[1].killCount,
      1,
      'Destroy kills once and cancels the detached recovery timer'
    )
    assert.equal(children.length, 2)
  } finally {
    binding.destroy()
  }
})

test('playback polling never kills the service while a slow native operation is in flight', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 200,
    restartDelayMs: 5,
    electron
  })

  try {
    // A Play on a slow source blocks the service's single JS thread; the
    // 250ms playback-info poller then times out as collateral. This exact
    // interleaving used to kill the service mid-open and loop the restart.
    binding.Play('network-source.flac', 0)
    for (let poll = 0; poll < 3; poll += 1) {
      await assert.rejects(() => binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(children[0].killCount, 0)
    assert.equal(children.length, 1)
    // Once the slow operation resolves, the wedged-child watchdog works again.
    const playRequest = children[0].messages.find(
      (message) => (message as { method?: string }).method === 'Play'
    ) as { requestId: string }
    children[0].emit('message', {
      kind: 'response',
      requestId: playRequest.requestId,
      ok: true,
      value: undefined
    })
    await assert.rejects(() => binding.callAsync('GetPlaybackInfo', []), /音频服务调用超时/)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(children[0].killCount, 1)
  } finally {
    binding.destroy()
  }
})

async function waitForControlFailure(
  binding: AudioEngineServiceBinding,
  method: string
): Promise<void> {
  const deadline = Date.now() + 1000
  while (!binding.GetLastError().includes(method)) {
    if (Date.now() >= deadline)
      throw new Error('Expected synthetic control failure was not observed')
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  // Include the fire-and-forget rejection microtask, not merely timer expiry.
  await new Promise((resolve) => setImmediate(resolve))
}

test('owned fast setter timeout cannot reject a held slow LoadQueue in either fire-and-forget path', async () => {
  for (const method of ['SetLoopRange', 'SetAutoMixMode']) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'unused-public-test.js',
      requestTimeoutMs: 20,
      topologyRequestTimeoutMs: 1000,
      restartDelayMs: 1000,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      let settled = false
      const pending = binding.callAsync('LoadQueue', ['[]', 0]).then(
        (value) => {
          settled = true
          return value
        },
        (error) => {
          settled = true
          throw error
        }
      )
      // Attach immediately so the old implementation's expected rejection is observed.
      const result = pending.then(
        (value) => ({ value }),
        (error) => ({ error })
      )
      if (method === 'SetLoopRange') binding.SetLoopRange(-1, -1)
      else binding.SetAutoMixMode('off')
      await waitForControlFailure(binding, method)
      assert.equal(settled, false, 'Collateral control timeout must not reject the slow request')
      assert.equal(child.killCount, 0)
      const request = child.messages.find(
        (message) => (message as { method?: string }).method === 'LoadQueue'
      ) as { requestId: string }
      child.emit('message', {
        kind: 'response',
        requestId: request.requestId,
        ok: true,
        value: 'public queue ACK'
      })
      assert.deepEqual(await result, { value: 'public queue ACK' })
    } finally {
      binding.destroy()
    }
  }
})

test('a timed out coalesced setter still delivers its latest value and accepts a fresh slow ACK', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'unused-public-test.js',
    requestTimeoutMs: 20,
    topologyRequestTimeoutMs: 1000,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    const pending = binding.callAsync('LoadQueue', ['[]', 0])
    const result = pending.then(
      (value) => ({ value }),
      (error) => ({ error })
    )
    binding.SetLoopRange(-1, -1)
    await new Promise((resolve) => setImmediate(resolve))
    binding.SetLoopRange(4, 6)
    await waitForControlFailure(binding, 'SetLoopRange')
    const controls = child.messages.filter(
      (message) => (message as { method?: string }).method === 'SetLoopRange'
    ) as Array<{ requestId: string; args: unknown[] }>
    assert.equal(controls.length, 2)
    assert.deepEqual(controls[1].args, [4, 6])
    // A late ACK for the timed-out old control cannot consume the new request.
    child.emit('message', { kind: 'response', requestId: controls[0].requestId, ok: true })
    child.emit('message', { kind: 'response', requestId: controls[1].requestId, ok: true })
    const queue = child.messages.find(
      (message) => (message as { method?: string }).method === 'LoadQueue'
    ) as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: queue.requestId,
      ok: true,
      value: 'public fresh ACK'
    })
    assert.deepEqual(await result, { value: 'public fresh ACK' })
    assert.equal(child.killCount, 0)
  } finally {
    binding.destroy()
  }
})

test('non-timeout errors and externally spoofed timeout codes retain fatal pending-request rejection', async () => {
  for (const mode of ['native-rejection', 'spoofed-timeout-code']) {
    const child = new ManualUtilityProcess()
    const binding = new AudioEngineServiceBinding({
      serviceEntry: 'unused-public-test.js',
      requestTimeoutMs: 100,
      topologyRequestTimeoutMs: 1000,
      restartDelayMs: 1000,
      electron: { utilityProcess: { fork: () => child } }
    })
    try {
      const pending = binding.callAsync('LoadQueue', ['[]', 0])
      const rejection = assert.rejects(pending, /public genuine control failure/)
      if (mode === 'spoofed-timeout-code') {
        const post = child.postMessage.bind(child)
        child.postMessage = (message) => {
          if ((message as { method?: string }).method === 'SetLoopRange') {
            throw Object.assign(new Error('public genuine control failure'), {
              code: 'ERR_AUDIO_SERVICE_TIMEOUT'
            })
          }
          post(message)
        }
      }
      binding.SetLoopRange(-1, -1)
      await new Promise((resolve) => setImmediate(resolve))
      if (mode === 'native-rejection') {
        const control = child.messages.find(
          (message) => (message as { method?: string }).method === 'SetLoopRange'
        ) as { requestId: string }
        child.emit('message', {
          kind: 'response',
          requestId: control.requestId,
          ok: false,
          error: 'public genuine control failure'
        })
      }
      await rejection
      assert.match(binding.GetLastError(), /public genuine control failure/)
    } finally {
      binding.destroy()
    }
  }
})

test('topology RPC outlives the normal control deadline and resolves in the same generation', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 5,
    topologyRequestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })

  try {
    const pending = binding.callAsync('SetOutputConfig', ['{"preferredBufferSize":512}'])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(child.killCount, 0)
    const request = child.messages[0] as { requestId: string; method: string }
    assert.equal(request.method, 'SetOutputConfig')
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: undefined
    })
    await pending
    assert.equal(child.killCount, 0)
  } finally {
    binding.destroy()
  }
})

test('playback controls remain responsive while isolated full-file analysis is hung', async () => {
  const analysisChild = new ManualUtilityProcess()
  const playbackChild = new ManualUtilityProcess()
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    taskTimeoutMs: 1000,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => analysisChild } }
  })
  const playback = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1500,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => playbackChild } }
  })
  const hungAnalysis = analysis.analyzeBpm('long-album.flac', '{}')
  markAnalysisWorkerReady(analysisChild)
  assert.equal(analysisChild.messages.length, 1)

  const controls = [
    playback.callAsync('Pause', []),
    playback.callAsync('Next', []),
    playback.callAsync('GetPlaybackInfo', []),
    playback.callAsync('GetVisualizationData', ['{}'])
  ]
  playbackChild.emit('message', {
    kind: 'ready',
    capabilities: createAudioServiceCapabilities(['ApplyDspState', 'GetDspGraphStatus'])
  })
  for (const message of playbackChild.messages as Array<{
    requestId: string
    method: string
  }>) {
    playbackChild.emit('message', {
      kind: 'response',
      requestId: message.requestId,
      ok: true,
      value:
        message.method === 'GetPlaybackInfo'
          ? '{"state":"playing"}'
          : message.method === 'GetVisualizationData'
            ? '{"active":true,"spectrum":[]}'
            : undefined
    })
  }

  await Promise.all(controls)
  assert.equal(playbackChild.killCount, 0)
  assert.equal(analysis.getStatus().active, 1)
  const cancelled = assert.rejects(hungAnalysis, /analysis cancelled/)
  analysis.cancelBySource('long-album.flac', 'bpm')
  await cancelled
  assert.equal(analysisChild.killCount, 1)
  assert.equal(playbackChild.killCount, 0)

  analysis.destroy()
  playback.destroy()
})

test('playback service rejects offline analysis before it enters the RPC queue', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 50,
    electron: { utilityProcess: { fork: () => child } }
  })

  await assert.rejects(
    () => binding.callAsync('AnalyzeLoudness', ['track.flac', '{}']),
    /isolated audio analysis service/
  )
  assert.equal(child.messages.length, 0)
  assert.equal(child.killCount, 0)
  binding.destroy()
})

test('audio analysis waiting queue honors priority and caps queued tasks', async () => {
  const child = new ManualUtilityProcess()
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 1,
    maxQueueSize: 2,
    taskTimeoutMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  const first = analysis.analyzeBpm('first.flac', '{}', { priority: 0 })
  markAnalysisWorkerReady(child)
  const last = analysis.analyzeBpm('last.flac', '{}', { priority: -10 })
  const urgent = analysis.analyzeBpm('urgent.flac', '{}', { priority: 100 })
  assert.equal(analysis.getStatus().active, 1)
  assert.equal(analysis.getStatus().queued, 2)
  await assert.rejects(
    () => analysis.analyzeBpm('overflow.flac', '{}', { priority: -100 }),
    /queue is full/
  )

  respondWithBpm(child, 0, 120)
  assert.equal((child.messages[1] as { source: string }).source, 'urgent.flac')
  respondWithBpm(child, 1, 121)
  assert.equal((child.messages[2] as { source: string }).source, 'last.flac')
  respondWithBpm(child, 2, 122)
  const results = await Promise.all([first, urgent, last])
  assert.deepEqual(
    results.map((result) => result.bpm),
    [120, 121, 122]
  )
  analysis.destroy()
})

test('urgent loudness analysis evicts the worst waiting task from a full queue', async () => {
  const child = new ManualUtilityProcess()
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 1,
    maxQueueSize: 2,
    taskTimeoutMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  const active = analysis.analyzeBpm('active.flac', '{}', { priority: 0 })
  markAnalysisWorkerReady(child)
  const retained = analysis.analyzeBpm('retained.flac', '{}', { priority: -10 })
  const victim = analysis.analyzeBpm('victim.flac', '{}', { priority: -20 })
  const victimOutcome = victim.then(
    () => null,
    (error: unknown) => error as Error & { code?: string }
  )
  const urgent = analysis.analyzeLoudness('urgent-loudnorm.flac', '{}', { priority: 100 })

  const eviction = await victimOutcome
  assert.equal(eviction?.code, 'ERR_AUDIO_ANALYSIS_EVICTED')
  assert.match(eviction?.message ?? '', /higher-priority request/)
  assert.equal(analysis.getStatus().queued, 2)

  respondWithBpm(child, 0, 120)
  assert.equal((child.messages[1] as { source: string }).source, 'urgent-loudnorm.flac')
  respondWithLoudness(child, 1, -14)
  assert.equal((child.messages[2] as { source: string }).source, 'retained.flac')
  respondWithBpm(child, 2, 121)

  assert.equal((await active).bpm, 120)
  assert.equal((await urgent).integratedLufs, -14)
  assert.equal((await retained).bpm, 121)
  analysis.destroy()
})

test('audio analysis aging lets an old low-priority task outrank fresh work', async () => {
  const child = new ManualUtilityProcess()
  let now = 0
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 1,
    maxQueueSize: 3,
    taskTimeoutMs: 1000,
    queueTimeoutMs: 300_000,
    agingIntervalMs: 1000,
    now: () => now,
    electron: { utilityProcess: { fork: () => child } }
  })
  const active = analysis.analyzeBpm('active.flac', '{}')
  markAnalysisWorkerReady(child)
  const aged = analysis.analyzeBpm('aged-low.flac', '{}', { priority: -50 })
  now = 60_000
  const fresh = analysis.analyzeBpm('fresh.flac', '{}', { priority: 0 })

  respondWithBpm(child, 0, 120)
  assert.equal((child.messages[1] as { source: string }).source, 'aged-low.flac')
  respondWithBpm(child, 1, 121)
  assert.equal((child.messages[2] as { source: string }).source, 'fresh.flac')
  respondWithBpm(child, 2, 122)

  assert.deepEqual(
    (await Promise.all([active, aged, fresh])).map((result) => result.bpm),
    [120, 121, 122]
  )
  analysis.destroy()
})

test('queued analysis deadline rejects waiting work and clears maintenance timer', async () => {
  const child = new ManualUtilityProcess()
  let now = 0
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 1,
    maxQueueSize: 2,
    taskTimeoutMs: 1000,
    queueTimeoutMs: 100,
    agingIntervalMs: 100,
    now: () => now,
    electron: { utilityProcess: { fork: () => child } }
  })
  const internals = analysis as unknown as {
    queueMaintenanceTimer: NodeJS.Timeout | null
  }
  const active = analysis.analyzeBpm('active.flac', '{}')
  markAnalysisWorkerReady(child)
  const expired = analysis.analyzeBpm('expired.flac', '{}')
  const expiredOutcome = expired.then(
    () => null,
    (error: unknown) => error as Error & { code?: string }
  )
  const firstMaintenanceTimer = internals.queueMaintenanceTimer
  assert.notEqual(firstMaintenanceTimer, null)
  const alsoExpired = analysis.analyzeLoudness('also-expired.flac', '{}')
  const alsoExpiredOutcome = alsoExpired.then(
    () => null,
    (error: unknown) => error as Error & { code?: string }
  )
  assert.equal(internals.queueMaintenanceTimer, firstMaintenanceTimer)

  now = 101
  assert.equal(analysis.getStatus().queued, 0)
  const [deadline, alsoDeadline] = await Promise.all([expiredOutcome, alsoExpiredOutcome])
  assert.equal(deadline?.code, 'ERR_AUDIO_ANALYSIS_QUEUE_TIMEOUT')
  assert.equal(alsoDeadline?.code, 'ERR_AUDIO_ANALYSIS_QUEUE_TIMEOUT')
  assert.equal(internals.queueMaintenanceTimer, null)
  assert.equal(analysis.getStatus().active, 1)

  respondWithBpm(child, 0, 120)
  assert.equal((await active).bpm, 120)
  analysis.destroy()
  assert.equal(internals.queueMaintenanceTimer, null)
})

test('queued analysis deadline fires without status polling', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new ManualUtilityProcess()
  let now = 0
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 1,
    maxQueueSize: 2,
    taskTimeoutMs: 1000,
    queueTimeoutMs: 100,
    agingIntervalMs: 100,
    now: () => now,
    electron: { utilityProcess: { fork: () => child } }
  })
  const active = analysis.analyzeBpm('active.flac', '{}')
  markAnalysisWorkerReady(child)
  const expired = analysis.analyzeLoudness('deadline.flac', '{}')
  const expiredOutcome = expired.then(
    () => null,
    (error: unknown) => error as Error & { code?: string }
  )

  now = 101
  context.mock.timers.tick(100)
  assert.equal((await expiredOutcome)?.code, 'ERR_AUDIO_ANALYSIS_QUEUE_TIMEOUT')
  assert.equal(analysis.getStatus().queued, 0)
  assert.equal(analysis.getStatus().active, 1)

  respondWithBpm(child, 0, 120)
  assert.equal((await active).bpm, 120)
  analysis.destroy()
})

test('audio analysis worker exit rejects its pending request and ignores late results', async () => {
  const child = new ManualUtilityProcess()
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    taskTimeoutMs: 1000,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  const pending = analysis.analyzeBpm('exit.flac', '{}')
  markAnalysisWorkerReady(child)
  const request = child.messages[0] as { requestId: string }
  const rejected = assert.rejects(pending, /worker 1 exited/)
  child.emit('exit', 23)
  await rejected
  child.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value: bpmResultJson(999)
  })
  assert.equal(analysis.getStatus().active, 0)
  analysis.destroy()
})

test('audio analysis watchdog replaces only the timed-out analysis worker', async () => {
  const children: ManualUtilityProcess[] = []
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    taskTimeoutMs: 100,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })
  const pending = analysis.analyzeBpm('timeout.flac', '{}')
  markAnalysisWorkerReady(children[0])
  await assert.rejects(pending, /analysis timed out/)
  assert.equal(children[0].killCount, 1)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(children.length, 2)
  assert.equal(analysis.getStatus().active, 0)
  analysis.destroy()
})

test('audio analysis rejects queued work after repeated worker startup failures', async () => {
  let starts = 0
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxStartupFailures: 2,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          starts += 1
          throw new Error('analysis worker bootstrap failed')
        }
      }
    }
  })

  await assert.rejects(
    () => analysis.analyzeBpm('startup-failure.flac', '{}'),
    /workers failed to start after 2 attempts/
  )
  assert.equal(starts, 2)
  assert.equal(analysis.getStatus().queued, 0)
  analysis.destroy()
})

test('oversized audio service cache responses are rejected, discarded, and followed by a clean restart', async () => {
  const children: ManualUtilityProcess[] = []
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
    lastPlaybackInfo: unknown
  }

  try {
    assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
    const poisonedRequest = children[0].messages[0] as { requestId: string }
    children[0].emit('message', {
      kind: 'response',
      requestId: poisonedRequest.requestId,
      ok: true,
      value: 'x'.repeat(2 * 1024 * 1024)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(children[0].killCount, 1)
    assert.equal(internals.pending.size, 0)
    assert.equal(internals.lastPlaybackInfo, '{"state":"stopped"}')
    assert.match(binding.GetLastError(), /invalid or oversized message/)

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(children.length, 2)
    const recovered = binding.getMetadataAsync('recovered.flac')
    const recoveredRequest = children[1].messages[0] as { requestId: string }
    children[1].emit('message', {
      kind: 'response',
      requestId: recoveredRequest.requestId,
      ok: true,
      value: '{"title":"recovered"}'
    })
    assert.equal(await recovered, '{"title":"recovered"}')
  } finally {
    binding.destroy()
  }
})

test('metadata accepts bounded embedded artwork while oversized metadata still restarts the service', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    const pending = binding.getMetadataAsync('large-cover.mp3')
    const request = child.messages.at(-1) as { requestId: string }
    const metadata = JSON.stringify({
      duration: 135.694,
      coverDataBase64: 'A'.repeat(2 * 1024 * 1024)
    })
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: metadata
    })
    assert.equal(await pending, metadata)
    assert.equal(child.killCount, 0)
    const oversized = binding.getMetadataAsync('oversized-cover.mp3')
    const rejected = assert.rejects(oversized, /invalid or oversized message/)
    const largeRequest = child.messages.at(-1) as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: largeRequest.requestId,
      ok: true,
      value: 'x'.repeat(9 * 1024 * 1024)
    })
    await rejected
    assert.equal(child.killCount, 1)
  } finally {
    binding.destroy()
  }
})

test('explicit playback reads refresh the cache used by ticks after pause and preparation', async () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    for (const info of [
      { state: 'playing', autoMixState: 'preparing', autoMixPlanId: 1 },
      { state: 'paused', autoMixState: 'mixing', autoMixPlanId: 1, autoMixOutputSeconds: 1.234 },
      { state: 'playing', autoMixState: 'mixing', autoMixPlanId: 1, autoMixOutputSeconds: 1.234 }
    ]) {
      const pending = binding.callAsync('GetPlaybackInfo', [])
      const request = child.messages.at(-1) as { requestId: string }
      const json = JSON.stringify(info)
      child.emit('message', {
        kind: 'response',
        requestId: request.requestId,
        ok: true,
        value: json
      })
      assert.equal(await pending, json)
      assert.equal(binding.GetPlaybackInfo(), json)
    }
  } finally {
    binding.destroy()
  }
})

test('audio service utility-process logs are bounded by chunk and process lifetime', () => {
  const child = new ManualUtilityProcess()
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    electron: { utilityProcess: { fork: () => child } }
  })
  const logs: string[] = []
  binding.on('log', (value: string) => logs.push(value))

  try {
    binding.GetPlaybackInfo()
    child.stdout.emit('data', Buffer.alloc(32 * 1024, 0x61))
    for (let index = 0; index < 15; index += 1) {
      child.stdout.emit('data', Buffer.alloc(16 * 1024, 0x61))
    }
    child.stdout.emit('data', Buffer.alloc(1, 0x61))

    const output = logs.filter((value) => value !== '[utility process output truncated]').join('')
    assert.equal(Buffer.byteLength(output, 'utf8'), 256 * 1024)
    assert.equal(logs.filter((value) => value === '[utility process output truncated]').length, 1)
  } finally {
    binding.destroy()
  }
})

test('oversized audio analysis responses terminate only the affected worker and recover', async () => {
  const children: ManualUtilityProcess[] = []
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    taskTimeoutMs: 1000,
    restartDelayMs: 1,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })

  try {
    const poisoned = analysis.analyzeBpm('poisoned.flac', '{}')
    markAnalysisWorkerReady(children[0])
    const poisonedRequest = children[0].messages[0] as { requestId: string }
    children[0].emit('message', {
      kind: 'response',
      requestId: poisonedRequest.requestId,
      ok: true,
      value: 'x'.repeat(600 * 1024)
    })

    await assert.rejects(poisoned, (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ERR_AUDIO_ANALYSIS_INVALID_RESPONSE')
      return true
    })
    assert.equal(children[0].killCount, 1)
    assert.equal(analysis.getStatus().active, 0)

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(children.length, 2)
    markAnalysisWorkerReady(children[1])
    const recovered = analysis.analyzeBpm('recovered.flac', '{}')
    respondWithBpm(children[1], 0, 128)
    assert.equal((await recovered).bpm, 128)
  } finally {
    analysis.destroy()
  }
})

function bpmResultJson(bpm: number): string {
  return JSON.stringify({
    bpm,
    confidence: 0.9,
    source: 'analyzed',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    algorithmVersion: 1
  })
}

function respondWithBpm(child: ManualUtilityProcess, index: number, bpm: number): void {
  const request = child.messages[index] as { requestId: string }
  child.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value: bpmResultJson(bpm)
  })
}

function respondWithLoudness(
  child: ManualUtilityProcess,
  index: number,
  integratedLufs: number
): void {
  const request = child.messages[index] as { requestId: string }
  child.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value: JSON.stringify({
      integratedLufs,
      truePeakDb: -1,
      source: 'analyzed',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      algorithmVersion: 1
    })
  })
}

test('audio service postMessage failures clear pending RPCs immediately', async () => {
  const child = new ThrowingUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 1,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  try {
    await assert.rejects(() => binding.getMetadataAsync('pipe-closed.flac'), /utility pipe closed/)
    assert.equal(internals.pending.size, 0)

    await assert.rejects(() => binding.getMetadataAsync('second-call.flac'), /utility pipe closed/)
    assert.equal(internals.pending.size, 0)
  } finally {
    binding.destroy()
  }
})

test('audio service async RPCs reject beyond the in-flight request cap', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 2,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  const first = binding.getMetadataAsync('slow-track-1.flac')
  const second = binding.getMetadataAsync('slow-track-2.flac')
  const third = binding.getMetadataAsync('slow-track-3.flac')
  const thirdRejected = assert.rejects(third, /音频服务请求过多/)

  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(child.messages.length, 2)
    assert.equal(internals.pending.size, 2)
    await thirdRejected

    for (const message of child.messages as Array<{ requestId: string }>) {
      child.emit('message', {
        kind: 'response',
        requestId: message.requestId,
        ok: true,
        value: '{"title":"ok"}'
      })
    }

    await Promise.all([first, second])
    assert.equal(internals.pending.size, 0)
  } finally {
    binding.destroy()
    await Promise.allSettled([first, second, third])
  }
})

test('fire-and-forget backpressure does not fail existing in-flight RPCs', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 1000,
    restartDelayMs: 1000,
    maxInFlightRequests: 1,
    electron
  })
  const internals = binding as unknown as {
    pending: Map<string, unknown>
  }

  const metadata = binding.getMetadataAsync('slow-track.flac')
  const metadataSettled = metadata.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  )

  try {
    binding.SetOutputDevice('wasapi:busy-device')
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(child.messages.length, 1)
    assert.equal(internals.pending.size, 1)

    child.emit('message', {
      kind: 'response',
      requestId: (child.messages[0] as { requestId: string }).requestId,
      ok: true,
      value: '{"title":"ok"}'
    })

    assert.deepEqual(await metadataSettled, { ok: true, value: '{"title":"ok"}' })
  } finally {
    binding.destroy()
    await metadataSettled
  }
})

test('stale audio service responses after crash do not repopulate playback cache', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 5,
    electron
  })

  assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
  const firstChild = children[0]
  const request = firstChild.messages[0] as { requestId: string }
  firstChild.emit('exit', 1)
  await new Promise((resolve) => setTimeout(resolve, 20))

  firstChild.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value: '{"state":"playing"}'
  })

  assert.equal(binding.GetPlaybackInfo(), '{"state":"stopped"}')
  binding.destroy()
})

test('audio service crash clears service-derived caches', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 5,
    electron
  })

  const inactive =
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  const visualization =
    '{"spectrum":[0.5],"waveform":[0.25],"peakDb":-1,"rmsDb":-8,"lufsMomentary":-10,"spectrogram":[],"sampleRate":48000,"active":true}'
  const devices = '[{"id":"wasapi:old","name":"Old DAC"}]'
  const upcoming = '{"source":"old-track.flac","title":"Old Track"}'
  const convolver = '{"loaded":true,"active":true,"name":"old-ir.wav"}'

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), inactive)
  assert.equal(binding.EnumerateDevices(), '[]')
  assert.equal(binding.GetUpcomingTrack(), null)
  assert.equal(binding.GetConvolverInfo(), '{"loaded":false,"active":false}')
  const child = children[0]

  const [visualizationRequest, devicesRequest, upcomingRequest, convolverRequest] =
    child.messages as Array<{
      requestId: string
    }>
  child.emit('message', {
    kind: 'response',
    requestId: visualizationRequest.requestId,
    ok: true,
    value: visualization
  })
  child.emit('message', {
    kind: 'response',
    requestId: devicesRequest.requestId,
    ok: true,
    value: devices
  })
  child.emit('message', {
    kind: 'response',
    requestId: upcomingRequest.requestId,
    ok: true,
    value: upcoming
  })
  child.emit('message', {
    kind: 'response',
    requestId: convolverRequest.requestId,
    ok: true,
    value: convolver
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), visualization)
  assert.equal(binding.EnumerateDevices(), devices)
  assert.equal(binding.GetUpcomingTrack(), upcoming)
  assert.equal(binding.GetConvolverInfo(), convolver)

  child.emit('exit', 1)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(binding.GetVisualizationData('{"spectrumPoints":64}'), inactive)
  assert.equal(binding.EnumerateDevices(), '[]')
  assert.equal(binding.GetUpcomingTrack(), null)
  assert.equal(binding.GetConvolverInfo(), '{"loaded":false,"active":false}')

  binding.destroy()
})

test('fatal audio service startup errors terminate the failed utility process without restart loop', async () => {
  const children: ManualUtilityProcess[] = []
  const electron = {
    utilityProcess: {
      fork: () => {
        const child = new ManualUtilityProcess()
        children.push(child)
        return child
      }
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 5,
    electron
  })
  const child = (() => {
    binding.GetPlaybackInfo()
    return children[0]
  })()

  let crashReason = ''
  const crashEvents: Array<{ fatal?: boolean }> = []
  binding.on('crash', (reason, options) => {
    crashReason = reason
    crashEvents.push(options ?? {})
  })

  child.emit('message', {
    kind: 'fatal',
    error: 'native addon failed to load'
  })

  assert.equal(child.killCount, 1)
  assert.equal(crashReason, 'native addon failed to load')
  assert.match(binding.GetLastError(), /native addon failed to load/)
  assert.deepEqual(crashEvents, [{ fatal: true }])
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(children.length, 1)

  // The device-options poll keeps calling into the binding roughly once a
  // second. call()'s lazy start must not resurrect a child that fails
  // identically every time, or handleFatal's no-restart contract is void and
  // every poll re-emits 'crash' at the renderer.
  binding.GetPlaybackInfo()
  binding.EnumerateDevices()
  binding.GetDspGraphStatus()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(children.length, 1)
  assert.equal(crashEvents.length, 1)
  assert.equal(binding.fatalStartupError, 'native addon failed to load')

  binding.destroy()
})

test('a fatal audio service latch only reopens through an explicit restart', async () => {
  const children: ManualUtilityProcess[] = []
  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 5,
    electron: {
      utilityProcess: {
        fork: () => {
          const child = new ManualUtilityProcess()
          children.push(child)
          return child
        }
      }
    }
  })

  binding.GetPlaybackInfo()
  children[0].emit('message', { kind: 'fatal', error: '未加载 twilight_audio_node.node' })
  await assert.rejects(binding.callAsync('GetPlaybackInfo', []), /未加载 twilight_audio_node\.node/)
  assert.equal(children.length, 1)

  assert.equal(binding.restartAfterFatal(), true)
  assert.equal(children.length, 2)
  assert.equal(binding.fatalStartupError, '')

  // A second release is a no-op while the replacement child is alive.
  assert.equal(binding.restartAfterFatal(), false)
  assert.equal(children.length, 2)

  binding.destroy()
})

test('cache refreshes coalesce while a same-method service request is in flight', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })

  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  )
  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  )
  assert.equal(child.messages.length, 1)

  const request = child.messages[0] as { requestId: string }

  child.emit('message', {
    kind: 'response',
    requestId: request.requestId,
    ok: true,
    value:
      '{"spectrum":[1],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(
    binding.GetVisualizationData('{"spectrumPoints":4096}'),
    '{"spectrum":[1],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'
  )
  assert.equal(child.messages.length, 2)

  binding.destroy()
})

test('cache refreshes keep distinct visualization options in flight independently', () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })

  binding.GetVisualizationData('{"spectrumPoints":64}')
  binding.GetVisualizationData('{"spectrumPoints":4096}')

  assert.equal(child.messages.length, 2)
  assert.deepEqual(
    child.messages.map((message) => (message as { args: unknown[] }).args),
    [['{"spectrumPoints":64}'], ['{"spectrumPoints":4096}']]
  )

  binding.destroy()
})

test('visualization cache is isolated by requested options', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })

  const smallOptions = '{"spectrumPoints":64}'
  const largeOptions = '{"spectrumPoints":4096}'
  const inactive =
    '{"spectrum":[],"waveform":[],"peakDb":-120,"rmsDb":-120,"lufsMomentary":null,"spectrogram":[],"sampleRate":0,"active":false}'
  const smallData =
    '{"spectrum":[0.25],"waveform":[],"peakDb":-6,"rmsDb":-18,"lufsMomentary":null,"spectrogram":[],"sampleRate":44100,"active":true}'
  const largeData =
    '{"spectrum":[0.75,0.5],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}'

  assert.equal(binding.GetVisualizationData(smallOptions), inactive)
  child.emit('message', {
    kind: 'response',
    requestId: (child.messages[0] as { requestId: string }).requestId,
    ok: true,
    value: smallData
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData(smallOptions), smallData)
  assert.equal(binding.GetVisualizationData(largeOptions), inactive)
  child.emit('message', {
    kind: 'response',
    requestId: (child.messages[2] as { requestId: string }).requestId,
    ok: true,
    value: largeData
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(binding.GetVisualizationData(largeOptions), largeData)
  assert.equal(binding.GetVisualizationData(smallOptions), smallData)

  binding.destroy()
})

test('visualization cache retains only a small bounded set of option keys', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })
  const internals = binding as unknown as {
    lastVisualizationDataByKey: Map<string, unknown>
    cacheRequestSerial: Map<string, number>
  }

  for (let index = 0; index < 12; ++index) {
    binding.GetVisualizationData(`{"spectrumPoints":${64 + index}}`)
  }
  for (let index = 0; index < child.messages.length; ++index) {
    const request = child.messages[index] as { requestId: string }
    child.emit('message', {
      kind: 'response',
      requestId: request.requestId,
      ok: true,
      value: `{"spectrum":[${index}],"waveform":[],"peakDb":-3,"rmsDb":-12,"lufsMomentary":null,"spectrogram":[],"sampleRate":48000,"active":true}`
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 0))

  const visualizationSerialKeys = [...internals.cacheRequestSerial.keys()].filter((key) =>
    key.startsWith('GetVisualizationData:')
  )
  assert.ok(internals.lastVisualizationDataByKey.size <= 8)
  assert.ok(visualizationSerialKeys.length <= 8)

  binding.destroy()
})

test('high-frequency seek and volume service controls coalesce to the latest value', async () => {
  const child = new ManualUtilityProcess()
  const electron = {
    utilityProcess: {
      fork: () => child
    }
  }

  const binding = new AudioEngineServiceBinding({
    serviceEntry: 'audioEngineService.js',
    requestTimeoutMs: 100,
    restartDelayMs: 1000,
    electron
  })

  binding.Seek(1)
  binding.Seek(2)
  binding.Seek(3)
  binding.SetVolume(0.1)
  binding.SetVolume(0.8)
  binding.SetPlaybackRate(1.25)
  binding.SetPlaybackRate(1.5)

  assert.equal(child.messages.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(child.messages.length, 3)
  assert.deepEqual(
    child.messages.map((message) => ({
      method: (message as { method: string }).method,
      args: (message as { args: unknown[] }).args
    })),
    [
      { method: 'Seek', args: [3] },
      { method: 'SetVolume', args: [0.8] },
      { method: 'SetPlaybackRate', args: [1.5] }
    ]
  )

  binding.Seek(4)
  binding.Seek(5)
  await new Promise((resolve) => setTimeout(resolve, 0))

  // Seek is still in-flight, so the latest seek stays coalesced until the first completes.
  assert.equal(child.messages.length, 3)

  const firstSeek = child.messages.find(
    (message) => (message as { method: string }).method === 'Seek'
  ) as { requestId: string }
  child.emit('message', {
    kind: 'response',
    requestId: firstSeek.requestId,
    ok: true,
    value: undefined
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(child.messages.length, 4)
  assert.deepEqual(child.messages[3], {
    ...(child.messages[3] as { requestId: string }),
    kind: 'request',
    method: 'Seek',
    args: [5]
  })

  binding.destroy()
})

test('analysis pool keeps a conservative default concurrency and honors explicit overrides', () => {
  const child = new ManualUtilityProcess()
  const derived = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    assert.equal(derived.getStatus().maxConcurrency, 1)
  } finally {
    derived.destroy()
  }

  const pinned = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    maxConcurrency: 2,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    assert.equal(pinned.getStatus().maxConcurrency, 2)
  } finally {
    pinned.destroy()
  }
})

test('whole-file analysis tasks can override the pool default deadline', async () => {
  const child = new ManualUtilityProcess()
  const analysis = new AudioAnalysisServiceClient({
    serviceEntry: 'audioAnalysisService.js',
    taskTimeoutMs: 60_000,
    restartDelayMs: 1000,
    electron: { utilityProcess: { fork: () => child } }
  })
  try {
    const pending = analysis.analyzeLoudness('long-mix.dsf', '{"maxAnalysisSeconds":0}', {
      timeoutMs: 1000
    })
    markAnalysisWorkerReady(child)
    await assert.rejects(pending, /analysis timed out after 1000 ms/)
    assert.equal(child.killCount, 1)
  } finally {
    analysis.destroy()
  }
})
