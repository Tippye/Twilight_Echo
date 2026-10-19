import { hostname, release } from 'node:os'
import { randomBytes, randomInt } from 'node:crypto'
import { WindowsMusicClient } from './lib/windows/client.mjs'
import { buildWindowsDesktopSearchCall, WINDOWS_DESKTOP_SEARCH_REQUEST_KEY } from './lib/windows/search-call.mjs'
import { mapWindowsTrack, windowsSearchPage, windowsSearchWindow, windowsSongReference, windowsSongMedia, windowsTrackPlaybackQualities } from './lib/windows/tracks.mjs'
import { buildWindowsTrackInfoCall, WINDOWS_TRACK_INFO_REQUEST_KEY } from './lib/windows/song-detail-call.mjs'
import { createWindowsPlaybackResolver, windowsPlaybackFailureDetails, windowsPlaybackSessionFingerprint, WINDOWS_MEDIA_ALLOWED_ORIGINS } from './lib/windows/media-source.mjs'
import { windowsQualityDefinition, windowsQualityFallbacks } from './lib/windows/quality.mjs'
import { WindowsAudioProxy } from './lib/windows/audio-proxy.mjs'
import { createWindowsFavoriteMethods } from './lib/windows/favorite-state.mjs'
import { buildWindowsFavoriteSongCall, decodeWindowsFavoriteSongResponse,
  WINDOWS_ADD_FAVORITE_SONG_REQUEST_KEY, WINDOWS_REMOVE_FAVORITE_SONG_REQUEST_KEY } from './lib/windows/favorite-call.mjs'
import { buildWindowsPlayLyricInfoCall, decodeWindowsPlayLyricResponse, WINDOWS_PLAY_LYRIC_REQUEST_KEY } from './lib/windows/lyric-call.mjs'
import { searchWindowsCatalog } from './lib/windows/search-catalog.mjs'
import { fetchWindowsAlbumTracks } from './lib/windows/album-call.mjs'
import { fetchWindowsArtistTopSongs, fetchWindowsArtistAlbums, fetchWindowsArtistIntro } from './lib/windows/artist-call.mjs'
import { fetchWindowsLatestReleaseSongs, fetchWindowsRecommendPlaylists, fetchWindowsDailySongs } from './lib/windows/home-call.mjs'
import { resolveWindowsPlaylistBinding } from './lib/windows/playlist-binding.mjs'
import { createWindowsDiscoveryMethods } from './lib/windows/discovery-call.mjs'
import { buildWindowsUserPlaylistsCall, WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
  buildWindowsFavoritePlaylistsCall, WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY,
  buildWindowsPlaylistDetailCall, WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY } from './lib/windows/playlist-call.mjs'
import { decodeWindowsCreatedPlaylists, decodeWindowsFavoritePlaylists,
  decodeWindowsPlaylistDetail, windowsPlaylistReference } from './lib/windows/playlist-data.mjs'
import { serializeWindowsSettings, windowsPlaybackQuality, windowsQualityForm, saveWindowsQuality,
  windowsQualityState, setWindowsPlaybackQuality, normalizeRetiredWindowsQuality, WINDOWS_QUALITY_COMMAND } from './lib/windows/settings.mjs'

let active = null
const playbackFailures = new WeakSet()

function playbackUnavailable(reason, canceled = false) {
  const error = new Error(`${reason} [TE-ERR:provider.playbackUnavailable:reason=${encodeURIComponent(reason)}]`)
  if (canceled) error.name = 'AbortError'
  playbackFailures.add(error)
  return error
}

function terminalPlaybackFailure(error) {
  if (playbackFailures.has(error)) return error
  const details = windowsPlaybackFailureDetails(error)
  let canceled = false
  try { canceled = error?.name === 'AbortError' } catch {}
  return playbackUnavailable(details?.message ?? (canceled ? 'QQ 音乐播放已取消' : 'QQ 音乐当前歌曲无法播放'), canceled)
}

