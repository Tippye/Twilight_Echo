import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AFTERGLOW_RESTORE_ACCELERATOR,
  AFTERGLOW_RESTORE_ACCELERATORS,
  afterglowTransportCommandForAction,
  describeAfterglowError,
  isAfterglowPlayableSource,
  isAfterglowRendererRestore,
  parseAfterglowRendererSnapshot,
  resolveAfterglowEngineMapping,
  resolveAfterglowQueueIndex,
  toRendererFreePlayMode
} from './afterglowMode.ts'

const localTrack = (index: number) => ({
  id: `local:${index}`,
  filePath: `D:/Music/${index}.flac`,
  title: `Track ${index}`,
  duration: 240
})

test('renderer restore flag only accepts the explicit query value', () => {
  assert.equal(isAfterglowRendererRestore('?afterglowRestore=1'), true)
  assert.equal(isAfterglowRendererRestore('?window=mini-player&afterglowRestore=1'), true)
  assert.equal(isAfterglowRendererRestore('?afterglowRestore=0'), false)
  assert.equal(isAfterglowRendererRestore('?afterglowRestore'), false)
  assert.equal(isAfterglowRendererRestore(''), false)
  assert.equal(AFTERGLOW_RESTORE_ACCELERATOR, 'CommandOrControl+Shift+E')
})

test('engine sources stay playable without the renderer when local or plain http(s)', () => {
  // CUE entries point at the local cue file; the engine slices it natively.
  assert.equal(isAfterglowPlayableSource('D:\\Music\\album.cue'), true)
  assert.equal(isAfterglowPlayableSource('D:/Music/song.flac'), true)
  assert.equal(isAfterglowPlayableSource('\\\\nas\\share\\song.flac'), true)
  assert.equal(isAfterglowPlayableSource('/home/user/song.flac'), true)
  assert.equal(isAfterglowPlayableSource('file:///D:/Music/song.flac'), true)
  // Online queues are best-effort: a plain CDN URL is fine while it stays valid.
  assert.equal(isAfterglowPlayableSource('https://cdn.example/song.mp3'), true)
  assert.equal(isAfterglowPlayableSource('http://stream.example/live'), true)
  // Session-scoped grants and renderer-only URLs die with the renderer.
  assert.equal(isAfterglowPlayableSource('twilight-media://audio/token'), false)
  assert.equal(isAfterglowPlayableSource('twilight-audio://local/abc'), false)
  assert.equal(isAfterglowPlayableSource('blob:https://x/y'), false)
  assert.equal(isAfterglowPlayableSource('data:audio/mp3;base64,xx'), false)
  assert.equal(isAfterglowPlayableSource('rtmp://example/live'), false)
  assert.equal(isAfterglowPlayableSource(''), false)
  assert.equal(isAfterglowPlayableSource(null), false)
})

test('engine status maps onto the persisted queue by index, then by path', () => {
  const queue = [localTrack(0), localTrack(1), localTrack(2)]
  assert.equal(resolveAfterglowQueueIndex(queue, { queueIndex: 1, source: 'D:/Music/1.flac' }), 1)
  // Native index drifted (e.g. a partial queue): match the source path instead.
  assert.equal(resolveAfterglowQueueIndex(queue, { queueIndex: 0, source: 'D:/Music/2.flac' }), 2)
  assert.equal(
    resolveAfterglowQueueIndex(queue, {
      queueIndex: -1,
      source: 'D:\\Music\\1.flac'
    }),
    1,
    'Windows separators must not break the fallback'
  )
  assert.equal(resolveAfterglowQueueIndex(queue, { queueIndex: 7, source: '' }), -1)
  assert.equal(resolveAfterglowQueueIndex(queue, { queueIndex: -1, source: '' }), -1)
  assert.equal(resolveAfterglowQueueIndex(queue, { queueIndex: 9, source: 'D:/Music/0.flac' }), 0)
})

test('renderer-free play mode never asks the engine for renderer-only modes', () => {
  assert.equal(toRendererFreePlayMode('repeat'), 'repeat')
  assert.equal(toRendererFreePlayMode('listLoop'), 'listLoop')
  assert.equal(toRendererFreePlayMode('shuffle'), 'listLoop')
  assert.equal(toRendererFreePlayMode('heart'), 'sequential')
  assert.equal(toRendererFreePlayMode('sequential'), 'sequential')
  assert.equal(toRendererFreePlayMode('unknown'), 'sequential')
})

test('restore accelerators keep distinct fallbacks and the preferred one first', () => {
  assert.equal(AFTERGLOW_RESTORE_ACCELERATORS[0], AFTERGLOW_RESTORE_ACCELERATOR)
  assert.equal(new Set(AFTERGLOW_RESTORE_ACCELERATORS).size, AFTERGLOW_RESTORE_ACCELERATORS.length)
  assert.ok(AFTERGLOW_RESTORE_ACCELERATORS.length >= 2)
})

