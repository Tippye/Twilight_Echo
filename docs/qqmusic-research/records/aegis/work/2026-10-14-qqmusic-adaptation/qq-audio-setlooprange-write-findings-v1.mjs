import fs from 'node:fs'
import { createHash } from 'node:crypto'
const base = 'E:/PycharmProjects/MusicAnyClient/Twilight_Echo'
const out = 'E:/PycharmProjects/MusicAnyClient/docs/aegis/work/2026-10-14-qqmusic-adaptation'
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const pins = ['src/main/audioEngineServiceClient.ts', 'src/main/audioEngineServiceClient.test.ts', 'src/main/audioEngineService.ts',
  'src/main/audioEngineManager.ts', 'src/main/audio/engineIpc.ts', 'src/preload/domains/audioEngineApi.ts',
  'audio-engine/core/TwilightAudioEngine.cpp', 'audio-engine/core/AudioPipeline.cpp', 'audio-engine/decoder/FFmpegDecoder.cpp', 'audio-engine/automix-native/am_cancel.c']
const proof = ['qq-audio-setlooprange-collateral-independent-probe-v1.mjs', 'qq-audio-setlooprange-collateral-independent-probe-v1.json',
  'qq-audio-setlooprange-collateral-independent-closure-v2.mjs', 'qq-audio-setlooprange-collateral-independent-closure-v2.json']
