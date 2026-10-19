import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMusicStore } from '@renderer/stores/useMusicStore.ts'
import { usePlayerStore } from '@renderer/stores/usePlayerStore.ts'
import { useSettingsStore } from '@renderer/stores/useSettingsStore.ts'
import { useUnifiedMusicSearch } from '@renderer/app/useUnifiedMusicSearch.ts'
import { createCommandPaletteActions } from '@renderer/app/commandPaletteActions.ts'
import type { useAppNavigation } from '@renderer/app/useAppNavigation.ts'
import {
  BUILTIN_NAVIGATION_PAGES,
  type NavigationPageDefinition
} from '@renderer/app/navigationPages.ts'
import { isCommandPaletteKey } from '../../../shared/commandPaletteShortcut.ts'

export function useCommandPalette(
  navigation: ReturnType<typeof useAppNavigation>,
  getPages: () => NavigationPageDefinition[] = () => BUILTIN_NAVIGATION_PAGES
) {
  const isOpen = ref(false)
  const music = useMusicStore()
  const player = usePlayerStore()
  const settings = useSettingsStore()
  const search = useUnifiedMusicSearch()
  const actions = computed(() => [
    ...createCommandPaletteActions({
      navigation,
      currentTrack: player.currentTrack.value,
      playing: player.isPlaying.value,
      loading: player.isLoading.value,
      lyricsVisible: settings.settings.value.desktopLyrics.enabled,
      togglePlay: player.togglePlay,
      queue: {
        length: player.queue.value.length,
        canUndo: player.canUndoQueue.value,
        undoLabel: player.queueUndoLabel.value,
        undo: player.undoQueue,
        clear: player.clearQueue,
        showSessions: () => player.queueSessions.show(),
        showHistory: () => player.queueSessions.show('history')
      },
      showLyrics: async () => {
        const enabled = await window.api.desktopLyrics.setEnabled(true)
        await settings.updateSettings({
          desktopLyrics: { ...settings.settings.value.desktopLyrics, enabled }
        })
      }
    }),
    ...getPages().map((page) => ({
      id: 'page:' + page.id,
      title: '打开' + page.title,
      description: page.unavailableReason ?? page.description,
      terms: page.title + ' ' + page.description,
      group: '操作' as const,
      run: () => navigation.navigate(page.target)
    }))
  ])
  function close(): void {
    isOpen.value = false
    search.clear()
  }
  function open(): void {
    search.clear()
    isOpen.value = true
  }
  function onKeydown(event: KeyboardEvent): void {
    if (
      settings.settings.value.shortcutEnabled?.commandPalette === false ||
      !isCommandPaletteKey(event)
    )
      return
    if (
      !isOpen.value &&
      event.target instanceof Element &&
      event.target.closest('dialog, [role="dialog"], [role="menu"]')
    )
      return
    event.preventDefault()
    if (isOpen.value) close()
    else open()
  }
  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('pagehide', close)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('pagehide', close)
    close()
  })
  return {
    isOpen,
    open,
    close,
    search,
    actions,
    playlists: music.playlists,
    tracks: music.tracks,
    playTrack: player.playTrack,
    openPlaylist: navigation.openLibraryPlaylist
  }
}