export async function activate(context) {
  if (!context.twilight?.qqAuth) throw new Error('QQ 音乐 Windows 音源需要支持 QQ 官方登录桥的 Twilight 构建')
  if (process.platform !== 'win32') throw new Error('此 QQ 音乐适配版本需要 Windows')
  const state = { context, settings: serializeWindowsSettings(context.settings), client: null,
    closed: false, epoch: 0, device: null, qr: null, songs: new Map(), discovery: null, favorites: null,
    playbackEpoch: 0, playbacks: new Map(), proxy: new WindowsAudioProxy({
      allowedOrigins: WINDOWS_MEDIA_ALLOWED_ORIGINS, leaseTtlMs: 6 * 60 * 60 * 1000,
      onFailure: event => context.logger?.warn?.(`QQ audio proxy failure: ${JSON.stringify(event)}`) }) }
  state.client = new WindowsMusicClient({ settings: state.settings, getDevice: () => getDevice(state) })
  state.favorites = createFavorites(state)
  state.discovery = createWindowsDiscoveryMethods({ client: state.client,
    resolveBinding: ({ disstid, loginUin, signal }) => resolveWindowsPlaylistBinding({
      client: state.client, disstid, loginUin, signal }) })
  active = state
  const handler = fn => async (...args) => {
    if (state.closed) throw fn === getPlaybackUrl ? playbackUnavailable('QQ 音乐音源已停用', true) : new Error('QQ 音乐音源已停用')
    const invocation = args.pop()
    return fn(state, args, invocation)
  }
  const qualityGuard = invocation => () => {
    if (state.closed) throw new Error('QQ 音乐音源已停用')
    if (invocation?.signal?.aborted) {
      const error = new Error('QQ 音乐音质设置已取消')
      error.name = 'AbortError'
      throw error
    }
  }
  await context.twilight.providers.register({
    id: 'qq', name: 'QQ 音乐', capabilities: ['search', 'playbackUrl', 'lyrics', 'cover', 'login', 'playlist', 'library'],
    ui: { icon: 'pi pi-music', color: '#31c27c', description: 'QQ 音乐曲库', authType: 'qr',
      loginInstructions: '请用手机 QQ 扫码；如需安全验证，请在打开的 QQ 官方登录窗口完成。',
      qrStatusCodes: { waiting: 66, scanned: null, expired: 65, denied: 68, success: 0 },
      streamingSearch: true, unifiedLibrary: true,
      streamingHome: { requiresLogin: true, subtitle: 'QQ 音乐推荐与最新发行' },
      streamingDiscovery: { supportsSort: false },
      streamingSections: [
        { id: 'daily', title: '每日推荐', icon: 'pi pi-sun', method: 'fetchRecommendSongs',
          args: ['daily'], requiresLogin: true, description: '当前 QQ 音乐账号的每日30首' },
        { id: 'latest', title: '最新发行歌曲', icon: 'pi pi-music', method: 'fetchRecommendSongs',
          args: ['latest'], requiresLogin: true, description: '最新发行的歌曲预览' }
      ] },
    searchSongs: handler(searchSongs), checkLogin: handler(checkLogin), getProfile: handler(getProfile),
    logout: handler(logout), getQrLogin: handler(getQrLogin), checkQrLogin: handler(checkQrLogin),
    getPlaybackUrl: handler(getPlaybackUrl), getLyrics: handler(getLyrics),
    getTrackPlaybackQualities: handler((s, args, invocation) => withVerifiedDataRead(s, invocation,
      async signal => windowsTrackPlaybackQualities(await getSong(s, args[0], signal, { refresh: true })))),
    getPlaybackQuality: handler((s, _args, invocation) => windowsQualityState(s.settings,
      { guard: qualityGuard(invocation) })),
    setPlaybackQuality: handler((s, args, invocation) => setWindowsPlaybackQuality(s.settings, args[0],
      { guard: qualityGuard(invocation) })),
    fetchUserLibrary: handler(fetchUserLibrary), fetchPlaylistTracks: handler(fetchPlaylistTracks),
    isTrackLiked: handler((s, args, invocation) => s.favorites.isTrackLiked(favoriteTrackId(args[0]), invocation)),
    likeTrack: handler(async (s, args, invocation) => {
      await s.favorites.likeTrack(favoriteTrackId(args[0]), args[1], invocation)
    }),
    fetchAlbumTracks: handler((s, args, invocation) => fetchWindowsAlbumTracks({
      client: s.client, album: args[0], signal: invocation?.signal })),
    fetchArtistTopSongs: handler((s, args, invocation) => artistDetail(s, args, invocation, fetchWindowsArtistTopSongs)),
    fetchArtistAlbums: handler((s, args, invocation) => artistDetail(s, args, invocation, fetchWindowsArtistAlbums)),
    fetchArtistIntro: handler((s, args, invocation) => artistDetail(s, args, invocation, fetchWindowsArtistIntro)),
    fetchRecommendSongs: handler(recommendSongs),
    fetchRecommendPlaylists: handler((s, _args, invocation) => withVerifiedDataRead(s, invocation,
      (signal, owner) => fetchWindowsRecommendPlaylists({ client: s.client, loginUin: owner.session.musicid, signal }))),
    fetchPlaylistCategories: handler((s, _args, invocation) => withVerifiedDataRead(s, invocation,
      signal => s.discovery.fetchPlaylistCategories({ signal }))),
    fetchDiscoveryPlaylists: handler((s, args, invocation) => withVerifiedDataRead(s, invocation,
      (signal, owner) => s.discovery.fetchDiscoveryPlaylists({ cat: args[0], order: args[1],
        limit: args[2], offset: args[3], caller: owner.session.musicid, signal }))),
    searchAlbums: handler((s, args, invocation) => catalogSearch(s, 'album', args, invocation)),
    searchArtists: handler((s, args, invocation) => catalogSearch(s, 'artist', args, invocation)),
    searchPlaylists: handler((s, args, invocation) => catalogSearch(s, 'playlist', args, invocation))
  })
  await context.twilight.ui.register({ id: 'qqmusic-windows-quality', kind: 'settingsPanel',
    title: 'QQ 音乐播放音质', description: 'MP3、FLAC、Hi-Res、杜比、5.1、臻品母带与臻品全景声', command: WINDOWS_QUALITY_COMMAND })
  context.twilight.ui.onCommand(WINDOWS_QUALITY_COMMAND, async (values, invocation) => {
    if (state.closed) throw new Error('QQ 音乐音源已停用')
    const options = { guard: qualityGuard(invocation) }
    return values?.source === 'settingsPanel' ? windowsQualityForm(state.settings, options) : saveWindowsQuality(state.settings, values, options)
  })
}

