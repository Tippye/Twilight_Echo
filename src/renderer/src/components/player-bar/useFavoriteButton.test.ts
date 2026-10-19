import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import { useMediaProviders, syncPluginProviders } from '../../providers/index.ts'
import type { MediaProviderRegistry } from '../../providers/mediaProvider.ts'
import { useFavoriteButton } from './useFavoriteButton.ts'
import type { Track } from '../../types/music.ts'

const localTrack: Track = {
  id: 'local:moon',
  title: 'Moon River',
  artist: 'Audrey',
  album: 'Breakfast',
  duration: 180,
  filePath: 'D:/Music/Moon River.flac',
  fileName: 'Moon River.flac',
  size: 1,
  cover: null,
  lyrics: null,
  source: 'local'
}

const ncmTrack: Track = {
  ...localTrack,
  id: 'ncm:123',
  filePath: 'ncm:123',
  source: 'ncm',
  ncmSongId: 123
}

function createButton(options: {
  track: Track
  trackRef?: Ref<Track | null>
  registry?: MediaProviderRegistry
  provider?: {
    likeTrack?: (trackId: string | number, like: boolean) => Promise<void>
    isTrackLiked?: (trackId: string | number | undefined) => boolean | Promise<boolean>
  }
  isFavorite?: boolean
  calls: string[]
}) {
  return useFavoriteButton({
    currentTrack: options.trackRef ?? ref<Track | null>(options.track),
    playlists: ref([]),
    mediaProviders:
      options.registry ??
      ({
        get: () => options.provider ?? null
      } as never),
    addToPlaylist: (playlistName, trackId) =>
      options.calls.push(`legacy-add:${playlistName}:${trackId}`),
    removeFromPlaylist: (playlistName, trackId) =>
      options.calls.push(`legacy-remove:${playlistName}:${trackId}`),
    createPlaylist: (name) => options.calls.push(`legacy-create:${name}`),
    isFavoriteTrack: () => options.isFavorite === true,
    addFavoriteTrack: (track) => options.calls.push(`local-add:${track.id}`),
    removeFavoriteTrack: (track) => options.calls.push(`local-remove:${track.id}`)
  })
}

