import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { ref, shallowRef } from 'vue'
import type { Track } from '../types/music'
import type { PlayMode } from '../types/settings'
import { isSavedQueueTrack } from '../../../shared/queueWorkspace.ts'
import { cloneTrackForPlaybackSession, cloneTrackForPlaybackQueue } from './playerSessionTrack.ts'
import { saveQueueTrack, restoreQueueTrackIdentity } from './queueSessionTrack.ts'
import { captureQueueSession } from './queueSessionTrack.ts'
import {
  toPlaybackQueueSnapshot,
  createPlaybackQueueSnapshotCache
} from './playbackQueueVirtualization.ts'
import { resolveQueueSession } from '../stores/player/queueSessionRestore.ts'
import { toPlaylistTrackSnapshot } from '../stores/library/musicStoreData.ts'
import { createPlaybackSelectionController } from '../stores/player/playbackSelectionController.ts'
import { createQueueCommandController } from '../stores/player/queueCommandController.ts'
import {
  createPlaybackQueueController,
  type PersonalizedStreamSession
} from '../stores/player/playbackQueueController.ts'
import {
  filterPlaybackSupportedTracks,
  isTrackPlaybackSupported,
  UNSUPPORTED_TRACK_PLAYBACK_MESSAGE
} from './trackPlaybackSupport.ts'

const track = (id: string, unsupported = false): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  source: 'example-provider',
  filePath: '',
  fileName: id,
  duration: 10,
  size: 0,
  cover: null,
  lyrics: null,
  ...(unsupported ? { playbackStatus: 'unsupported' as const } : {})
})

test('unsupported metadata survives session and saved-queue round trips without changing omitted status', () => {
  const item = track('provider:unavailable', true)
  for (const clone of [cloneTrackForPlaybackSession(item), cloneTrackForPlaybackQueue(item)]) {
    assert.equal(clone.playbackStatus, 'unsupported')
    assert.equal(clone.title, item.title)
  }
  const saved = saveQueueTrack(item)
  assert.equal(isSavedQueueTrack(saved), true)
  assert.equal(
    restoreQueueTrackIdentity(JSON.parse(JSON.stringify(saved))).playbackStatus,
    'unsupported'
  )
  for (const status of ['deleted', 'rights', null, true, 0]) {
    assert.equal(isSavedQueueTrack({ ...saved, playbackStatus: status }), false)
  }
  assert.equal(Object.hasOwn(saveQueueTrack(track('ordinary')), 'playbackStatus'), false)
  assert.equal(
    Object.hasOwn(cloneTrackForPlaybackSession(track('ordinary')), 'playbackStatus'),
    false
  )
})

test('actual compact queue, playlist and restored-session snapshots retain unsupported status', async () => {
  const item = { ...track('unavailable', true), queueEntryId: 'queue:unavailable' }
  assert.equal(toPlaybackQueueSnapshot(item).playbackStatus, 'unsupported')
  assert.equal(toPlaylistTrackSnapshot(item).playbackStatus, 'unsupported')
  const restored = await resolveQueueSession(
    captureQueueSession('public fixture', [item], [item], item, 0, 'sequential'),
    {
      localTracks: new Map(),
      savedStreams: new Map(),
      availableProviders: new Set(['example-provider']),
      networkProfiles: new Set(),
      authorizeFiles: async () => [],
      isCurrent: () => true
    }
  )
  assert.equal(restored.queue[0].playbackStatus, 'unsupported')
  const mutable = track('state changes')
  const entries = [mutable]
  const snapshots = createPlaybackQueueSnapshotCache()
  const previous = snapshots(entries)
  mutable.playbackStatus = 'unsupported'
  const changed = snapshots(entries)
  assert.notEqual(changed, previous)
  assert.equal(changed[0].playbackStatus, 'unsupported')
})