export async function deactivate() {
  const state = active
  active = null
  if (!state) return
  state.closed = true
  state.epoch++
  state.favorites.dispose()
  state.qr = null
  state.client.close()
  state.songs.clear()
  await Promise.allSettled([revokePlayback(state), state.proxy.close(), state.context.twilight.qqAuth.clear()])
}

async function getDevice(state) {
  if (!state.device) state.device = (async () => {
    const stored = await state.settings.get('windows-device')
    let guid = stored?.guid
    if (typeof guid !== 'string' || !/^[a-fA-F0-9]{32}$/.test(guid)) {
      guid = randomBytes(16).toString('hex')
      await state.settings.set('windows-device', { guid })
    }
    // An installation-local GUID and channel 0 are adapter inputs, not an original QQ identifier.
    return { guid, deviceName: hostname(), channelId: 0,
      encodedOsVersion: encodeURIComponent(`Windows ${release()}`) }
  })().catch(error => { state.device = null; throw error })
  return state.device
}

function profile(session) {
  return session ? { id: session.musicid, nickname: 'QQ 音乐用户', avatarUrl: null } : null
}

async function checkLogin(state, _args, invocation) {
  const loggedIn = await state.client.checkLogin({ signal: invocation?.signal })
  return { loggedIn, profile: loggedIn ? profile(await state.client.getSession()) : null }
}

