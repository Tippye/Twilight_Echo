import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { ref, shallowRef } from 'vue'
import vm from 'node:vm'
import { ipcError, parseAppError } from '../../../shared/errors/appError.ts'
import { presentError } from '../../../shared/errors/presentError.ts'
import { translate } from '../../../shared/i18n/translate.ts'
import { getTrackSource, isLikelyLocalFilePath } from '../utils/playerTrackUtils.ts'
import { createPlaybackSessionController } from './player/playbackSessionController.ts'
import { createPlaybackClockController } from './player/playbackClockController.ts'
import { evaluateNativePlaybackInfoIntent } from '../utils/nativePlaybackInfoIntent.ts'
import { findNativeQueueTrackIndex } from '../utils/nativeQueueTrackIndex.ts'
import { NativeQueueLoader } from '../utils/nativeQueueLoader.ts'
import { isTrackPlaybackSupported } from '../utils/trackPlaybackSupport.ts'
import { findPlaybackFallbackTrack } from '../utils/playbackFallback.ts'
import { findProviderRematchCandidate } from '../utils/libraryRepair.ts'
import {
  NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS,
  NATIVE_PLAYBACK_INFO_POST_CONFIRMATION_GRACE_MS
} from '../utils/playerConstants.ts'

const source = stripTypeScriptTypes(
  readFileSync(new URL('./usePlayerStore.ts', import.meta.url), 'utf8')
)
function productionFunction(name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'))
  assert.ok(start >= 0)
  const end = source.indexOf('\n}', start)
  assert.ok(end > start)
  return source.slice(start, end + 2)
}

for (const eventOrder of ['info-first', 'start-first']) {
  test(`Native queue ${eventOrder}: playbar retains the incoming source position and keeps advancing`, async (t) => {
    const f = handoffFixture(t)
    f.context.setNativePlaybackInfoIntent(1, f.outgoing, f.outgoing.filePath, 0)
    f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 170))
    f.setNow(16000)
    f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 186))
    const incomingInfo = f.info(f.incoming, 1, 4.18)
    if (eventOrder === 'start-first') f.startFile()
    assert.equal(f.context.applyNativePlaybackInfo(incomingInfo), true)
    if (eventOrder === 'info-first') f.startFile()
    await Promise.resolve()
    assert.equal(f.context.currentTrack.value.id, f.incoming.id)
    assert.equal(f.context.currentTime.value, 4.18)
    assert.equal(f.clock.playbackClockSnapshot.value.trackId, f.incoming.id)
    assert.equal(f.context.duration.value, 257)
    assert.equal(f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 186)), false)
    f.setNow(16300)
    assert.equal(f.context.applyNativePlaybackInfo(f.info(f.incoming, 1, 4.48)), true)
    f.clock.flushLatestCurrentTime()
    assert.ok(Math.abs(f.context.currentTime.value - 4.48) < 0.001)
  })
}

test('confirming ordinary playing ticks cannot prolong the previous-track guard', (t) => {
  const f = handoffFixture(t)
  f.context.setNativePlaybackInfoIntent(1, f.outgoing, f.outgoing.filePath, 0)
  assert.equal(f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 170)), true)
  f.setNow(300)
  assert.equal(f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 170.3)), true)
  assert.equal(f.context.applyNativePlaybackInfo(f.info(f.incoming, 1, 4)), false)
  for (const time of [2300, 2700, 2990]) {
    f.setNow(time)
    assert.equal(f.context.applyNativePlaybackInfo(f.info(f.outgoing, 0, 170 + time / 1000)), true)
  }
  f.setNow(3001)
  assert.equal(f.context.applyNativePlaybackInfo(f.info(f.incoming, 1, 4.2)), true)
})

