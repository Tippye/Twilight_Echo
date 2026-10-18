import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from 'vue'
import type { Track } from '../../types/music.ts'
import { syncPluginProviders } from '../../providers/index.ts'
import { useAppNoticeStore } from '../../stores/useAppNoticeStore.ts'
import { parseAppError } from '../../../../shared/errors/appError.ts'
import {
  notifyProviderFavoriteChange,
  providerFavoriteChange,
  providerFavoriteTrackKey
} from '../../providers/providerFavoriteChanges.ts'
import {
  getTrackProviderId,
  isPluginProviderEnabled,
  resolveProviderTrackId,
  type MediaProviderRegistry
} from '../../providers/mediaProvider.ts'

const DEFAULT_FAVORITE_PLAYLIST_NAME = '我收藏的音乐'

type FavoritePlaylist = {
  id: string
  name: string
  trackIds: string[]
  isDefault?: boolean
}

type UseFavoriteButtonOptions = {
  currentTrack: ComputedRef<Track | null> | Ref<Track | null>
  playlists: ComputedRef<FavoritePlaylist[]> | Ref<FavoritePlaylist[]>
  mediaProviders: MediaProviderRegistry
  addToPlaylist: (playlistName: string, trackId: string) => void
  removeFromPlaylist: (playlistName: string, trackId: string) => void
  createPlaylist: (name: string) => void
  isFavoriteTrack?: (track: Track) => boolean
  addFavoriteTrack?: (track: Track) => void
  removeFavoriteTrack?: (track: Track) => void
}

function isLocalTrack(track: Pick<Track, 'id' | 'source'>): boolean {
  const providerId = getTrackProviderId(track)
  return providerId == null || providerId === 'local'
}