async function getProfile(state, args, invocation) {
  return (await checkLogin(state, args, invocation)).profile
}

async function logout(state) {
  state.epoch++
  state.favorites.invalidate()
  state.qr = null
  const result = await Promise.allSettled([state.client.logout(), state.context.twilight.qqAuth.clear(), revokePlayback(state)])
  state.songs.clear()
  const failure = result.find(item => item.status === 'rejected')
  if (failure) throw failure.reason
}

async function getQrLogin(state, _args, invocation) {
  const epoch = ++state.epoch
  state.favorites.invalidate()
  state.qr = null
  await state.client.cancelPending()
  await state.context.twilight.qqAuth.clear()
  const qr = await state.context.twilight.qqAuth.getQrLogin({ signal: invocation?.signal })
  if (state.closed || state.epoch !== epoch || invocation?.signal?.aborted) {
    if (state.epoch === epoch) await state.context.twilight.qqAuth.clear()
    throw new Error('QQ 音乐登录已取消')
  }
  state.qr = { key: qr.key, epoch, exchange: null, pending: null }
  return { key: qr.key, imageDataUrl: qr.imageDataUrl, expiresInSeconds: 600 }
}

async function checkQrLogin(state, args, invocation) {
  const qr = state.qr
  if (!qr || typeof args[0] !== 'string' || qr.key !== args[0]) return { code: 65 }
  if (qr.exchange) return qr.exchange
  if (qr.pending) return qr.pending
  qr.pending = pollQrLogin(state, qr, invocation).finally(() => { qr.pending = null })
  return qr.pending
}

async function pollQrLogin(state, qr, invocation) {
  const status = await state.context.twilight.qqAuth.checkQrLogin(qr.key)
  if (state.closed || state.qr !== qr || state.epoch !== qr.epoch) return { code: 65 }
  if (status.status !== 'authorized') {
    return { code: status.status === 'waiting' ? 66 : status.status === 'closed' ? 68 : 65 }
  }
  qr.exchange = (async () => {
    try {
      await state.client.loginWithQQCode(status.code, { signal: invocation?.signal })
      if (state.closed || state.qr !== qr || state.epoch !== qr.epoch) return { code: 65 }
      await revokePlayback(state)
      if (state.closed || state.qr !== qr || state.epoch !== qr.epoch) return { code: 65 }
      return { code: 0, profile: profile(await state.client.getSession()) }
    } finally {
      if (state.qr === qr && state.epoch === qr.epoch) await state.context.twilight.qqAuth.clear()
    }
  })()
  return qr.exchange
}

async function searchSongs(state, args, invocation) {
  const query = typeof args[0] === 'string' ? args[0].trim() : ''
  if (!query || query.length > 256 || query.includes('\0')) throw new Error('请输入有效的搜索关键词')
  const window = windowsSearchWindow(args[1] ?? 30, args[2] ?? 0)
  // Same wire shape as native GUID+%05d; entropy source is an adapter choice.
  const searchId = randomBytes(16).toString('hex').toUpperCase() + String(randomInt(100000)).padStart(5, '0')
  const result = []
  let total = 0
  const pages = Math.ceil((window.skip + window.limit) / window.pageSize)
  for (let page = window.page, skip = window.skip; page < window.page + pages && result.length < window.limit; page++, skip = 0) {
    const call = buildWindowsDesktopSearchCall({ query, pageNum: page, numPerPage: window.pageSize,
      searchType: 0, remoteplace: 'pc.button.search.song', searchId })
    const data = await state.client.request(WINDOWS_DESKTOP_SEARCH_REQUEST_KEY, call, { signal: invocation?.signal })
    const response = windowsSearchPage(data)
    total = response.total
    for (const song of response.songs.slice(skip)) {
      const track = mapWindowsTrack(song)
      if (track) {
        result.push(track)
        // Search metadata can be displayable before its media MID is supplied.
        // Keep the existing native detail lookup available for those records.
        try { windowsSongMedia(song); state.songs.set(song.mid, { song, at: Date.now() }) } catch {}
      }
      if (result.length >= window.limit) break
    }
    while (state.songs.size > 1000) state.songs.delete(state.songs.keys().next().value)
    if (response.songs.length < window.pageSize || page * window.pageSize >= total) break
  }
  return { items: result, total }
}