test('NetEase native windows map opaque grants to the incoming UI track and source clock', async (t) => {
  const f = handoffFixture(t)
  f.outgoing.id = 'ncm:a'
  f.outgoing.filePath = 'ncm:a'
  f.outgoing.streamUrl = 'twilight-media://audio/a'
  f.incoming.id = 'ncm:b'
  f.incoming.filePath = 'ncm:b'
  f.incoming.streamUrl = 'twilight-media://audio/b'
  f.context.queue.value = [
    { id: 'ncm:unresolved', filePath: 'ncm:unresolved' },
    f.outgoing,
    f.incoming
  ]
  f.context.queueIndex.value = 1
  f.context.loadedTrackId = f.outgoing.id
  const loader = new NativeQueueLoader()
  await loader.loadPrepared(
    {
      items: [
        { id: f.outgoing.id, source: f.outgoing.streamUrl },
        { id: f.incoming.id, source: f.incoming.streamUrl }
      ],
      startIndex: 0,
      delegated: false,
      queueIndices: [1, 2]
    },
    { loadQueue: async () => ({ queueToken: 'ncm-window' }) },
    f.context.queue.value
  )
  f.context.nativeQueueLoader = loader
  vm.runInContext(productionFunction('findTrackIndexFromPlaybackInfo'), f.context)
  const info = {
    ...f.info(f.incoming, 1, 4.18),
    source: 'https://cdn.test/b.flac',
    queueToken: 'ncm-window'
  }
  assert.equal(f.context.applyNativePlaybackInfo(info), true)
  assert.equal(f.context.queueIndex.value, 2)
  assert.equal(f.context.currentTrack.value.id, 'ncm:b')
  assert.equal(f.context.currentTime.value, 4.18)
  assert.equal(f.clock.playbackClockSnapshot.value.trackId, 'ncm:b')
})

function handoffFixture(t) {
  const outgoing = {
    id: 'outgoing',
    filePath: 'D:\\Music\\out.flac',
    source: 'local',
    duration: 186
  }
  const incoming = {
    id: 'incoming',
    filePath: 'D:\\Music\\in.flac',
    source: 'local',
    duration: 257
  }
  let now = 0
  const noop = () => {}
  const context = {
    currentTrack: shallowRef(outgoing),
    currentTime: ref(170),
    duration: ref(186),
    queue: shallowRef([outgoing, incoming]),
    queueIndex: ref(0),
    playbackInfo: shallowRef(null),
    loadedTrackId: outgoing.id,
    lastActiveTrack: outgoing,
    nativePlaybackActive: true,
    isPlaying: ref(true),
    isLoading: ref(false),
    playMode: ref('sequential'),
    restoredPlaybackPending: false,
    nativePlaybackInfoIntent: null,
    intentionalTrackGuard: null,
    playbackToggleIntent: null,
    pendingLoadStartTime: 0,
    nativeHistoryRestartPending: false,
    activeLoadToken: 1,
    sourceRecoveryDisabledLoadToken: null,
    streamNowPlaying: ref(''),
    startFilePlaybackInfoRefreshGeneration: 0,
    NATIVE_PLAYBACK_INFO_INTENT_GRACE_MS,
    NATIVE_PLAYBACK_INFO_POST_CONFIRMATION_GRACE_MS,
    getNowMs: () => now,
    getTrackAudioSource: (track) => track.filePath,
    evaluateNativePlaybackInfoIntent,
    normalizeNativePlaybackInfo: (info) => info,
    findTrackIndexFromPlaybackInfo: (info) =>
      findNativeQueueTrackIndex(
        context.queue.value,
        context.queueIndex.value,
        info,
        undefined,
        true
      ),
    mergeTrackTransientData: (track) => track,
    toPlaybackQueueSnapshot: (track) => track,
    hydratePlaybackTrack: (track) => track,
    nonEmptyString: (value) => value || '',
    lyricsLoader: { ensureCurrentTrackLyricsLoaded: noop },
    cueDuration: (track) => track.duration,
    clearAbLoop: noop,
    applyNativePlayingState: noop,
    applyNativeStreamBufferingFromInfo: noop,
    playbackHistoryController: { recordPlaybackStart: noop },
    scheduleCrossfadeIfNeeded: noop,
    clearPendingNativePause: noop,
    setPlaybackToggleIntent: noop,
    // The real snapshot already precedes start-file; isolate the event's immediate
    // effect so an asynchronous refresh cannot hide a destructive clock reset.
    refreshPlaybackInfoAfterStartFile: async () => {},
    window: { setTimeout, clearTimeout, setInterval, clearInterval }
  }
  const previousWindow = globalThis.window
  globalThis.window = context.window
  const clock = createPlaybackClockController({
    currentTrack: context.currentTrack,
    currentTime: context.currentTime,
    duration: context.duration,
    playbackRate: ref(1),
    isPlaying: context.isPlaying,
    isLoading: context.isLoading,
    abLoopA: ref(null),
    abLoopB: ref(null),
    playMode: context.playMode,
    getNow: () => now,
    getPlaybackToggleIntent: () => null,
    getAbLoopNativeActive: () => false,
    enforceAbLoop: noop,
    isCurrentTrackLiveStream: () => false,
    applyNativePlaybackInfo: (info) => context.applyNativePlaybackInfo(info)
  })
  Object.assign(context, clock)
  t.after(() => {
    clock.dispose()
    globalThis.window = previousWindow
  })
  vm.createContext(context)
  for (const name of [
    'setNativePlaybackInfoIntent',
    'clearNativePlaybackInfoIntent',
    'markNativePlaybackInfoIntentConfirmed',
    'shouldIgnoreNativePlaybackInfo',
    'applyNativePlaybackInfo'
  ])
    vm.runInContext(productionFunction(name), context)
  const registration = source.match(/api\.onStartFile\(\(\) => \{[\s\S]*?\n    \}\)/)?.[0]
  assert.ok(registration)
  let startFile
  context.api = {
    onStartFile: (callback) => {
      startFile = callback
    }
  }
  vm.runInContext(registration, context)
  clock.beginPlaybackPositionTransition(170)
  return {
    context,
    clock,
    outgoing,
    incoming,
    startFile,
    setNow: (value) => {
      now = value
    },
    info: (track, index, position) => ({
      source: track.filePath,
      queueIndex: index,
      position,
      duration: track.duration,
      state: 'playing',
      nativePlaybackActive: true
    })
  }
}