const result = {
  schema: 'qq-audio-setlooprange-findings-v1', generatedAtUtc: new Date().toISOString(),
  scope: 'Current source service-client error isolation fix and read-only native/recovery path investigation. No live interaction.',
  sourcePins: pins.map(file => ({ path: `${base}/${file}`, sha256: sha(`${base}/${file}`) })),
  proofPins: proof.map(file => ({ path: `${out}/${file}`, sha256: sha(`${out}/${file}`) })),
  rootReportedLive: {
    boundary: 'Reported by Root, not independently observed by this worker.',
    observation: 'Own client FLAC→128 UI reload completed with native MP3 playback. Following interaction later produced native stopped and queue-load notice naming SetLoopRange timeout.',
    doesNotProve: ['Native SetLoopRange executed or deadlocked', 'Compiled native binary matches current C++ source', 'Source proxy or account rights caused the timeout']
  },
  confirmedCurrentSourceFinding: {
    priority: 2, originalSourceSha256: 'b6c2f8a1c001345b367bf9b25d0fc1d8a7fccc0ad5c6f30069dfb524c0767d67',
    chain: 'Coalesced SetLoopRange fast request times out while slow LoadQueue is pending. The request timer skips process kill as designed, but coalesced fire-and-forget catch calls recordFailure and rejects every pending request with the setter timeout.',
    exactBaseline: { fastTimeoutMs: 30, slowTimeoutMs: 300, actualLoadQueueRejectedAfterMs: 41, childKills: 0, crashEvents: 0 },
    artifact: 'qq-audio-setlooprange-collateral-independent-probe-v1.json'
  },
  minimalFix: {
    ownerFiles: ['src/main/audioEngineServiceClient.ts', 'src/main/audioEngineServiceClient.test.ts'],
    fixedSourceSha256: '364383fb4229b5af9b9904ee17237dff815d8951d1345e20df43651711c5cee1',
    behavior: 'Private WeakSet owns errors created by request timers. Fire-and-forget and coalesced catches treat only these timeout errors as transient diagnostics; no global recordFailure. Public code spoof and genuine non-timeout errors retain fatal pending rejection.',
    unchanged: ['Production1500ms fast and20000ms topology deadlines', 'Single request timer owns kill/restart policy', 'Slow-tier timeout does not kill child', 'Isolated fast timeout with no slow pending kills/restarts generation', 'Generation fences, ACK caches and latest-control coalescing'],
    testFirstEvidence: { command: 'node --experimental-strip-types --test --test-name-pattern owned-fast-setter/timed-out-coalesced/non-timeout-errors --import ./scripts/register-renderer-aliases.mjs src/main/audioEngineServiceClient.test.ts', baselineFailures: 2, baselinePass: 1, outputChunk: '0a85e0' },
    verification: { newTestsPassed: 3, focusedPolicyTestsPassed: 6, fullServiceClientTestsPassed: 43, nodeTypecheckPassed: true,
      fullTestCommand: 'node --experimental-strip-types --test --test-reporter=dot --import ./scripts/register-renderer-aliases.mjs src/main/audioEngineServiceClient.test.ts', fullTestOutputChunk: 'caabb8' },
    sameFixtureClosure: { artifact: 'qq-audio-setlooprange-collateral-independent-closure-v2.json', fastTimeoutMs: 30, slowTimeoutMs: 300,
      actualClosureAfterMs: 32, slowStillPendingAfterFastTimeout: true, freshSlowAckAccepted: true, childKills: 0, crashEvents: 0 },
    peerReview: 'Requested from qq_packaged_resources on exact fixed source/test hashes; pending at this receipt.'
  },
  recoveryApiCurrentSource: {
    rendererMethod: 'window.api.audioEngine.restartService()', ipcChannel: 'audioEngine:restartService',
    mainMethod: 'AudioEngineManager.restartAudioService()', nativeBindingMethod: 'restartAfterFatal()',
    behavior: 'Only clears a fatal startup latch. When fatalStartupError is absent, returns restarted:true without forcibly replacing a living child. Successful Boolean is not evidence of a fresh process.',
    absentNames: ['getRuntimeState', 'retryStartup', 'getStartupState'],
    readOnlyMethods: ['getPlaybackInfo', 'getAudioOutputState', 'getOutputConfigApplyStatus'],
    sourceRefs: ['src/preload/domains/audioEngineApi.ts:377', 'src/main/audio/engineIpc.ts:1660', 'src/main/audioEngineManager.ts:555', 'src/main/audioEngineServiceClient.ts:773']
  },
  nativeSourceOnly: {
    boundary: 'Read current C++ sources only. No loaded DLL pin, native stack, disassembly or runtime lock trace; these facts cannot establish shipped binary behavior.',
    setLoopRange: 'N-API SetLoopRange passes start/end only, no sourcePath. Engine calls pipeline.cancelAutoMix through setLoopRange; Pipeline mutex and atomic range fields, then ClockWake clockMutex. No direct HTTP/read operation recovered in this entry.',
    queueSerialization: 'Service handles native methods synchronously on one JS thread. LoadQueue or Play may therefore delay a setter before setter execution. CPP LoadQueue takes engine transportMutex, cancelAutoMix/Pipeline mutex, then engine mutex.',
    separateStopHypothesis: 'Ordinary DecodeStream.openSource uses null preparation cancellation token. ta_am_cancelled(null)=0. requestStop sets running=false and wakes ring buffer; stop then joins decode thread. Its FFmpeg interrupt callback does not test that running flag. A blocked network read may delay join/socket close, but no such block was observed here.',
    sourceRefs: ['audio-engine/napi/twilight_audio_node.cpp:455', 'audio-engine/core/TwilightAudioEngine.cpp:1080', 'audio-engine/core/TwilightAudioEngine.cpp:1219',
      'audio-engine/core/AudioPipeline.cpp:804', 'audio-engine/core/AudioPipeline.cpp:1069', 'audio-engine/core/AudioPipeline.cpp:1282', 'audio-engine/core/AudioPipeline.cpp:1727',
      'audio-engine/core/AudioPipeline.cpp:3429', 'audio-engine/core/AudioPipeline.cpp:3608', 'audio-engine/decoder/FFmpegDecoder.cpp:646', 'audio-engine/automix-native/am_cancel.c:35'],
    nextEvidenceIfLiveFailurePersists: 'Root own build/runtime identity and sanitized native command timing or stack showing actual blocked method; do not infer native deadlock from the SetLoopRange notice alone.'
  },
  limits: { changedProductionFiles: 2, gitMutations: 0, liveCalls: 0, originalQQOrOtherClientInteractions: 0, profileAuthReads: 0,
    actualBusinessNetwork: 0, cppEdits: 0, timeoutExpansion: 0 }
}
fs.writeFileSync(`${out}/qq-audio-setlooprange-findings-v1.json`, JSON.stringify(result, null, 2) + '\n')
for (const pin of [...result.sourcePins, ...result.proofPins]) if (sha(pin.path) !== pin.sha256) throw new Error('Pin changed')
console.log(JSON.stringify({ path: `${out}/qq-audio-setlooprange-findings-v1.json`, sha256: sha(`${out}/qq-audio-setlooprange-findings-v1.json`), pins: 14 }))