test('shortcut actions translate to renderer-free transport commands', () => {
  assert.deepEqual(afterglowTransportCommandForAction('playPause'), { type: 'toggle-play' })
  assert.deepEqual(afterglowTransportCommandForAction('play'), { type: 'play' })
  assert.deepEqual(afterglowTransportCommandForAction('pause'), { type: 'pause' })
  assert.deepEqual(afterglowTransportCommandForAction('previous'), { type: 'previous' })
  assert.deepEqual(afterglowTransportCommandForAction('next'), { type: 'next' })
  assert.deepEqual(afterglowTransportCommandForAction('stop'), { type: 'stop' })
  assert.deepEqual(afterglowTransportCommandForAction('volumeUp'), {
    type: 'volume-step',
    delta: 0.05
  })
  assert.deepEqual(afterglowTransportCommandForAction('volumeDown'), {
    type: 'volume-step',
    delta: -0.05
  })
  assert.deepEqual(afterglowTransportCommandForAction('toggleMute'), { type: 'toggle-mute' })
  assert.deepEqual(afterglowTransportCommandForAction('bossKey'), { type: 'toggle-mute' })
  assert.deepEqual(afterglowTransportCommandForAction('seekBackward'), {
    type: 'seek-by',
    deltaSeconds: -10
  })
  assert.deepEqual(afterglowTransportCommandForAction('seekForward'), {
    type: 'seek-by',
    deltaSeconds: 10
  })
  assert.deepEqual(afterglowTransportCommandForAction('speedUp'), { type: 'rate-step', delta: 0.1 })
  assert.deepEqual(afterglowTransportCommandForAction('cycleRepeatMode'), {
    type: 'cycle-play-mode'
  })
  // Actions that need the renderer must restore before doing anything else.
  assert.equal(afterglowTransportCommandForAction('toggleCurrentTrackLiked'), null)
  assert.equal(afterglowTransportCommandForAction('toggleDesktopLyrics'), null)
  assert.equal(afterglowTransportCommandForAction('unknown'), null)
})

test('renderer snapshot validation accepts a sane queue and rejects malformed payloads', () => {
  const queue = [localTrack(0), localTrack(1)]
  const valid = {
    queue,
    queueIndex: 1,
    track: queue[1],
    position: 12.5,
    playMode: 'listLoop',
    volume: 0.7,
    playbackRate: 1
  }
  assert.deepEqual(parseAfterglowRendererSnapshot(valid), valid)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, queue: [] }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, queueIndex: 5 }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, queueIndex: -1 }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, queueIndex: 0.5 }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, track: null }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, track: { title: 'x' } }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, position: -1 }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, volume: 1.5 }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, playbackRate: 4 }), null)
  assert.equal(parseAfterglowRendererSnapshot(null), null)
  // Play mode is optional and defaults to sequential instead of rejecting.
  const withoutMode = parseAfterglowRendererSnapshot({ ...valid, playMode: undefined })
  assert.equal(withoutMode?.playMode, 'sequential')
  // Windowed queues carry a native→logical mapping; it must stay in range.
  const mapped = parseAfterglowRendererSnapshot({ ...valid, nativeQueueIndices: [1, 0] })
  assert.deepEqual(mapped?.nativeQueueIndices, [1, 0])
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, nativeQueueIndices: [0, 5] }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, nativeQueueIndices: [] }), null)
  assert.equal(parseAfterglowRendererSnapshot({ ...valid, nativeQueueIndices: [0, 0.5] }), null)
})

test('engine queue entries map back onto logical indices for windowed queues', () => {
  const queue = [localTrack(0), localTrack(1), localTrack(2), localTrack(3)]
  // Full delegation keeps identity.
  assert.deepEqual(
    resolveAfterglowEngineMapping(
      queue,
      queue.map((track) => ({ id: track.id, source: track.filePath }))
    ),
    [0, 1, 2, 3]
  )
  // Renderer-provided mapping wins (duplicate CUE entries share ids/paths).
  assert.deepEqual(
    resolveAfterglowEngineMapping(queue, [{ id: 'local:2', source: 'D:/Music/2.flac' }], [2]),
    [2]
  )
  // Current+next window without a provided mapping: match by id, then path.
  assert.deepEqual(
    resolveAfterglowEngineMapping(queue, [
      { id: 'local:2', source: 'https://cdn.example/cached.flac' },
      { id: 'missing', source: 'D:/Music/3.flac' }
    ]),
    [2, 3]
  )
  // Unknown entries stay -1 so restore can skip them.
  assert.deepEqual(
    resolveAfterglowEngineMapping(queue, [{ id: 'unknown', source: 'https://cdn.example/x' }]),
    [-1]
  )
  // Out-of-range provided mappings are ignored and recomputed.
  assert.deepEqual(
    resolveAfterglowEngineMapping(queue, [{ id: 'local:0', source: 'D:/Music/0.flac' }], [9]),
    [0]
  )
})

test('rejection codes have readable explanations and unknown codes pass through', () => {
  assert.equal(
    describeAfterglowError('afterglow_requires_fully_local_queue'),
    '队列里有无法在后台继续的音源'
  )
  assert.equal(
    describeAfterglowError('afterglow_requires_fully_local_queue:3'),
    '队列里有无法在后台继续的音源（队列第 4 首）'
  )
  assert.equal(
    describeAfterglowError('afterglow_requires_fully_delegated_queue:1/42'),
    '队列还没有完整交给原生引擎（1/42 首）'
  )
  assert.equal(
    describeAfterglowError('afterglow_requires_mappable_current_track'),
    '无法把当前播放映射回队列'
  )
  assert.equal(
    describeAfterglowError('afterglow_restore_shortcut_unavailable'),
    '恢复快捷键都被占用了'
  )
  assert.equal(describeAfterglowError('afterglow_restore_window_timeout'), '恢复窗口超时')
  // Suffix detail (e.g. an IPC code) must not hide the base message.
  assert.equal(
    describeAfterglowError('afterglow_requires_native_engine:svc-down'),
    '原生音频引擎尚未就绪'
  )
  assert.equal(describeAfterglowError(null), '')
  assert.equal(describeAfterglowError('some_new_code'), 'some_new_code')
})