test('a missing non-NetEase provider cache is re-resolved with force instead of replayed', async () => {
  const calls = []
  const track = { id: 'demo:one', source: 'demo', streamUrl: 'D:\\Cache\\removed.flac' }
  const context = {
    window: { api: { fs: { isAudioFileAuthorized: async () => false } } },
    getTrackSource,
    isLikelyLocalFilePath,
    isTrackPlaybackSupported,
    shouldReuseResolvedStreamUrl: () => true,
    syncPluginProviders: async () => {},
    appSettings: ref({ ncmPlaybackQuality: 'lossless' }),
    useMediaProviders: () => ({
      resolvePlaybackUrl: async (_, options) => {
        calls.push(options)
        return 'https://media.example/fresh.flac'
      }
    })
  }
  vm.createContext(context)
  vm.runInContext(
    productionFunction('isUsableLocalPlaybackFile') + productionFunction('resolvePlayTarget'),
    context
  )
  assert.equal(await context.resolvePlayTarget(track), 'https://media.example/fresh.flac')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].force, true)
})

test('unavailable targets reach source recovery without being labeled an engine outage', async () => {
  const f = loadFixture()
  await f.context.loadAndPlay(f.track)
  assert.equal(f.fallbacks.length, 1)
  assert.match(presentError('zh-CN', f.errors[0]), /播放地址/)
  assert.doesNotMatch(presentError('zh-CN', f.errors[0]), /引擎不可用|Native playback/)
  assert.equal(f.context.isLoading.value, false)
  assert.equal(f.context.isPlaying.value, false)
  assert.equal(f.context.autoAdvanceInFlight, false)
})

test('a rejected recovery settles playback and retains the original failure', async () => {
  const f = loadFixture({
    fallback: async () => {
      throw new Error('rematch unavailable')
    }
  })
  await assert.doesNotReject(f.context.loadAndPlay(f.track))
  assert.equal(f.fallbacks.length, 1)
  assert.equal(f.context.isLoading.value, false)
  assert.equal(f.context.isPlaying.value, false)
  assert.match(presentError('zh-CN', f.errors[0]), /播放地址/)
})

test('queue IPC failures retain output fallback without attempting source recovery', async () => {
  const f = loadFixture()
  f.context.nativeQueueLoader.prepareAndLoad = async () => {
    throw new Error('native queue IPC unavailable')
  }
  await f.context.loadAndPlay(f.track)
  assert.equal(f.fallbacks.length, 0)
  assert.match(f.errors[0], /native queue IPC unavailable/)
  assert.equal(f.context.isLoading.value, false)
  assert.equal(f.context.isPlaying.value, false)
})