async function getSong(state, track, signal, { refresh = false } = {}) {
  const reference = windowsSongReference(track)
  const cached = state.songs.get(reference.songmid)
  if (!refresh && cached && Date.now() - cached.at < 300000) {
    try { if (windowsSongMedia(cached.song).songid === reference.songid) return cached.song } catch {}
    state.songs.delete(reference.songmid)
  }
  // The native scene0 request has been verified to return the complete public song DTO.
  const call = buildWindowsTrackInfoCall({ ids: [Number(reference.songid)], types: [0], ctx: 0, scene: 0 })
  const data = await state.client.request(WINDOWS_TRACK_INFO_REQUEST_KEY, call, { signal })
  const song = Array.isArray(data.tracks) ? data.tracks.find(row =>
    String(row?.id) === reference.songid && row?.mid === reference.songmid) : null
  if (!song || !mapWindowsTrack(song)) throw new Error('QQ 音乐歌曲详情无效')
  windowsSongMedia(song)
  state.songs.set(reference.songmid, { song, at: Date.now() })
  while (state.songs.size > 1000) state.songs.delete(state.songs.keys().next().value)
  return song
}

async function catalogSearch(state, kind, args, invocation) {
  const search = signal => searchWindowsCatalog({ client: state.client, kind, query: args[0],
    limit: args[1] ?? 30, offset: args[2] ?? 0, signal,
    searchId: randomBytes(16).toString('hex').toUpperCase() + String(randomInt(100000)).padStart(5, '0') })
  if (kind !== 'playlist') return search(invocation?.signal)
  return withVerifiedDataRead(state, invocation, async (signal, owner) => {
    const candidates = await search(signal)
    const items = []
    for (const candidate of candidates.items) {
      checkLibraryEpoch(state, owner, signal)
      const { disstid } = windowsPlaylistReference(candidate.id)
      const binding = await resolveWindowsPlaylistBinding({ client: state.client,
        loginUin: owner.session.musicid, disstid, signal })
      // Search's creator is display metadata. Only the native reply publishes
      // the canonical playlist identity and its verified complete track count.
      items.push({ ...candidate, id: binding.playlistId, trackCount: binding.detail.total })
    }
    return { items, total: candidates.total }
  })
}

async function verifiedLibrarySession(state, signal) {
  if (!await state.client.checkLogin({ signal })) throw new Error('请先扫码登录 QQ 音乐')
  const session = await state.client.getSession()
  if (!session) throw new Error('请先扫码登录 QQ 音乐')
  return { session, epoch: state.epoch }
}

function favoriteTrackId(value) {
  // The renderer bridge removes the provider prefix for likeTrack/isTrackLiked.
  const id = typeof value === 'string' && !value.startsWith('qq:') ? `qq:${value}` : value
  const reference = windowsSongReference(id)
  return `qq:${reference.songmid}:${reference.songid}`
}