test('cold saved queues retain detached public album and artist identities', async () => {
  const item: Track = {
    ...track('provider:public-song'),
    queueEntryId: 'public-entry',
    albumId: 'provider:album:public-id',
    artists: [{ id: 'provider:artist:public-id', name: 'Artist' }, { name: 'Unknown identity' }]
  }
  const saved = JSON.parse(
    JSON.stringify(captureQueueSession('public fixture', [item], [item], item, 7, 'sequential'))
  )
  const restored = await resolveQueueSession(saved, {
    localTracks: new Map(),
    savedStreams: new Map(),
    availableProviders: new Set(['example-provider']),
    networkProfiles: new Set(),
    authorizeFiles: async () => [],
    isCurrent: () => true
  })
  for (const snapshot of [
    restored.queue[0],
    cloneTrackForPlaybackSession(item),
    cloneTrackForPlaybackQueue(item),
    toPlaybackQueueSnapshot(item),
    toPlaylistTrackSnapshot(item)
  ]) {
    assert.equal(snapshot.albumId, item.albumId)
    assert.deepEqual(snapshot.artists, item.artists)
    assert.notEqual(snapshot.artists, item.artists)
    assert.notEqual(snapshot.artists![0], item.artists![0])
    snapshot.artists![0].name = 'Detached'
    assert.equal(item.artists![0].name, 'Artist')
  }
  assert.equal(restored.position, 7)
  const valid = saveQueueTrack(item)
  for (const albumId of ['', ' ', 'public\0id', 'a'.repeat(8193), 1, null]) {
    assert.equal(isSavedQueueTrack({ ...valid, albumId }), false)
    assert.equal(cloneTrackForPlaybackSession({ ...item, albumId } as Track).albumId, undefined)
  }
  for (const artists of [
    null,
    new Array(1),
    [{ name: 1 }],
    [{ name: 'Artist', id: {} }],
    [{ name: 'Artist', id: Number.MAX_SAFE_INTEGER + 1 }],
    Array(129).fill({ name: 'Artist' })
  ]) {
    assert.equal(isSavedQueueTrack({ ...valid, artists }), false)
    assert.equal(saveQueueTrack({ ...item, artists } as Track).artists, undefined)
  }
  const extra = { ...item, artists: [{ id: 'public-id', name: 'Artist', unused: 'not persisted' }] }
  assert.deepEqual(saveQueueTrack(extra).artists, [{ id: 'public-id', name: 'Artist' }])
  const cache = createPlaybackQueueSnapshotCache()
  const rows = [item]
  const previous = cache(rows)
  item.albumId = 'provider:album:changed'
  assert.notEqual(cache(rows), previous)
  const beforeArtistChange = cache(rows)
  item.artists![0].id = 'provider:artist:changed'
  assert.notEqual(cache(rows), beforeArtistChange)
})

test('playable selection retains duplicate order and leaves the displayed metadata list intact', () => {
  const first = track('same')
  const second = { ...first, title: 'second duplicate' }
  const blocked = track('blocked', true)
  const displayed = [blocked, first, second]
  assert.deepEqual(filterPlaybackSupportedTracks(displayed), [first, second])
  assert.equal(displayed.length, 3)
  const supported = [first, second]
  assert.equal(filterPlaybackSupportedTracks(supported), supported)
  assert.equal(isTrackPlaybackSupported(blocked), false)
  const queue = shallowRef<Track[]>([])
  const queueIndex = ref(-1)
  const skipped: number[] = []
  const activated: Track[] = []
  const loaded: Track[] = []
  let contexts = 0
  const controller = createPlaybackSelectionController({
    queue,
    queueIndex,
    playMode: ref('sequential'),
    setHeartModeContext: () => {
      contexts++
    },
    exitHeartModeForManualQueueReplacement: () => {},
    isPersonalizedStreamTrack: () => false,
    endPersonalizedStream: () => {},
    activateCurrentTrack: (item) => {
      activated.push(item)
    },
    loadAndPlay: async (item) => {
      loaded.push(item)
    },
    replaceQueue: (items, index) => {
      queue.value = items
      queueIndex.value = index
    },
    onSkippedTracks: (count) => {
      skipped.push(count)
    }
  })
  controller.playTrack(second, displayed)
  assert.deepEqual(
    queue.value.map((item) => item.title),
    [first.title, second.title]
  )
  assert.equal(loaded[0].queueEntryId, queue.value[1].queueEntryId)
  assert.deepEqual(skipped, [1])
  const previousQueue = queue.value
  controller.playTrack(blocked, displayed)
  controller.playTrackFromPosition(blocked, 5)
  assert.equal(queue.value, previousQueue)
  assert.equal(activated.length, 1)
  assert.equal(loaded.length, 1)
  assert.equal(contexts, 1)
  assert.deepEqual(skipped, [1, 1, 1])
})