test('an older failed load cannot clear a newer load after waiting for source recovery', async () => {
  let release, notify
  const started = new Promise((resolve) => {
    notify = resolve
  })
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = loadFixture({
    fallback: () => {
      notify()
      return gate
    }
  })
  f.context.resolvePlayTarget = async () => {
    throw new Error('original source unavailable')
  }
  const pending = f.context.loadAndPlay(f.track)
  await started
  f.context.activeLoadToken++
  f.context.currentTrack.value = { ...f.track, id: 'local:new' }
  f.context.isLoading.value = true
  f.context.isPlaying.value = true
  release(false)
  await pending
  assert.equal(f.context.isLoading.value, true)
  assert.equal(f.context.isPlaying.value, true)
  assert.deepEqual(f.errors, [])
})

test('a terminal provider failure across IPC stops the request without rematching or changing identity', async () => {
  const reason = 'QQ 音乐音频服务器返回 HTTP 403，当前歌曲的候选音质均不可播放'
  const terminal = ipcError('provider.playbackUnavailable', 'Playback unavailable', { reason })
  const failure = new Error(
    `Error invoking remote method 'providers:call': Error: ${terminal.message}`
  )
  const f = sourceRecoveryFixture(failure, true)
  const before = JSON.stringify({
    current: f.context.currentTrack.value,
    queue: f.context.queue.value,
    original: f.context.originalQueue.value,
    index: f.context.queueIndex.value
  })

  await f.context.loadAndPlay(f.track)

  assert.deepEqual(f.calls, { resolutions: 1, queueSearches: 0, searches: 0, replacements: 0 })
  assert.equal(
    JSON.stringify({
      current: f.context.currentTrack.value,
      queue: f.context.queue.value,
      original: f.context.originalQueue.value,
      index: f.context.queueIndex.value
    }),
    before
  )
  assert.equal(f.context.currentTrack.value.queueEntryId, 'selected-entry')
  assert.equal(f.context.isLoading.value, false)
  assert.equal(f.context.isPlaying.value, false)
  assert.equal(f.context.autoAdvanceInFlight, false)
  assert.equal(f.context.nativePlaybackActive, false)
  assert.equal(f.context.nativeQueueDelegated, false)
  assert.deepEqual(f.errors, [reason])
  assert.doesNotMatch(f.errors[0], /Error invoking|TE-ERR|登录状态已失效/)
})

test('unmarked legacy provider failures keep the existing source recovery path', async () => {
  const f = sourceRecoveryFixture(new Error('Legacy source unavailable'))
  await f.context.loadAndPlay(f.track)
  assert.deepEqual(f.calls, { resolutions: 1, queueSearches: 1, searches: 1, replacements: 0 })
  assert.equal(f.context.currentTrack.value.id, f.track.id)
  assert.equal(f.context.isLoading.value, false)
  assert.equal(f.context.isPlaying.value, false)
  assert.equal(f.context.autoAdvanceInFlight, false)
  assert.deepEqual(f.errors, ['Legacy source unavailable'])
})

test('terminal provider reasons retain phase details in every locale instead of HTTP login guesses', () => {
  const reason = 'Audio issuer refused quality 12 (403)'
  const failure = ipcError('provider.playbackUnavailable', 'Playback unavailable', { reason })
  for (const locale of ['zh-CN', 'en-US']) assert.equal(presentError(locale, failure), reason)
})