function createFavorites(state) {
  const assertOwner = async (owner, signal) => {
    await checkLibraryRequest(state, owner, signal)
    const current = await state.client.getSession()
    checkLibraryEpoch(state, owner, signal)
    if (!current || windowsPlaybackSessionFingerprint(current) !== owner.fingerprint) {
      const error = new Error('QQ 音乐收藏会话已变化，请刷新后重试')
      error.name = 'AbortError'
      throw error
    }
  }
  return createWindowsFavoriteMethods({
    getOwner: async signal => {
      const owner = await verifiedLibrarySession(state, signal)
      const fingerprint = windowsPlaybackSessionFingerprint(owner.session)
      return { ...owner, fingerprint, key: `${owner.epoch}:${fingerprint}` }
    },
    assertOwner,
    readSnapshot: async (owner, signal) => {
      const { likedPlaylist } = await fetchUserLibrary(state, [], { signal })
      await assertOwner(owner, signal)
      if (!likedPlaylist || likedPlaylist.owned !== true) throw new Error('QQ 音乐未返回当前账号的喜欢列表')
      const reference = windowsPlaylistReference(likedPlaylist)
      if (reference.dirid !== '201' || reference.hostUin !== owner.session.musicid) {
        throw new Error('QQ 音乐喜欢列表身份无效')
      }
      const detail = await playlistDetail(state, likedPlaylist.id, signal)
      await assertOwner(owner, signal)
      return { playlist: likedPlaylist, trackIds: detail.tracks.map(track => track.id) }
    },
    write: async (id, liked, snapshot, owner, signal) => {
      const reference = windowsPlaylistReference(snapshot.playlist)
      if (reference.hostUin !== owner.session.musicid || reference.dirid !== '201' || snapshot.playlist.owned !== true) {
        throw new Error('QQ 音乐喜欢列表身份无效')
      }
      const song = windowsSongMedia(await getSong(state, id, signal, { refresh: true }))
      if (song.songtype !== 0) throw new Error('当前 QQ 音乐记录尚不支持修改喜欢状态')
      const options = { ...reference, directoryName: snapshot.playlist.name,
        songId: song.songid, songType: song.songtype, liked }
      const call = buildWindowsFavoriteSongCall(options)
      await assertOwner(owner, signal)
      const data = await state.client.request(liked ? WINDOWS_ADD_FAVORITE_SONG_REQUEST_KEY
        : WINDOWS_REMOVE_FAVORITE_SONG_REQUEST_KEY, call, { signal })
      await assertOwner(owner, signal)
      decodeWindowsFavoriteSongResponse(data, options)
    }
  })
}

async function artistDetail(state, args, invocation, fetcher) {
  const artist = args[0]
  return withVerifiedDataRead(state, invocation,
    signal => fetcher({ client: state.client, artist, signal }))
}

async function withVerifiedDataRead(state, invocation, fetcher) {
  const signal = invocation?.signal
  const owner = await verifiedLibrarySession(state, signal)
  const result = await fetcher(signal, owner)
  await checkLibraryRequest(state, owner, signal)
  checkLibraryEpoch(state, owner, signal)
  return result
}

async function recommendSongs(state, args, invocation) {
  const section = args[0] ?? 'daily'
  if (args.length > 1 || !['daily', 'latest'].includes(section)) throw new Error('QQ 音乐首页分区无效')
  return withVerifiedDataRead(state, invocation, signal => section === 'daily'
    ? fetchWindowsDailySongs({ client: state.client, getDevice: () => getDevice(state), signal })
    : fetchWindowsLatestReleaseSongs({ client: state.client, signal }))
}

function checkLibraryEpoch(state, owner, signal) {
  if (state.closed || state.epoch !== owner.epoch || signal?.aborted) {
    throw new Error('QQ 音乐资料库请求已取消')
  }
}

async function checkLibraryRequest(state, owner, signal) {
  const current = await state.client.getSession()
  checkLibraryEpoch(state, owner, signal)
  if (current?.musicid !== owner.session.musicid) throw new Error('QQ 音乐资料库请求已取消')
}