test('queue add and replacement exclude unsupported entries before selection and report skipped counts', () => {
  const queue = shallowRef<Track[]>([])
  const originalQueue = shallowRef<Track[]>([])
  const currentTrack = shallowRef<Track | null>(null)
  const queueIndex = ref(-1)
  const skipped: number[] = []
  let commits = 0
  const commands = createQueueCommandController({
    queue,
    originalQueue,
    currentTrack,
    queueIndex,
    playMode: ref('sequential'),
    getPosition: () => 0,
    prepareSelection: (item) => {
      currentTrack.value = item
    },
    onMutation: () => {
      commits++
    },
    onSkippedTracks: (count) => {
      skipped.push(count)
    }
  })
  const blocked = track('blocked', true)
  assert.deepEqual(commands.add([blocked], 0, 0), [])
  assert.equal(commits, 0)
  assert.equal(commands.canUndo.value, false)
  const first = track('first')
  const second = track('second')
  const additions = commands.add([blocked, first], 0, 0)
  assert.equal(additions.length, 1)
  assert.equal(additions[0].id, first.id)
  commands.replace([blocked, first, second], 2)
  assert.deepEqual(
    queue.value.map((item) => item.id),
    [first.id, second.id]
  )
  assert.deepEqual(
    originalQueue.value.map((item) => item.id),
    [first.id, second.id]
  )
  assert.equal(queueIndex.value, 1)
  assert.equal(currentTrack.value?.id, second.id)
  assert.deepEqual(skipped, [1, 1, 1])
  commands.dispose()
})

test('unsupported queue facade requests keep the current stream and heart mode intact', (t) => {
  const queue = shallowRef<Track[]>([])
  const originalQueue = shallowRef<Track[]>([])
  const currentTrack = shallowRef<Track | null>(null)
  const session = ref<PersonalizedStreamSession | null>({ id: 1, key: 'fm' })
  const initialSession = session.value
  const skipped: number[] = []
  let exits = 0
  let saves = 0
  let syncs = 0
  const controller = createPlaybackQueueController({
    queue,
    originalQueue,
    currentTrack,
    queueIndex: ref(-1),
    playMode: ref<PlayMode>('heart'),
    isPlaying: ref(false),
    personalizedStreamSession: session,
    personalizedStreamRemaining: ref(0),
    personalizedStreamEntryIds: new Set(),
    personalizedStreamPlayedEntryIds: new Set(),
    rendererPlayModeBoundaryPending: ref(false),
    persistPlaybackSessionAfterQueueMutation: () => {
      saves++
    },
    queueNativeQueueStateSync: async () => {
      syncs++
    },
    setAudioEngineError: () => assert.fail('Unexpected queue sync error'),
    clearAutomaticLyricsBaselines: () => {},
    getPosition: () => 0,
    prepareSelection: (item) => {
      currentTrack.value = item
    },
    exitHeartModeForQueueEdit: () => {
      exits++
    },
    onSkippedTracks: (count) => {
      skipped.push(count)
    }
  })
  t.after(controller.commands.dispose)
  const blocked = track('blocked', true)
  controller.enqueueTrack(blocked)
  controller.playNextTrack(blocked)
  controller.appendQueueTracks([blocked, blocked])
  assert.equal(controller.appendPersonalizedStreamTracks(initialSession!, [blocked]), false)
  assert.equal(exits, 0)
  assert.equal(saves, 0)
  assert.equal(syncs, 0)
  assert.equal(session.value, initialSession)
  assert.deepEqual(skipped, [1, 1, 2, 1])
  controller.appendQueueTracks([blocked, track('available')])
  assert.equal(exits, 1)
  assert.equal(saves, 1)
  assert.equal(syncs, 1)
  assert.deepEqual(
    queue.value.map((item) => item.id),
    ['available']
  )
  assert.equal(session.value, null)
})