function sourceRecoveryFixture(failure, matchingVersions = false) {
  const f = loadFixture()
  Object.assign(f.track, {
    id: 'qq:public-a:1',
    source: 'qq',
    filePath: 'qq:public-a:1',
    title: 'Same Blue',
    artist: 'Official髭男dism',
    album: 'Same Blue',
    duration: 237,
    queueEntryId: 'selected-entry'
  })
  const alternative = { ...f.track, id: 'qq:public-b:2', filePath: 'qq:public-b:2' }
  const calls = { resolutions: 0, queueSearches: 0, searches: 0, replacements: 0 }
  Object.assign(f.context, {
    Error,
    originalQueue: ref([f.track]),
    sourceRecoveryDisabledLoadToken: null,
    nativeQueueDelegated: false,
    currentLocale: () => 'zh-CN',
    presentError,
    resolvePlayTarget: async () => {
      calls.resolutions++
      throw failure
    },
    findPlaybackFallbackTrack: (options) => {
      calls.queueSearches++
      return findPlaybackFallbackTrack(options)
    },
    findProviderRematchCandidate,
    getProviderSourceReliability: () => ({}),
    syncPluginProviders: async () => {},
    useMediaProviders: () => ({
      searchAllSongs: async () => {
        calls.searches++
        // Bound the fixture's counterexample if a regression reintroduces the
        // production A -> B -> A rematch cycle. The expected search count is 0.
        return {
          items:
            matchingVersions && calls.searches <= 4
              ? [{ track: f.track }, { track: alternative }]
              : []
        }
      }
    }),
    toPlaybackQueueSnapshot: (track) => ({ ...track }),
    useMusicStore: () => ({ replaceTrackReference: () => calls.replacements++ }),
    setAudioEngineError: (error) => f.errors.push(f.context.resolveAudioEngineErrorText(error))
  })
  for (const name of [
    'handlePlaybackFallback',
    'handleProviderRematchFallback',
    'resolveAudioEngineErrorText'
  ])
    vm.runInContext(productionFunction(name), f.context)
  return { ...f, calls }
}

function loadFixture({ fallback = async () => false } = {}) {
  const track = { id: 'local:one', source: 'local', filePath: 'D:\\Music\\one.flac', duration: 180 }
  const errors = [],
    fallbacks = []
  const noop = () => {}
  const context = {
    ipcError,
    parseAppError,
    translate,
    currentLocale: () => 'zh-CN',
    getTrackSource,
    isTrackPlaybackSupported,
    currentTrack: ref(track),
    queue: ref([track]),
    queueIndex: ref(0),
    lastActiveTrack: null,
    activeLoadToken: 0,
    playMode: ref('sequential'),
    playbackRate: ref(1),
    isLoading: ref(false),
    isPlaying: ref(true),
    duration: ref(180),
    streamNowPlaying: ref(''),
    playbackAudio: null,
    autoAdvanceInFlight: true,
    appSettings: ref({ ncmPlaybackQuality: 'lossless' }),
    ncmStreamUrlCommittedAt: new Map(),
    nativeSourceToTrackId: new Map(),
    playbackHistoryController: { beginPlaybackAttempt: noop, clearResumeOfferForOtherTrack: noop },
    playbackSessionController: { clearPendingPlaybackPosition: noop },
    clampCuePlaybackPosition: (_, time) => time,
    cueDuration: (item) => item.duration,
    stopNativeAudio: async () => {},
    resolvePlayTarget: async (item) => item.filePath,
    isActiveLoad: (token, item) =>
      token === context.activeLoadToken && item.id === context.currentTrack.value.id,
    shouldUseNativePlayback: () => true,
    stripStaleNcmStreamUrls: (items) => items,
    nativeQueueLoader: { prepareAndLoad: async () => null },
    handlePlaybackFallback: async (...args) => {
      fallbacks.push(args)
      return fallback(...args)
    },
    setAudioEngineError: (error) => errors.push(error),
    window: { api: { fs: {}, audioEngine: { isHtmlAudioFallbackAllowed: async () => false } } },
    console: { warn: noop, error: noop }
  }
  for (const name of [
    'clearPlaybackToggleIntent',
    'setNativePlaybackInfoIntent',
    'stopVisualizationPolling',
    'resetNativeStreamBufferingState',
    'stopRendererAudio',
    'beginPlaybackPositionTransition',
    'clearAbLoop',
    'clearCrossfadeTimer',
    'patchTrackInQueues',
    'clearNativePlaybackInfoIntentForLoad'
  ])
    context[name] = noop
  vm.createContext(context)
  vm.runInContext(productionFunction('loadAndPlay'), context)
  return { context, track, errors, fallbacks }
}

for (const direction of ['next', 'previous']) {
  for (const stage of ['queue', 'advance', 'info']) {
    test(`${direction}: restoring a paused selection cancels stale work during ${stage}`, async () => {
      const f = fixture(stage)
      const pending = f.advanceNativePlayback(direction)
      await f.started
      f.controller.prepareQueueSelection(f.track('restored-session'), 37)
      f.release()
      await pending
      assert.deepEqual(f.loads, [])
      assert.equal(f.isPlaying.value, false)
      assert.equal(f.currentTrack.value.id, 'restored-session')
      assert.equal(f.isLoading.value, false)
      assert.equal(f.visualizationStarts(), 0)
    })
  }
}