export function useFavoriteButton({
  currentTrack,
  playlists,
  mediaProviders,
  addToPlaylist,
  removeFromPlaylist,
  createPlaylist,
  isFavoriteTrack,
  addFavoriteTrack,
  removeFavoriteTrack
}: UseFavoriteButtonOptions): {
  favoriteButtonVisible: ComputedRef<boolean>
  favoriteButtonLiked: ComputedRef<boolean>
  favoriteButtonLoading: ComputedRef<boolean>
  favoriteButtonTitle: ComputedRef<string>
  toggleFavorite: () => Promise<void>
} {
  const providerFavoriteAvailable = ref(false)
  const providerFavoriteLoading = ref(false)
  const providerFavoriteReading = ref(false)
  const providerFavoriteLiked = ref(false)
  // 当前 provider 喜欢状态对应的曲目 id：切歌后旧曲目的状态绝不能
  // 显示到新曲目上（心动模式等场景会频繁快速切歌）。
  const providerFavoriteTrackId = ref<string | null>(null)
  let providerFavoriteRequestId = 0
  let active = true
  let favoriteOwner = ''

  function ownerKey(providerId: string): string {
    const provider = mediaProviders.get(providerId)
    return JSON.stringify([
      providerId,
      mediaProviders.getGeneration?.(providerId) ?? 0,
      provider?.health?.pluginId,
      !!provider?.likeTrack,
      !!provider?.isTrackLiked,
      !!provider && isPluginProviderEnabled(provider.health)
    ])
  }

  const defaultFavoritePlaylist = computed(
    () =>
      playlists.value.find((playlist) => playlist.isDefault) ??
      playlists.value.find((playlist) => playlist.name === DEFAULT_FAVORITE_PLAYLIST_NAME) ??
      null
  )

  const localFavoriteLiked = computed(() => {
    const track = currentTrack.value
    if (track && isFavoriteTrack) return isFavoriteTrack(track)
    const playlist = defaultFavoritePlaylist.value
    return !!track && !!playlist && playlist.trackIds.includes(track.id)
  })

  const favoriteButtonVisible = computed(() => {
    const track = currentTrack.value
    if (!track) return false
    return isLocalTrack(track) || providerFavoriteAvailable.value
  })

  const favoriteButtonLiked = computed(() => {
    const track = currentTrack.value
    if (!track) return false
    if (isLocalTrack(track)) return localFavoriteLiked.value
    return (
      providerFavoriteLiked.value &&
      providerFavoriteTrackId.value != null &&
      providerFavoriteTrackId.value === track.id
    )
  })

  const favoriteButtonLoading = computed(() => {
    const track = currentTrack.value
    return (
      !!track &&
      !isLocalTrack(track) &&
      (providerFavoriteLoading.value || providerFavoriteReading.value)
    )
  })

  const favoriteButtonTitle = computed(() => {
    const track = currentTrack.value
    const platform =
      track && !isLocalTrack(track)
        ? mediaProviders.get(getTrackProviderId(track) ?? '')?.name
        : null
    const action = track && getTrackProviderId(track) === 'bili' ? '收藏' : '喜欢'
    return platform
      ? favoriteButtonLiked.value
        ? '在' + platform + '取消' + action
        : '在' + platform + action
      : favoriteButtonLiked.value
        ? '移出应用收藏'
        : '加入应用收藏'
  })

  async function refreshProviderFavoriteState(track: Track | null | undefined): Promise<void> {
    const requestId = ++providerFavoriteRequestId
    providerFavoriteAvailable.value = false
    providerFavoriteLiked.value = false
    providerFavoriteReading.value = false
    providerFavoriteTrackId.value = null
    favoriteOwner = ''
    if (!track || isLocalTrack(track)) return

    const providerId = getTrackProviderId(track)
    if (!providerId) return
    const providerTrackId = resolveProviderTrackId(track, providerId)
    if (providerTrackId == null) return

    if (typeof window !== 'undefined' && window.api?.providers) {
      await syncPluginProviders()
      if (!active || requestId !== providerFavoriteRequestId) return
    }

    const provider = mediaProviders.get(providerId)
    const owner = ownerKey(providerId)
    favoriteOwner = owner
    providerFavoriteAvailable.value = Boolean(
      provider?.likeTrack && isPluginProviderEnabled(provider.health)
    )
    if (provider && !isPluginProviderEnabled(provider.health)) return
    if (!provider?.isTrackLiked) return

    providerFavoriteReading.value = true
    try {
      const liked = await provider.isTrackLiked(providerTrackId)
      if (active && requestId === providerFavoriteRequestId && ownerKey(providerId) === owner) {
        providerFavoriteLiked.value = liked
        providerFavoriteTrackId.value = track.id
      }
    } catch (error) {
      console.warn(`Failed to read ${providerId} favorite state`, error)
    } finally {
      if (requestId === providerFavoriteRequestId) providerFavoriteReading.value = false
    }
  }

  function toggleLocalFavorite(track: Track): void {
    if (isFavoriteTrack && addFavoriteTrack && removeFavoriteTrack) {
      if (isFavoriteTrack(track)) {
        removeFavoriteTrack(track)
      } else {
        addFavoriteTrack(track)
      }
      return
    }

    let playlist = defaultFavoritePlaylist.value
    if (!playlist) {
      createPlaylist(DEFAULT_FAVORITE_PLAYLIST_NAME)
      playlist = defaultFavoritePlaylist.value
    }
    if (!playlist) return

    if (playlist.trackIds.includes(track.id)) {
      removeFromPlaylist(playlist.name, track.id)
    } else {
      addToPlaylist(playlist.name, track.id)
    }
  }

  async function toggleProviderFavorite(track: Track): Promise<void> {
    if (providerFavoriteLoading.value) return
    const providerId = getTrackProviderId(track)
    if (!providerId) return
    if (providerFavoriteReading.value) return
    const providerTrackId = resolveProviderTrackId(track, providerId)
    if (providerTrackId == null) return

    const trackId = track.id
    const owner = ownerKey(providerId)
    const nextLiked = !favoriteButtonLiked.value
    const requestId = ++providerFavoriteRequestId
    providerFavoriteLoading.value = true
    try {
      if (typeof window !== 'undefined' && window.api?.providers) {
        await syncPluginProviders()
      }
      const provider = mediaProviders.get(providerId)
      if (
        !active ||
        requestId !== providerFavoriteRequestId ||
        !provider?.likeTrack ||
        !isPluginProviderEnabled(provider.health) ||
        currentTrack.value?.id !== trackId ||
        ownerKey(providerId) !== owner
      )
        return

      await provider.likeTrack(providerTrackId, nextLiked)
      if (!active || requestId !== providerFavoriteRequestId || ownerKey(providerId) !== owner)
        return
      notifyProviderFavoriteChange(providerId, providerTrackId, nextLiked)
      if (active && currentTrack.value?.id === trackId && ownerKey(providerId) === owner) {
        providerFavoriteLiked.value = nextLiked
        providerFavoriteTrackId.value = trackId
      }
    } catch (error) {
      console.warn(`Failed to toggle ${providerId} favorite state`, error)
      useAppNoticeStore().pushNotice({
        kind: 'error',
        message: parseAppError(error).message || '修改收藏失败，请稍后重试'
      })
    } finally {
      providerFavoriteLoading.value = false
    }
  }

  async function toggleFavorite(): Promise<void> {
    const track = currentTrack.value
    if (!track) return

    if (!isLocalTrack(track)) {
      await toggleProviderFavorite(track)
      return
    }

    toggleLocalFavorite(track)
  }

  watch(
    [
      () => currentTrack.value?.id,
      () => currentTrack.value?.source,
      () => currentTrack.value?.ncmSongId
    ],
    () => {
      void refreshProviderFavoriteState(currentTrack.value)
    },
    { immediate: true }
  )

  if (getCurrentScope() && typeof window !== 'undefined' && window.api?.plugins?.onChanged) {
    const unsubscribe = window.api.plugins.onChanged(() => {
      void syncPluginProviders()
        .then(() => {
          const track = currentTrack.value
          const providerId = track && getTrackProviderId(track)
          if (active && providerId && ownerKey(providerId) !== favoriteOwner) {
            void refreshProviderFavoriteState(track)
          }
        })
        .catch(() => undefined)
    })
    onScopeDispose(() => {
      active = false
      providerFavoriteRequestId++
      unsubscribe()
    })
  }

  watch(
    providerFavoriteChange,
    (change) => {
      const track = currentTrack.value
      if (!change || !track || getTrackProviderId(track) !== change.providerId) return
      if (
        providerFavoriteTrackKey(change.providerId, change.trackId) !==
        providerFavoriteTrackKey(change.providerId, track.id)
      )
        return
      ++providerFavoriteRequestId
      providerFavoriteReading.value = false
      providerFavoriteLiked.value = change.liked
      providerFavoriteTrackId.value = track.id
    },
    { flush: 'sync' }
  )

  return {
    favoriteButtonVisible,
    favoriteButtonLiked,
    favoriteButtonLoading,
    favoriteButtonTitle,
    toggleFavorite
  }
}
