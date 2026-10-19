import assert from 'node:assert/strict'
import test from 'node:test'
import { DspOrchestrator, type DspOrchestratorHost } from './dspOrchestrator.ts'
import { createDefaultPlaybackInfo } from './audioEngineHelpers.ts'
import type { DspStatePayload } from '../../shared/audioServiceContract.ts'
import { compensatedAuditionGraph } from '../../shared/dspAudition.ts'
import {
  DEFAULT_DSP_OUTPUT_STAGE,
  type DspGraphConfig,
  type DspGraphStatus
} from '../../shared/dspGraph.ts'

test('overlapping DSP submissions return their own ACK and preserve the latest aggregate state', async () => {
  const pending = new Map<
    number,
    { resolve: (status: DspGraphStatus) => void; reject: (error: Error) => void }
  >()
  let currentAck = 0
  const host = {
    getPlaybackInfo: () =>
      createDefaultPlaybackInfo('wasapi', 'auto', false, {
        routingMode: 'auto',
        preferredBufferSize: 0
      }),
    getDevice: () => 'auto',
    getOutput: () => 'wasapi',
    getNative: () => ({}),
    setLastNativeError: () => undefined,
    getAudioServiceBinding: () => ({
      getDspGraphStatusAsync: async () => ack(currentAck),
      applyDspState: (revision: number) =>
        new Promise<DspGraphStatus>((resolve, reject) => {
          pending.set(revision, { resolve, reject })
        })
    })
  } as unknown as DspOrchestratorHost
  const dsp = new DspOrchestrator(host, {}, {})
  const ack = (revision: number): DspGraphStatus => ({
    revision,
    activeSceneId: 'default',
    totalLatencyFrames: 0,
    totalTailFrames: 0,
    nodes: [],
    compileState: 'ready'
  })
  const first = dsp.applyNativeDspGraph('restore')
  const second = dsp.applyNativeDspGraph('user update')
  currentAck = 1
  pending.get(1)!.resolve(ack(1))
  const firstResult = await first
  assert.equal(firstResult.requestedRevision, 1)
  assert.equal(firstResult.appliedRevision, 1)
  assert.equal(firstResult.applyState, 'applied')
  assert.equal((await dsp.getDspGraphStatus()).applyState, 'pending')
  currentAck = 2
  pending.get(2)!.resolve(ack(2))
  assert.equal((await second).applyState, 'applied')
  assert.equal((await dsp.getDspGraphStatus()).requestedRevision, 2)

  const failed = dsp.applyNativeDspGraph('failed older update')
  const latest = dsp.applyNativeDspGraph('latest update')
  currentAck = 4
  pending.get(4)!.resolve(ack(4))
  await latest
  pending.get(3)!.reject(new Error('native compile failed'))
  const failure = await failed
  assert.equal(failure.applyState, 'failed')
  assert.match(failure.applyError!, /native compile failed/)
  assert.equal((await dsp.getDspGraphStatus()).applyState, 'applied')

  let recoveryCompleted = false
  const recovery = dsp.applyLatestNativeDspGraph('recovery').then((status) => {
    recoveryCompleted = true
    return status
  })
  const duringRecovery = dsp.applyNativeDspGraph('new settings during recovery')
  pending.get(5)!.resolve(ack(5))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(recoveryCompleted, false)
  currentAck = 6
  pending.get(6)!.resolve(ack(6))
  await duringRecovery
  assert.equal((await recovery).requestedRevision, 6)
})