test('a current native advance still reloads its predicted track when no native confirmation arrives', async () => {
  const f = fixture('advance')
  const pending = f.advanceNativePlayback('next')
  await f.started
  f.release()
  await pending
  assert.deepEqual(f.loads, ['old-B'])
  assert.equal(f.isPlaying.value, true)
})

function fixture(stage) {
  const track = (id) => ({
    id,
    queueEntryId: id,
    title: id,
    artist: '',
    album: '',
    source: 'local',
    filePath: `/Music/${id}.flac`,
    fileName: `${id}.flac`,
    duration: 180,
    size: 1,
    cover: null,
    lyrics: null
  })
  const currentTrack = shallowRef(track('old-A'))
  const isPlaying = ref(true)
  const isLoading = ref(false)
  const queueIndex = ref(0)
  const duration = ref(180)
  let release
  let notify
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    notify = resolve
  })
  const wait = async (at) => {
    if (stage === at) {
      notify()
      await gate
    }
  }
  const loads = []
  const windowStub = {
    setTimeout: (callback) => setTimeout(callback, 0),
    api: {
      audioEngine: {
        next: () => wait('advance'),
        previous: () => wait('advance'),
        getPlaybackInfo: async () => {
          await wait('info')
          return { state: 'stopped' }
        }
      }
    }
  }
  const harness = new Function(
    'refs',
    'createPlaybackSessionController',
    'window',
    'loads',
    'track',
    'wait',
    `
    const { currentTrack, isPlaying, isLoading, queueIndex, duration } = refs;
    let activeLoadToken = 1, nativePlaybackActive = true, nativeQueueDelegated = true, restoredPlaybackPending = false;
    let startFilePlaybackInfoRefreshGeneration = 0, loadedTrackId = 'old-A', visualizationStarts = 0;
    const nativeQueueRevisionFence = { next() {} }, nativeSourceToTrackId = new Map(), playbackInfo = { value: null }, castTargetUsn = { value: null };
    const NATIVE_PLAYBACK_INFO_REFRESH_DELAY_MS = 0;
    const clearPlaybackToggleIntent = () => {}, setNativePlaybackInfoIntent = () => {}, clearNativePlaybackInfoIntent = () => {};
    const resetPlaybackClock = () => {}, resetNativeStreamBufferingState = () => {}, stopVisualizationPolling = () => {}, stopRendererAudio = () => {}, stopNativeAudio = async () => {};
    const startVisualizationPolling = () => { visualizationStarts++ }, setAudioEngineError = error => { throw new Error(error) };
    const getNativeQueueAdvanceTarget = () => ({ track: track('old-B'), queueIndex: 1 });
    const getTrackAudioSource = track => track.filePath;
    const activateCurrentTrack = track => { currentTrack.value = track };
    const waitForNativeQueueStateSync = () => wait('queue');
    const findTrackIndexFromPlaybackInfo = () => -1, shouldIgnoreNativePlaybackInfo = () => true;
    const loadAndPlay = async selected => { loads.push(selected.id); isPlaying.value = true; };
    ${productionFunction('resetPlaybackRuntimeStateForRestore')}
    ${productionFunction('applyNativePlaybackInfo')}
    ${productionFunction('advanceNativePlayback')}
    const controller = createPlaybackSessionController({
      currentTrack, duration, isPlaying, isLoading, resetPlaybackRuntimeStateForRestore,
      clearCrossfadeTimer() {}, hydratePlaybackTrack: value => value,
      setRestoredPlaybackPending: value => { restoredPlaybackPending = value },
      setRestoredPlaybackPosition() {}, setPendingLoadStartTime() {}, setAutoAdvanceInFlight() {},
      setAdvancingFromEndedTrackId() {}, setCurrentTimeImmediate() {}, loadLyricsForTrack() {}
    });
    return { advanceNativePlayback, controller, visualizationStarts: () => visualizationStarts };
  `
  )(
    { currentTrack, isPlaying, isLoading, queueIndex, duration },
    createPlaybackSessionController,
    windowStub,
    loads,
    track,
    wait
  )
  return { ...harness, loads, started, release, currentTrack, isPlaying, isLoading, track }
}