/** Execute the actual selected function declarations with inert dependencies. */
function functions(path: URL, names: string[], bindings: Record<string, unknown>) {
  const raw = readFileSync(path, 'utf8')
  const source = raw.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? raw
  const ast = ts.createSourceFile('subject.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = names
    .map((name) => {
      const node = ast.statements.find(
        (item) => ts.isFunctionDeclaration(item) && item.name?.text === name
      )
      assert.ok(node, `Missing actual function ${name}`)
      return node.getText(ast)
    })
    .join('\n')
  const js = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function(...Object.keys(bindings), `${js}; return { ${names.join(', ')} };`)(
    ...Object.values(bindings)
  )
}

function namedQueuePrepare(bindings: Record<string, unknown>) {
  const source = readFileSync(new URL('../stores/usePlayerStore.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('subject.ts', source, ts.ScriptTarget.Latest, true)
  let callback: string | undefined
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'queueSessions') {
      const call = node.initializer as ts.CallExpression
      const options = call.arguments[0] as ts.ObjectLiteralExpression
      const property = options.properties.find(
        (item) => item.name?.getText(ast) === 'prepare'
      ) as ts.PropertyAssignment
      callback = property.initializer.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback, 'Missing actual queue session prepare callback')
  const js = ts.transpileModule(`const subject = ${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  return new Function(...Object.keys(bindings), `${js}; return subject`)(...Object.values(bindings))
}

test('actual named queue restore selects the filtered cursor and preserves only its own position', () => {
  for (const selected of [0, 1]) {
    const blocked = { ...track('blocked', true), queueEntryId: 'blocked-entry' }
    const available = { ...track('available'), queueEntryId: 'available-entry' }
    const previous = { ...track('previous'), queueEntryId: 'previous-entry' }
    const queue = shallowRef<Track[]>([previous])
    const originalQueue = shallowRef<Track[]>([previous])
    const currentTrack = shallowRef<Track | null>(previous)
    const queueIndex = ref(0)
    const playMode = ref<PlayMode>('sequential')
    const skipped: number[] = []
    let position = 0
    let mutations = 0
    const commands = createQueueCommandController({
      queue,
      originalQueue,
      currentTrack,
      queueIndex,
      playMode,
      getPosition: () => position,
      prepareSelection: (item) => {
        currentTrack.value = item
      },
      onMutation: () => {},
      onSkippedTracks: (count) => skipped.push(count)
    })
    const prepare = namedQueuePrepare({
      queue,
      queueIndex,
      playMode,
      isTrackPlaybackSupported,
      UNSUPPORTED_TRACK_PLAYBACK_MESSAGE,
      exitHeartModeForManualQueueReplacement: () => {
        mutations++
      },
      endPersonalizedStream: () => {
        mutations++
      },
      rendererPlayModeBoundaryPending: ref(false),
      playbackQueueController: { commands },
      playbackSessionController: {
        prepareQueueSelection: (item: Track, at: number) => {
          currentTrack.value = item
          position = at
        }
      },
      clampCuePlaybackPosition: (_item: Track, at: number) => at,
      persistPlaybackSessionAfterQueueMutation: () => {
        mutations++
      },
      queueNativeQueueStateSync: async () => {},
      updateSettings: async () => {}
    })
    try {
      const rows = [blocked, available]
      prepare({ queue: rows, original: rows, index: selected, position: 7 }, 'listLoop')
      assert.deepEqual(
        queue.value.map((item) => item.id),
        ['available']
      )
      assert.equal(queueIndex.value, 0)
      assert.equal(currentTrack.value?.queueEntryId, queue.value[0].queueEntryId)
      assert.equal(position, selected === 1 ? 7 : 0)
      assert.deepEqual(skipped, [1])
      const before = queue.value
      const beforeMode = playMode.value
      const beforeMutations = mutations
      assert.throws(
        () => prepare({ queue: [blocked], original: [blocked], index: 0, position: 7 }, 'repeat'),
        { message: UNSUPPORTED_TRACK_PLAYBACK_MESSAGE }
      )
      assert.equal(queue.value, before)
      assert.equal(playMode.value, beforeMode)
      assert.equal(mutations, beforeMutations)
      assert.equal(currentTrack.value?.id, 'available')
    } finally {
      commands.dispose()
    }
  }
})

test('actual list activation handlers refuse unsupported click, double-click, play button and Enter', () => {
  const supported = track('supported')
  const blocked = track('blocked', true)
  const target = { closest: () => null }
  const event = {
    target,
    currentTarget: target,
    detail: 1,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {},
    stopPropagation: () => {}
  }
  const played: Track[] = []
  const list = functions(
    new URL('../components/SongList.vue', import.meta.url),
    ['onRowClick', 'onRowDblClick', 'onRowKeyboardActivate', 'playAllTracks'],
    {
      isTrackPlaybackSupported,
      absoluteIndex: (index: number) => index,
      multiSelect: { onRowClick: () => 'play', shouldSuppressRowDoubleClick: () => false },
      settingsStore: { settings: { value: { trackActivationMode: 'doubleClick' } } },
      displayTracks: { value: [blocked, supported] },
      playTrack: (item: Track) => {
        played.push(item)
      },
      playNetworkTrack: () => {
        assert.fail('Unexpected source resolution')
      }
    }
  )
  list.onRowClick(blocked, 0, event)
  list.onRowDblClick(blocked, event)
  list.onRowKeyboardActivate(blocked, event)
  assert.equal(played.length, 0)
  list.onRowKeyboardActivate(supported, event)
  list.playAllTracks()
  assert.deepEqual(
    played.map((item) => item.id),
    [supported.id, supported.id]
  )
  const emitted: string[] = []
  const stage = functions(
    new URL('../components/streaming-page/StreamingDetailStage.vue', import.meta.url),
    ['onRowActivate', 'onRowDblClick', 'onPlayRow'],
    {
      isTrackPlaybackSupported,
      props: { trackActivationMode: 'doubleClick' },
      emit: (name: string) => {
        emitted.push(name)
      }
    }
  )
  stage.onRowActivate(blocked, 0, event)
  stage.onRowDblClick(blocked, 0, event)
  stage.onPlayRow(blocked, 0, event)
  assert.deepEqual(emitted, [])
  stage.onRowActivate(blocked, 0, { ...event, ctrlKey: true })
  stage.onPlayRow(supported, 1, event)
  assert.deepEqual(emitted, ['trackClick', 'playTrack'])
  const template = readFileSync(
    new URL('../components/streaming-page/StreamingDetailStage.vue', import.meta.url),
    'utf8'
  )
  assert.equal((template.match(/:disabled="!isTrackPlaybackSupported\(track\)"/g) ?? []).length, 2)
  assert.match(
    template,
    /:title="isTrackPlaybackSupported\(track\) \? undefined : UNSUPPORTED_TRACK_PLAYBACK_MESSAGE"/
  )
})

test('actual player load and resolver guards run before history, authorization and provider work', async () => {
  let attempts = 0
  let authorizations = 0
  const errors: string[] = []
  const reachedPlayback = new Error('supported path reached')
  const player = functions(
    new URL('../stores/usePlayerStore.ts', import.meta.url),
    ['loadAndPlay', 'resolvePlayTarget'],
    {
      isTrackPlaybackSupported,
      UNSUPPORTED_TRACK_PLAYBACK_MESSAGE,
      setAudioEngineError: (message: string) => {
        errors.push(message)
      },
      playbackHistoryController: {
        beginPlaybackAttempt: () => {
          attempts++
          throw reachedPlayback
        }
      },
      getTrackSource: () => 'local',
      window: {
        api: {
          fs: {
            isAudioFileAuthorized: async () => {
              authorizations++
              return true
            }
          }
        }
      }
    }
  )
  await player.loadAndPlay(track('blocked', true))
  await assert.rejects(player.resolvePlayTarget(track('blocked', true)), {
    message: UNSUPPORTED_TRACK_PLAYBACK_MESSAGE
  })
  assert.equal(attempts, 0)
  assert.equal(authorizations, 0)
  assert.deepEqual(errors, [UNSUPPORTED_TRACK_PLAYBACK_MESSAGE])
  await assert.rejects(
    player.loadAndPlay(track('supported')),
    (error: unknown) => error === reachedPlayback
  )
  assert.equal(attempts, 1)
  assert.equal(
    await player.resolvePlayTarget({ ...track('supported'), filePath: 'public-fixture.flac' }),
    'public-fixture.flac'
  )
  assert.equal(authorizations, 1)
})