test('device profile processing reaches the native graph and rollback restores the previous values', async () => {
  const info = createDefaultPlaybackInfo('wasapi', 'auto', false, {
    routingMode: 'auto',
    preferredBufferSize: 0
  })
  const payloads: DspStatePayload[] = []
  const host = {
    getPlaybackInfo: () => info,
    getDevice: () => 'auto',
    getOutput: () => 'wasapi',
    getNative: () => ({}),
    callNativeMaybeAsync: async () => true,
    setLastNativeError: () => undefined,
    updateOutputPerfect: () => undefined,
    publishPlaybackInfo: () => undefined,
    syncLoudnormModeTransition: async () => undefined,
    getAudioServiceBinding: () => ({
      applyDspState: async (revision: number, payload: DspStatePayload) => {
        payloads.push(structuredClone(payload))
        return {
          revision,
          activeSceneId: 'default',
          totalLatencyFrames: 0,
          totalTailFrames: 0,
          nodes: [],
          compileState: 'ready'
        }
      }
    })
  } as unknown as DspOrchestratorHost
  const dsp = new DspOrchestrator(
    host,
    {
      audioProcessing: {
        dspEnabled: true,
        eqEnabled: false,
        eqPreamp: -6,
        volumeNormalization: 'off',
        crossfeedEnabled: true,
        crossfeedStrength: 0.2
      }
    },
    {}
  )
  const previous = structuredClone(dsp.getAudioProcessing())
  const defaultScene = dsp.dspScenes.find((scene) => scene.id === 'default')!
  defaultScene.graph.outputStage.targetSampleRate = 96000
  const compressor = defaultScene.graph.nodes.find((node) => node.id === 'compressor')!
  compressor.enabled = true
  compressor.params = { thresholdDb: -12 }
  defaultScene.graph.nodes.push({
    id: 'custom-gate',
    type: 'gate',
    enabled: true,
    params: { thresholdDb: -30 }
  })
  const previousGraph = structuredClone(defaultScene.graph)
  await dsp.applyProfileConfiguration(
    { eqEnabled: true, volumeNormalization: 'album', crossfeedStrength: 0.8 },
    'default',
    null
  )
  const graph = payloads.at(-1)!.graph as DspGraphConfig
  assert.equal(graph.nodes.find((node) => node.type === 'equalizer')?.enabled, true)
  assert.equal(graph.nodes.find((node) => node.type === 'replayGain')?.enabled, true)
  assert.equal(graph.nodes.find((node) => node.type === 'replayGain')?.params.mode, 'album')
  assert.equal(graph.nodes.find((node) => node.type === 'crossfeed')?.params.strength, 0.8)
  assert.equal(graph.outputStage.targetSampleRate, 96000)
  assert.deepEqual(
    graph.nodes.find((node) => node.id === 'compressor'),
    compressor
  )
  assert.deepEqual(
    graph.nodes.find((node) => node.id === 'custom-gate'),
    {
      id: 'custom-gate',
      type: 'gate',
      enabled: true,
      params: { thresholdDb: -30 }
    }
  )
  await dsp.applyProfileConfiguration(previous, 'default', null)
  assert.deepEqual(defaultScene.graph, previousGraph)
  const restored = payloads.at(-1)!.graph as DspGraphConfig
  assert.equal(restored.nodes.find((node) => node.type === 'equalizer')?.enabled, false)
  assert.equal(restored.nodes.find((node) => node.type === 'crossfeed')?.params.strength, 0.2)
})

test('temporary audition graphs use DSP revisions and leave saved processing and position untouched', async () => {
  const info = createDefaultPlaybackInfo('wasapi', 'auto', false, {
    routingMode: 'auto',
    preferredBufferSize: 0
  })
  info.position = 42
  const payloads: DspStatePayload[] = []
  let staleAck = false
  let continuity = false
  const host = {
    getPlaybackInfo: () => info,
    getDevice: () => 'auto',
    getOutput: () => 'wasapi',
    getOutputConfig: () => ({
      playbackPolicy: continuity ? 'continuity-first' : 'bit-perfect-first',
      continuitySampleRate: 96000
    }),
    getNative: () => ({}),
    setLastNativeError: () => undefined,
    getAudioServiceBinding: () => ({
      applyDspState: async (revision: number, payload: DspStatePayload) => {
        payloads.push(payload)
        return {
          revision: staleAck ? revision - 1 : revision,
          activeSceneId: null,
          totalLatencyFrames: 0,
          totalTailFrames: 0,
          nodes: [],
          compileState: 'ready'
        }
      }
    })
  } as unknown as DspOrchestratorHost
  const dsp = new DspOrchestrator(
    host,
    { audioProcessing: { dspEnabled: false, directMode: true } },
    {}
  )
  const before = structuredClone(dsp.processing)
  const scenes = structuredClone(dsp.dspScenes)
  const graph = compensatedAuditionGraph(
    { version: 2, nodes: [], outputStage: DEFAULT_DSP_OUTPUT_STAGE },
    -6
  )
  assert.equal((await dsp.applyNativeDspGraph('test audition', graph)).applyState, 'applied')
  assert.equal(payloads[0].processing.dspEnabled, true)
  assert.equal(payloads[0].processing.directMode, false)
  assert.equal((payloads[0].graph as DspGraphConfig).nodes[0].params.preampDb, -6)
  assert.equal(
    (payloads[0].graph as unknown as { auditionTransition: boolean }).auditionTransition,
    true
  )
  assert.deepEqual(dsp.processing, before)
  assert.deepEqual(dsp.dspScenes, scenes)
  assert.equal(info.position, 42)
  await dsp.applyNativeDspGraph('restore')
  assert.deepEqual((payloads[1].graph as DspGraphConfig).nodes, [])
  assert.equal(payloads[1].processing.dspEnabled, false)
  continuity = true
  await dsp.applyNativeDspGraph('continuous output')
  assert.equal((payloads[2].graph as DspGraphConfig).outputStage.targetSampleRate, 96000)
  assert.deepEqual(dsp.dspScenes, scenes)
  continuity = false
  staleAck = true
  const status = await dsp.applyNativeDspGraph('stale ACK', graph)
  assert.equal(status.applyState, 'failed')
  assert.match(status.applyError ?? '', /ACK revision mismatch/)
})