async function settleFavoriteState(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test('favorite button keeps local tracks in the local default favorites', async () => {
  const calls: string[] = []
  const button = createButton({ track: localTrack, calls })

  assert.equal(button.favoriteButtonVisible.value, true)
  assert.equal(button.favoriteButtonLiked.value, false)

  await button.toggleFavorite()

  assert.deepEqual(calls, ['local-add:local:moon'])
})

test('favorite button routes NetEase tracks to the NetEase provider instead of local favorites', async () => {
  const calls: string[] = []
  const button = createButton({
    track: ncmTrack,
    calls,
    provider: {
      isTrackLiked: () => false,
      likeTrack: async (trackId, like): Promise<void> => {
        calls.push(`ncm:${trackId}:${like}`)
      }
    }
  })
  await settleFavoriteState()

  assert.equal(button.favoriteButtonVisible.value, true)
  assert.equal(button.favoriteButtonLiked.value, false)

  await button.toggleFavorite()

  assert.equal(button.favoriteButtonLiked.value, true)
  assert.deepEqual(calls, ['ncm:123:true'])
})

test('a pending membership read prevents writing an assumed favorite state', async () => {
  const calls: string[] = []
  let resolveLiked: ((liked: boolean) => void) | undefined
  const button = createButton({
    track: ncmTrack,
    calls,
    provider: {
      isTrackLiked: () =>
        new Promise<boolean>((resolve) => {
          resolveLiked = resolve
        }),
      likeTrack: async (trackId, like): Promise<void> => {
        calls.push(`ncm:${trackId}:${like}`)
      }
    }
  })
  await settleFavoriteState()
  assert.equal(button.favoriteButtonLoading.value, true)
  await button.toggleFavorite()
  assert.deepEqual(calls, [])
  resolveLiked?.(true)
  await settleFavoriteState()
  assert.equal(button.favoriteButtonLiked.value, true)
  assert.equal(button.favoriteButtonLoading.value, false)
  await button.toggleFavorite()
  assert.equal(button.favoriteButtonLiked.value, false)
  assert.deepEqual(calls, ['ncm:123:false'])
})

test('favorite button removes liked NetEase tracks through the provider', async () => {
  const calls: string[] = []
  const button = createButton({
    track: ncmTrack,
    calls,
    isFavorite: true,
    provider: {
      isTrackLiked: () => true,
      likeTrack: async (trackId, like): Promise<void> => {
        calls.push(`ncm:${trackId}:${like}`)
      }
    }
  })
  await settleFavoriteState()

  assert.equal(button.favoriteButtonLiked.value, true)

  await button.toggleFavorite()

  assert.equal(button.favoriteButtonLiked.value, false)
  assert.deepEqual(calls, ['ncm:123:false'])
})

test('favorite button routes third-party streaming tracks to their provider', async () => {
  const calls: string[] = []
  const biliTrack: Track = {
    ...localTrack,
    id: 'bili:BV1xx:1',
    filePath: 'bili:BV1xx:1',
    source: 'bili',
    ncmSongId: undefined
  }
  const button = createButton({
    track: biliTrack,
    calls,
    provider: {
      isTrackLiked: () => false,
      likeTrack: async (trackId, like): Promise<void> => {
        calls.push(`bili:${trackId}:${like}`)
      }
    }
  })
  await settleFavoriteState()

  assert.equal(button.favoriteButtonVisible.value, true)

  await button.toggleFavorite()

  assert.deepEqual(calls, ['bili:BV1xx:1:true'])
})

test('favorite button is hidden for streaming providers without remote favorite support', async () => {
  const calls: string[] = []
  const button = createButton({
    track: ncmTrack,
    calls,
    provider: {}
  })
  await settleFavoriteState()

  assert.equal(button.favoriteButtonVisible.value, false)

  await button.toggleFavorite()

  assert.deepEqual(calls, [])
})

test('same-identity metadata updates retain liked state without repeating provider reads', async () => {
  const track = ref<Track | null>({ ...ncmTrack })
  let reads = 0
  const button = createButton({
    track: ncmTrack,
    trackRef: track,
    calls: [],
    provider: {
      likeTrack: async () => {},
      isTrackLiked: async () => {
        reads++
        return true
      }
    }
  })
  await settleFavoriteState()
  assert.equal(button.favoriteButtonLiked.value, true)
  for (let index = 0; index < 3; index++) {
    track.value = { ...track.value!, bitrate: 128000 + index }
    await nextTick()
  }
  await settleFavoriteState()
  assert.equal(reads, 1)
  assert.equal(button.favoriteButtonLiked.value, true)
})

test('mounted favorite button follows capability reloads and ignores unrelated health events', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const listeners = new Set<() => void>()
  let supportedMethods: string[] = []
  let listed = true
  let reads = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      api: {
        plugins: {
          onChanged: (fn: () => void) => {
            listeners.add(fn)
            return () => listeners.delete(fn)
          }
        },
        providers: {
          list: async () =>
            listed
              ? [
                  {
                    id: 'favorite-ui-test',
                    name: 'Favorite',
                    capabilities: ['library'],
                    supportedMethods
                  }
                ]
              : [],
          call: async (_id: string, method: string) => {
            if (method === 'isTrackLiked') {
              reads++
              return true
            }
          return undefined
          }
        }
      }
    }
  })
  const registry = useMediaProviders()
  const scope = effectScope()
  t.after(async () => {
    scope.stop()
    listed = false
    await syncPluginProviders()
    registry.unregister('favorite-ui-test')
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  const button = scope.run(() =>
    createButton({
      track: { ...localTrack, id: 'favorite-ui-test:public-song', source: 'favorite-ui-test' },
      registry,
      calls: []
    })
  )!
  await settleFavoriteState()
  assert.equal(button.favoriteButtonVisible.value, false)
  supportedMethods = ['isTrackLiked', 'likeTrack']
  for (const listener of listeners) listener()
  await settleFavoriteState()
  assert.equal(button.favoriteButtonVisible.value, true)
  assert.equal(button.favoriteButtonLiked.value, true)
  assert.equal(reads, 1)
  for (const listener of listeners) listener()
  await settleFavoriteState()
  assert.equal(reads, 1)
  supportedMethods = []
  for (const listener of listeners) listener()
  await settleFavoriteState()
  assert.equal(button.favoriteButtonVisible.value, false)
  assert.equal(button.favoriteButtonLiked.value, false)
})