async function fetchUserLibrary(state, args, invocation) {
  if (args[0] !== undefined && typeof args[0] !== 'boolean') throw new Error('QQ 音乐资料库参数无效')
  const signal = invocation?.signal
  const owner = await verifiedLibrarySession(state, signal)
  const options = { sessionUin: owner.session.musicid }
  const createdData = await state.client.request(WINDOWS_USER_PLAYLISTS_REQUEST_KEY,
    buildWindowsUserPlaylistsCall({ uin: owner.session.musicid }), { signal })
  await checkLibraryRequest(state, owner, signal)
  const favoriteData = await state.client.request(WINDOWS_FAVORITE_PLAYLISTS_REQUEST_KEY,
    buildWindowsFavoritePlaylistsCall({ uin: owner.session.musicid }), { signal })
  await checkLibraryRequest(state, owner, signal)
  const created = decodeWindowsCreatedPlaylists(createdData, options)
  const favorites = decodeWindowsFavoritePlaylists(favoriteData, { ...options, visibleOnly: true })
  if (!created.finished || favorites.hasMore) throw new Error('QQ 音乐资料库尚未返回完整数据')
  const playlists = [...created.playlists]
  const identity = playlist => {
    const ref = windowsPlaylistReference(playlist)
    return `${ref.hostUin}:${ref.disstid}`
  }
  const seen = new Set(playlists.map(identity))
  for (const playlist of favorites.playlists) {
    const key = identity(playlist)
    if (!seen.has(key)) { playlists.push(playlist); seen.add(key) }
  }
  const likedPlaylist = created.playlists.find(playlist => windowsPlaylistReference(playlist).dirid === '201') ?? null
  checkLibraryEpoch(state, owner, signal)
  return { likedPlaylist, playlists }
}

async function playlistDetail(state, playlistId, signal) {
  const reference = windowsPlaylistReference(playlistId)
  const owner = await verifiedLibrarySession(state, signal)
  const call = buildWindowsPlaylistDetailCall({ loginUin: owner.session.musicid,
    hostUin: reference.hostUin, disstid: reference.disstid, dirid: reference.dirid })
  const data = await state.client.request(WINDOWS_PLAYLIST_DETAIL_REQUEST_KEY, call, { signal })
  await checkLibraryRequest(state, owner, signal)
  const detail = decodeWindowsPlaylistDetail(data, { playlistId, sessionUin: owner.session.musicid })
  if (!detail.complete) throw new Error('QQ 音乐歌单尚未返回完整数据')
  checkLibraryEpoch(state, owner, signal)
  for (const song of data.songlist) {
    if (mapWindowsTrack(song)?.playbackStatus !== 'unsupported') state.songs.set(song.mid, { song, at: Date.now() })
  }
  while (state.songs.size > 1000) state.songs.delete(state.songs.keys().next().value)
  return detail
}

async function fetchPlaylistTracks(state, args, invocation) {
  if (args[1] !== undefined && typeof args[1] !== 'boolean') throw new Error('QQ 音乐歌单参数无效')
  return (await playlistDetail(state, args[0], invocation?.signal)).tracks
}

async function revokePlayback(state) {
  state.playbackEpoch++
  const entries = [...state.playbacks.values()]
  state.playbacks.clear()
  for (const entry of entries) { clearTimeout(entry.timer); entry.resolver.dispose() }
  await state.proxy.revokeAll()
}

async function getLyrics(state, args, invocation) {
  const song = windowsSongMedia(await getSong(state, args[0], invocation?.signal))
  const call = buildWindowsPlayLyricInfoCall({ songID: Number(song.songid), songName: song.title,
    singerName: song.singerName, albumName: song.albumName, interval: song.interval,
    type: song.songtype, requestMode: 0 })
  const data = await state.client.request(WINDOWS_PLAY_LYRIC_REQUEST_KEY, call, { signal: invocation?.signal })
  return decodeWindowsPlayLyricResponse(data)
}

