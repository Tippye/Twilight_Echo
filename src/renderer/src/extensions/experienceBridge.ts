import { watch, type WatchStopHandle } from 'vue'
import {
  assertExperienceMethod,
  experienceRequestLimit,
  EXPERIENCE_METHOD_PERMISSIONS,
  type InstalledExperience
} from '../../../shared/pluginExperience.ts'
import { useMusicStore } from '../stores/useMusicStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { Track } from '../types/music'
import { useProviderStore } from '../stores/useProviderStore'
import {
  createDspFactoryScene,
  DSP_FACTORY_SCENE_TEMPLATES,
  type DspFactorySceneTemplateId
} from '../../../shared/dspGraph.ts'
import { nodeCatalog, normalizeNodeEditorParams, singletonNodeTypes } from '../utils/dspNodeParams'
import { createExperienceServices } from './experienceServices'

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const bounded = (value: unknown, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Value outside supported range')
  return value
}

export function createExperienceBridge(
  experience: InstalledExperience,
  port: MessagePort,
  exit: () => void,
  openPanel: (name: string) => void
) {
  const music = useMusicStore(),
    player = usePlayerStore(),
    settings = useSettingsStore()
  let disposed = false,
    inFlight = 0
  const stops: WatchStopHandle[] = []
  const providers = useProviderStore()
  const invokeService = createExperienceServices(experience.permissions)
  const remoteTracks = new Map<string, Track>()
  const rememberTracks = (tracks: Track[]) =>
    tracks.map((track) => {
      remoteTracks.set(track.id, track)
      if (remoteTracks.size > 10000) remoteTracks.delete(remoteTracks.keys().next().value!)
      return trackDto(track)
    })
  let libraryRevision = 1
  const albumOfTrack = new Map<string, string>()
  const albumIds = new Map<string, string>()
  let indexRevision = 0
  async function indexAlbums() {
    const revision = ++indexRevision
    const albums = music.albums.value
    for (const album of albums) {
      const key = album.id ?? album.name
      if (albumIds.has(key)) continue
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
      if (disposed || revision !== indexRevision) return
      albumIds.set(
        key,
        `album-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
      )
    }
    if (disposed || revision !== indexRevision) return
    albumOfTrack.clear()
    for (const album of albums)
      for (const track of album.tracks)
        albumOfTrack.set(track.id, albumIds.get(album.id ?? album.name)!)
  }
  let indexing = indexAlbums()
  const albumId = (album: (typeof music.albums.value)[number]) =>
    albumIds.get(album.id ?? album.name) ?? ''
  function trackDto(track: Track) {
    return {
      id: track.id,
      albumId: albumOfTrack.get(track.id) ?? '',
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      format: track.format ?? '',
      trackNumber: track.trackNumber,
      discNumber: track.discNumber,
      sampleRate: track.sampleRate,
      bitsPerSample: track.bitDepth,
      bitrate: track.bitrate,
      browserPlayable: true,
      audioUrl: '',
      relativePath: '',
      favorite: music.isFavoriteTrack(track),
      queueEntryId: track.queueEntryId
    }
  }
  function albumDto(album: (typeof music.albums.value)[number], full = false) {
    return {
      id: albumId(album),
      title: album.name,
      artist: album.artist ?? '',
      year: album.releaseDate ? Number(album.releaseDate.slice(0, 4)) : undefined,
      genreId: album.tracks[0]?.genre || '未分类',
      rawGenres: [],
      folder: '',
      coverUrl:
        album.cover?.startsWith('cover://') || album.cover?.startsWith('data:image/')
          ? album.cover
          : undefined,
      trackCount: album.trackCount,
      totalDuration: album.tracks.reduce((sum, t) => sum + t.duration, 0),
      tracks: full ? album.tracks.map(trackDto) : [],
      producers: [],
      offline: false
    }
  }
  function state() {
    return {
      transport: player.isLoading.value
        ? 'loading'
        : player.isPlaying.value
          ? 'playing'
          : player.currentTrack.value
            ? 'paused'
            : 'idle',
      currentTrack: player.currentTrack.value ? trackDto(player.currentTrack.value) : null,
      playing: player.isPlaying.value,
      loading: player.isLoading.value,
      duration: player.duration.value,
      currentTime: player.currentTime.value,
      volume: player.volume.value,
      currentIndex: player.queueIndex.value,
      playMode: player.playMode.value,
      error: player.audioEngineError.value || null,
      songTransitionMode:
        player.audioProcessing.value.crossfadeSeconds > 0 ? 'fade-in-out' : 'gapless',
      backend: 'twilight',
      outputDeviceId: player.audioDevice.value,
      sleepTimer: player.sleepTimerState.value,
      playbackRate: player.playbackRate.value
    }
  }
  const send = (event: string, value: unknown) => {
    if (!disposed) port.postMessage({ event, value: plain(value) })
  }
  const resolveTrack = (id: unknown) => {
    if (typeof id !== 'string') throw new Error('Missing track id')
    const track =
      music.getTrackById(id) ?? player.queue.value.find((t) => t.id === id) ?? remoteTracks.get(id)
    if (!track) throw new Error('Track no longer available')
    return track
  }
  async function invoke(method: string, args: Record<string, unknown>) {
    assertExperienceMethod(method, experience.permissions)
    await indexing
    if (disposed) throw new Error('Experience session closed')
    if (
      /^(radio|podcasts|network|stats|diagnostics|themes)\./.test(method) ||
      ['plugins.catalog', 'plugins.update'].includes(method)
    )
      return invokeService(method, args)
    switch (method) {
      case 'online.providers':
        await providers.syncProviders()
        return providers.providers.value.map((p) => ({
          id: p.id,
          name: p.name,
          methods: p.supportedMethods,
          authType: p.ui?.authType,
          qrStatusCodes: p.ui?.qrStatusCodes
        }))
      case 'online.search': {
        const result = await providers.callProvider<{ items: Track[]; total: number }>(
          String(args.providerId),
          'searchSongs',
          [String(args.query ?? '').slice(0, 200), 50, bounded(args.offset ?? 0, 0, 100000)]
        )
        return { items: rememberTracks(result.items), total: result.total }
      }
      case 'online.login': {
        const result = await providers.checkLogin(String(args.providerId))
        return { loggedIn: result.loggedIn, nickname: result.profile?.nickname ?? '' }
      }
      case 'online.qr': {
        const result = await providers.getQrLogin(String(args.providerId))
        return result
          ? {
              key: result.key,
              qrContent: result.qrContent,
              imageDataUrl: result.imageDataUrl,
              expiresInSeconds: result.expiresInSeconds
            }
          : null
      }
      case 'online.qrStatus': {
        const result = await providers.checkQrLogin(
          String(args.providerId),
          String(args.key).slice(0, 4096)
        )
        return { code: result.code, message: result.message }
      }
      case 'online.logout':
        return providers.logout(String(args.providerId))
      case 'online.library': {
        const result = await providers.fetchUserLibrary(String(args.providerId))
        return [...(result.likedPlaylist ? [result.likedPlaylist] : []), ...result.playlists].map(
          (p) => ({ id: p.id, name: p.name, trackCount: p.trackCount })
        )
      }
      case 'online.playlist': {
        const result = await providers.fetchPlaylistTracksPage(
          String(args.providerId),
          String(args.id),
          bounded(args.offset ?? 0, 0, 100000),
          100
        )
        return {
          total: result.total,
          nextOffset: result.nextOffset,
          hasMore: result.hasMore,
          items: rememberTracks(result.tracks)
        }
      }
      case 'online.recommendations':
        return rememberTracks(
          await providers.callProvider<Track[]>(String(args.providerId), 'fetchRecommendSongs')
        )
      case 'online.cloud': {
        const result = await providers.callProvider<{
          items: Array<{ track: Track; cloudSongId: string; fileName: string }>
          total: number
        }>(String(args.providerId), 'fetchCloudSongsPage', [
          bounded(args.offset ?? 0, 0, 100000),
          100
        ])
        return {
          total: result.total,
          items: result.items.map((item) => ({
            ...rememberTracks([item.track])[0],
            cloudSongId: item.cloudSongId
          }))
        }
      }
      case 'downloads.list':
        return (await window.api.providerDownloads.list()).map((t) => ({
          id: t.id,
          title: t.track.title,
          artist: t.track.artist,
          status: t.status,
          progress: t.progress,
          error: t.error
        }))
      case 'downloads.create': {
        assertExperienceMethod('online.providers', experience.permissions)
        const track = resolveTrack(args.id)
        const quality = String(args.quality ?? 'lossless')
        if (!['aac', 'lossless', 'hi-res'].includes(quality)) throw new Error('Invalid quality')
        const task = await window.api.providerDownloads.create({
          providerId: String(args.providerId),
          track: { ...plain(track), artist: track.artist ?? '', cover: track.cover ?? undefined },
          quality: quality as 'aac' | 'lossless' | 'hi-res'
        })
        return { id: task.id }
      }
      case 'downloads.cancel':
        return window.api.providerDownloads.cancel(String(args.id))
      case 'downloads.retry':
        await window.api.providerDownloads.retry(String(args.id))
        return null
      case 'music.metadata.operate': {
        if (
          ![
            'status',
            'task',
            'preview',
            'import',
            'reconcile',
            'introductions',
            'credits',
            'enrich'
          ].includes(String(args.operation))
        )
          throw new Error('Invalid metadata operation')
        if (args.operation !== 'status' && music.isScanning.value)
          throw new Error('曲库正在扫描，请完成后重试资料操作')
        return window.api.extensions.experienceMusic(
          experience.pluginId,
          String(args.operation),
          args.operation === 'status' ? [] : music.albums.value.map((a) => albumDto(a, true)),
          (args.body ?? {}) as Record<string, unknown>
        )
      }
      case 'host.capabilities':
        return {
          bridgeVersion: experience.bridgeVersion,
          methods: Object.keys(EXPERIENCE_METHOD_PERMISSIONS).filter((method) =>
            experience.permissions.includes(EXPERIENCE_METHOD_PERMISSIONS[method])
          )
        }
      case 'files.export':
        return window.api.extensions.experienceExport(
          experience.pluginId,
          String(args.name),
          String(args.content)
        )
      case 'music.metadata.read':
        return window.api.extensions.experienceDocument(experience.pluginId)
      case 'music.metadata.write':
        return window.api.extensions.experienceDocument(experience.pluginId, {
          revision: bounded(args.revision, 0, Number.MAX_SAFE_INTEGER),
          value: plain(args.value) as Record<string, unknown>
        })
      case 'music.scan': {
        if (Array.isArray(args.roots)) {
          if (
            args.roots.length > 100 ||
            args.roots.some((p) => typeof p !== 'string' || p.length > 4096)
          )
            throw new Error('Invalid library folders')
          // Removing a root does not erase songs or playlists. The host scan owns reconciliation.
          const roots = [...new Set(args.roots as string[])]
          for (const path of [...music.scannedFolders.value])
            if (!roots.includes(path)) music.removeFolder(path)
          for (const path of roots) music.addFolder(path)
        }
        void music.startFullLibraryScan()
        return null
      }
      case 'music.library': {
        await music.whenLibrarySettled()
        await indexing
        if (args.revision === libraryRevision) return { unchanged: true, revision: libraryRevision }
        const offset = Math.floor(bounded(args.offset ?? 0, 0, 10000000))
        const limit = Math.floor(bounded(args.limit ?? 100, 1, 100))
        const genres = [
          ...new Set(music.albums.value.map((a) => a.tracks[0]?.genre || '未分类'))
        ].map((name) => ({ id: name, name }))
        return {
          version: 1,
          revision: libraryRevision,
          albums: music.albums.value.slice(offset, offset + limit).map((a) => ({
            ...albumDto(a, true),
            discCount: Math.max(1, ...a.tracks.map((t) => t.discNumber ?? 1))
          })),
          total: music.albums.value.length,
          genres,
          roots: music.scannedFolders.value.map((path) => ({ path, status: 'online' })),
          scan: {
            running: music.isScanning.value,
            error: music.libraryScanStatus.value.error || undefined
          },
          onlineEnabled: false
        }
      }
      case 'library.list': {
        await music.whenLibrarySettled()
        const offset = Math.floor(bounded(args.offset ?? 0, 0, 10000000))
        const limit = Math.floor(bounded(args.limit ?? 200, 1, 500))
        return {
          albums: music.albums.value.slice(offset, offset + limit).map((a) => albumDto(a)),
          total: music.albums.value.length
        }
      }
      case 'library.album': {
        const album = music.albums.value.find((a) => albumId(a) === args.id)
        if (!album) throw new Error('Album no longer available')
        return albumDto(album, true)
      }
      case 'library.search': {
        const query = String(args.query ?? '')
          .slice(0, 200)
          .toLocaleLowerCase()
        return {
          albums: music.albums.value
            .filter((a) => `${a.name} ${a.artist}`.toLocaleLowerCase().includes(query))
            .slice(0, 80)
            .map((a) => albumDto(a)),
          tracks: music.tracks.value
            .filter((t) => `${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase().includes(query))
            .slice(0, 100)
            .map(trackDto)
        }
      }
      case 'library.playlists':
        return music.localPlaylists.value.map((p) => ({
          id: p.id,
          name: p.name,
          tracks: music.getPlaylistTracksById(p.id).map(trackDto),
          isDefault: p.isDefault
        }))
      case 'library.favorite': {
        const track = resolveTrack(args.id)
        if (music.isFavoriteTrack(track)) music.removeFavoriteTrack(track)
        else music.addFavoriteTrack(track)
        return trackDto(track)
      }
      case 'library.createPlaylist':
        return music.createPlaylist(String(args.name ?? ''))
      case 'library.addToPlaylist': {
        const p = music.localPlaylists.value.find((p) => p.id === args.playlistId)
        if (!p) throw new Error('Playlist unavailable')
        const track = resolveTrack(args.id)
        music.addToPlaylist(p.name, track.id, track)
        return null
      }
      case 'library.removeFromPlaylist': {
        const p = music.localPlaylists.value.find((p) => p.id === args.playlistId)
        if (!p) throw new Error('Playlist unavailable')
        music.removeFromPlaylist(p.name, String(args.id))
        return null
      }
      case 'library.deletePlaylist':
        music.deletePlaylist(String(args.id))
        return null
      case 'library.scan':
        return music.startFullLibraryScan()
      case 'player.state':
        return state()
      case 'player.sleep':
        if (args.mode === null) player.cancelSleepTimer()
        else {
          if (!['minutes', 'trackEnd', 'queueEnd'].includes(String(args.mode)))
            throw new Error('无效的定时模式')
          player.configureSleepTimer(
            args.mode as 'minutes' | 'trackEnd' | 'queueEnd',
            bounded(args.minutes ?? 30, 1, 720)
          )
        }
        return state()
      case 'player.rate':
        await player.setPlaybackRate(bounded(args.value, 0.5, 2))
        return state()
      case 'player.queue':
        return player.queue.value.map(trackDto)
      case 'player.lyrics':
        return {
          id: player.currentTrack.value?.id,
          lyrics: player.currentTrack.value?.lyrics ?? '',
          translatedLyrics: player.currentTrack.value?.translatedLyrics ?? ''
        }
      case 'player.play': {
        const track = resolveTrack(args.id)
        const ids = Array.isArray(args.ids) ? args.ids.slice(0, 10000) : undefined
        const album = music.albums.value.find((a) => albumId(a) === args.albumId)
        const queue = ids ? ids.map(resolveTrack) : (album?.tracks ?? [track])
        await player.playTrack(track, queue)
        return state()
      }
      case 'player.toggle':
        await player.togglePlay()
        return state()
      case 'player.pause':
        if (player.isPlaying.value) await player.togglePlay()
        return state()
      case 'player.stop':
        player.stopPlayback()
        return state()
      case 'player.next':
        player.next()
        return null
      case 'player.previous':
        player.prev()
        return null
      case 'player.seek':
        player.seek(bounded(args.value, 0, Math.max(0, player.duration.value)))
        return null
      case 'player.volume':
        player.setVolume(bounded(args.value, 0, 1))
        return null
      case 'player.mode':
        if (args.value === undefined) player.cyclePlayMode()
        else if (['sequential', 'listLoop', 'repeat', 'shuffle'].includes(String(args.value)))
          player.setPlayMode(args.value as 'sequential' | 'listLoop' | 'repeat' | 'shuffle')
        else throw new Error('Invalid play mode')
        return null
      case 'player.transition': {
        if (!['gapless', 'fade-in-out'].includes(String(args.mode)))
          throw new Error('当前宿主支持无缝播放和交叉淡化')
        await player.setAudioProcessing({
          gapless: true,
          crossfadeSeconds:
            args.mode === 'gapless' ? 0 : Math.max(2, player.audioProcessing.value.crossfadeSeconds)
        })
        return state()
      }
      case 'player.setQueue': {
        if (!Array.isArray(args.ids) || args.ids.length > 10000) throw new Error('Invalid queue')
        const tracks = args.ids.map(resolveTrack)
        player.clearQueue()
        player.appendQueueTracks(tracks)
        return null
      }
      case 'player.reorderQueue': {
        const from = Math.floor(bounded(args.from, 0, player.queue.value.length - 1))
        const to = Math.floor(bounded(args.to, 0, player.queue.value.length - 1))
        player.reorderQueue(from, to)
        return null
      }
      case 'player.playQueue': {
        const track = player.queue.value.find((t) => t.queueEntryId === args.entryId)
        if (!track) throw new Error('Queue entry unavailable')
        await player.playTrack(track, player.queue.value)
        return state()
      }
      case 'player.removeQueue':
        if (typeof args.entryId === 'string') {
          const index = player.queue.value.findIndex((t) => t.queueEntryId === args.entryId)
          if (index < 0) throw new Error('Queue entry unavailable')
          player.removeQueueItem(index)
        } else
          player.removeQueueItem(Math.floor(bounded(args.index, 0, player.queue.value.length - 1)))
        return null
      case 'player.clearQueue':
        player.clearQueue()
        return null
      case 'preferences.read':
        return window.api.extensions.experiencePreferences(experience.pluginId)
      case 'preferences.write':
        return window.api.extensions.experiencePreferences(experience.pluginId, args.value)
      case 'settings.read':
        return plain({
          settings: settings.settings.value,
          defaults: settings.defaults.value,
          appVersion: settings.appVersion.value
        })
      case 'settings.update': {
        if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch))
          throw new Error('Invalid settings patch')
        return settings.updateSettings(plain(args.patch))
      }
      case 'audio.read':
        return plain({
          processing: player.audioProcessing.value,
          output: player.audioOutput.value,
          device: player.audioDevice.value,
          outputs: player.audioOutputOptions.value,
          devices: player.audioDeviceOptions.value
        })
      case 'dsp.read': {
        const [state, status] = await Promise.all([
          window.api.audioEngine.getDspSceneState(),
          window.api.audioEngine.getDspGraphStatus()
        ])
        return { state, status, catalog: nodeCatalog, templates: DSP_FACTORY_SCENE_TEMPLATES }
      }
      case 'dsp.create': {
        if (!DSP_FACTORY_SCENE_TEMPLATES.some((t) => t.id === args.template))
          throw new Error('Unknown scene template')
        const state = await window.api.audioEngine.getDspSceneState()
        const scene = createDspFactoryScene(
          args.template as DspFactorySceneTemplateId,
          crypto.randomUUID()
        )
        if (typeof args.name === 'string' && args.name.trim())
          scene.name = args.name.trim().slice(0, 120)
        return window.api.audioEngine.setDspScenes([...state.scenes, scene], state.pinnedSceneId)
      }
      case 'dsp.apply':
        return window.api.audioEngine.applyDspScene(
          args.id === null ? null : String(args.id),
          args.confirmDsdPcmFallback === true
        )
      case 'dsp.node': {
        const state = await window.api.audioEngine.getDspSceneState()
        const scene = state.scenes.find((s) => s.id === args.sceneId)
        if (!scene) throw new Error('DSP scene unavailable')
        const index = scene.graph.nodes.findIndex((n) => n.id === args.nodeId)
        if (args.action === 'add') {
          const template = nodeCatalog.find((n) => n.type === args.type)
          if (!template || ['nativePlugin', 'vst3Plugin'].includes(template.type))
            throw new Error('Unsupported node type')
          if (
            singletonNodeTypes.has(template.type) &&
            scene.graph.nodes.some((n) => n.type === template.type)
          )
            throw new Error('该模块已存在')
          const node = {
            id: crypto.randomUUID(),
            type: template.type,
            enabled: true,
            params: plain(template.params)
          }
          normalizeNodeEditorParams(node)
          scene.graph.nodes.push(node)
        } else {
          if (index < 0) throw new Error('DSP node unavailable')
          const node = scene.graph.nodes[index]
          if (args.action === 'remove') scene.graph.nodes.splice(index, 1)
          else if (args.action === 'move') {
            const to = Math.floor(bounded(args.to, 0, scene.graph.nodes.length - 1))
            scene.graph.nodes.splice(index, 1)
            scene.graph.nodes.splice(to, 0, node)
          } else if (args.action === 'update') {
            if (typeof args.enabled === 'boolean') node.enabled = args.enabled
            if (args.params && typeof args.params === 'object' && !Array.isArray(args.params))
              node.params = { ...node.params, ...plain(args.params) }
            normalizeNodeEditorParams(node)
          } else throw new Error('Invalid DSP operation')
        }
        return window.api.audioEngine.setDspScenes(state.scenes, state.pinnedSceneId)
      }
      case 'dsp.import':
        await window.api.audioEngine.importDspProfile()
        return null
      case 'dsp.export':
        await window.api.audioEngine.exportDspProfile(String(args.name ?? 'Rhine Music'))
        return null
      case 'audio.processing': {
        if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch))
          throw new Error('Invalid processing patch')
        await player.setAudioProcessing(plain(args.patch))
        return null
      }
      case 'audio.output': {
        if (typeof args.output === 'string')
          await player.setAudioOutput(args.output as Parameters<typeof player.setAudioOutput>[0])
        if (typeof args.device === 'string') await player.setAudioDevice(args.device)
        return null
      }
      case 'plugins.list':
        return (await window.api.plugins.list()).map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version,
          description: p.description,
          enabled: p.enabled,
          error: p.error,
          builtIn: p.builtIn,
          permissions: p.permissions,
          status: p.status
        }))
      case 'plugins.enable':
        await window.api.plugins.enable(String(args.id))
        return null
      case 'plugins.disable':
        await window.api.plugins.disable(String(args.id))
        return null
      case 'plugins.install':
        await window.api.plugins.chooseAndInstall('package')
        return null
      case 'plugins.uninstall':
        await window.api.plugins.uninstall(String(args.id))
        return null
      case 'host.panel':
        if (args.name === 'plugins') assertExperienceMethod('plugins.list', experience.permissions)
        openPanel(String(args.name))
        return null
      case 'host.environment':
        return {
          reducedMotion: ['reduced', 'off'].includes(
            document.documentElement.dataset.teMotion ?? ''
          )
        }
      case 'host.exit':
        exit()
        return null
      case 'host.openLink': {
        const url = new URL(String(args.url))
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('Only HTTPS reference links are supported')
        await window.api.shell.openExternal(url.href)
        return null
      }
      case 'window.mini':
      case 'window.tray':
      case 'window.lyrics': {
        const theme =
          experience.pluginId === 'com.twilightecho.experience.rhine-lab'
            ? document.querySelector('.experience-window')?.getAttribute('data-tone') === 'night'
              ? 'rhine-night'
              : 'rhine'
            : 'default'
        if (method === 'window.mini') return window.api.miniPlayer.open({ theme })
        if (method === 'window.tray') return window.api.window.showTrayPlayer({ theme })
        return window.api.desktopLyrics.setEnabled(true, { theme })
      }
      case 'host.fullscreen':
        if (document.fullscreenElement) await document.exitFullscreen()
        else await document.documentElement.requestFullscreen()
        return null
    }
    throw new Error('Unsupported operation')
  }
  port.onmessage = async ({ data }) => {
    if (disposed || !data || !Number.isSafeInteger(data.id) || typeof data.method !== 'string')
      return
    if (inFlight >= 16) {
      port.postMessage({ id: data.id, error: 'Too many requests' })
      return
    }
    inFlight++
    try {
      if (
        new TextEncoder().encode(JSON.stringify(data)).byteLength >
        experienceRequestLimit(data.method)
      )
        throw new Error('Request too large')
      const value = await invoke(
        data.method,
        data.args && typeof data.args === 'object' ? data.args : {}
      )
      if (!disposed)
        port.postMessage({ id: data.id, value: value === undefined ? null : plain(value) })
    } catch (error) {
      if (!disposed)
        port.postMessage({
          id: data.id,
          error: error instanceof Error ? error.message : String(error)
        })
    } finally {
      inFlight--
    }
  }
  port.start()
  if (experience.permissions.includes('player:observe')) {
    stops.push(
      watch(
        [
          player.currentTrack,
          player.isPlaying,
          player.isLoading,
          player.volume,
          player.duration,
          player.queueIndex
        ],
        () => send('player', state())
      )
    )
    stops.push(watch(player.queue, () => send('queue', null)))
    stops.push(
      watch(
        () => player.currentTrack.value?.lyrics,
        () => send('lyrics', null)
      )
    )
  }
  if (experience.permissions.includes('library:read'))
    stops.push(
      watch(music.albums, () => {
        libraryRevision++
        indexing = indexAlbums()
        void indexing.then(() => send('library', null))
      })
    )
  stops.push(
    watch(
      [music.isScanning, music.libraryScanStatus, music.scannedFolders],
      () => {
        libraryRevision++
      },
      { deep: true }
    )
  )
  const timer = setInterval(() => {
    if (!document.hidden && experience.permissions.includes('player:observe'))
      send('player', state())
  }, 250)
  send('player', experience.permissions.includes('player:observe') ? state() : null)
  return () => {
    disposed = true
    clearInterval(timer)
    stops.forEach((stop) => stop())
    port.close()
  }
}