async function getPlaybackUrl(state, args, invocation) {
  const epoch = state.playbackEpoch
  const accountEpoch = state.epoch
  const signal = invocation?.signal
  const assertCurrent = () => {
    if (state.closed || state.playbackEpoch !== epoch || state.epoch !== accountEpoch || signal?.aborted) {
      throw playbackUnavailable('QQ 音乐播放已取消', true)
    }
  }
  try {
    assertCurrent()
    if (!await state.client.checkLogin({ signal })) throw playbackUnavailable('请先使用手机 QQ 扫码登录')
    assertCurrent()
    const owner = await verifiedLibrarySession(state, signal)
    assertCurrent()
    const fingerprint = windowsPlaybackSessionFingerprint(owner.session)
    const confirmCurrent = async () => {
      assertCurrent()
      let session
      try { session = await state.client.getSession() } catch (error) { assertCurrent(); throw error }
      assertCurrent()
      let currentFingerprint
      try { currentFingerprint = windowsPlaybackSessionFingerprint(session) } catch {}
      // A quality chain is one authorization transaction. Even replacement
      // credentials for the same musicid cannot continue an earlier attempt.
      if (currentFingerprint !== fingerprint) throw playbackUnavailable('QQ 音乐会话已变化，播放已取消', true)
    }
    const options = args[1] ?? {}
    if (typeof options !== 'object' || options === null || Array.isArray(options)) throw playbackUnavailable('QQ 音乐音质参数无效')
    // One exact TrackInfo row owns every attempt. Falling back never searches,
    // rematches a recording, or writes the user's preferred quality.
    const song = windowsSongMedia(await getSong(state, args[0], signal, { refresh: true }))
    await confirmCurrent()
    const preferred = normalizeRetiredWindowsQuality(options.quality ?? await windowsPlaybackQuality(state.settings))
    await confirmCurrent()
    const candidates = windowsQualityFallbacks(preferred)
    if (!candidates.length) throw playbackUnavailable('QQ 音乐音质参数无效')
    let lastFailure = playbackUnavailable('当前歌曲没有可用的播放音质')
    for (const quality of candidates) {
      await confirmCurrent()
      if (song.sizes[windowsQualityDefinition(quality).sizeKey] === 0) continue
      let resolver
      let lease
      let entry
      try {
        resolver = createWindowsPlaybackResolver({ client: state.client, getDevice: () => getDevice(state), song, quality })
        // A published lease keeps this exact resolver, including later transport
        // refreshes. Range identity cannot change to another quality midstream.
        lease = await state.proxy.open({ signal, durationSeconds: song.interval, resolve: request => {
          assertCurrent()
          return resolver.resolve(request)
        } })
        await confirmCurrent()
        entry = { resolver, lease, timer: null }
        entry.timer = setTimeout(() => {
          state.playbacks.delete(lease.url)
          resolver.dispose()
          lease.release().catch(() => {})
        }, Math.max(1, lease.expiresAt - Date.now()))
        entry.timer.unref?.()
        state.playbacks.set(lease.url, entry)
        while (state.playbacks.size > 512) {
          const [url, previous] = state.playbacks.entries().next().value
          state.playbacks.delete(url)
          clearTimeout(previous.timer)
          previous.resolver.dispose()
          await previous.lease.release()
        }
        await confirmCurrent()
        return { streamUrl: lease.url, providerSource: { actualQuality: quality,
          ...(lease.bytes === undefined ? {} : { bytes: lease.bytes }), expiresAt: lease.expiresAt } }
      } catch (error) {
        if (entry) { clearTimeout(entry.timer); state.playbacks.delete(lease.url) }
        resolver?.dispose()
        await Promise.allSettled(lease ? [lease.release()] : [])
        await confirmCurrent()
        const details = windowsPlaybackFailureDetails(error)
        if (!details?.recoverableQuality) throw error
        lastFailure = error
      }
    }
    throw lastFailure
  } catch (error) {
    // Terminal same-track failure survives Electron IPC so the host can stop
    // before generic re-matching or queue-advance recovery. Never quote upstream
    // error text, which may contain an account, signed URL, or key.
    const details = windowsPlaybackFailureDetails(error)
    try { if (details) state.context.logger?.warn?.(`QQ playback source validation: ${details.code}`) } catch {}
    throw terminalPlaybackFailure(error)
  }
}
