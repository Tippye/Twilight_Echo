import { computed, ref } from 'vue'
import type { InstalledExperience } from '../../../shared/pluginExperience.ts'
import type { StructuredPluginTheme } from '../../../shared/theme.ts'
import type { PluginPlaylistImportNotice } from '../../../shared/pluginPlaylistImport.ts'
import { useAppNoticeStore } from '../stores/useAppNoticeStore'
import { useMusicStore } from '../stores/useMusicStore'
import { consumePluginPlaylistImports } from './playlistImports.ts'

export type UiContributionKind =
  | 'sidebarPage'
  | 'playerBarButton'
  | 'settingsPanel'
  | 'localSidebarItem'
  | 'streamingHome'

export interface UiContribution {
  experience?: InstalledExperience
  pluginId: string
  id: string
  kind: UiContributionKind
  title: string
  description?: string
  icon?: string
  command?: string
  /** Legacy transport field. The host always normalizes this to command-only rendering. */
  renderMode?: 'command'
  autoLoad?: boolean
}

export interface ThemeContribution {
  pluginId: string
  id: string
  name: string
  description?: string
  variables?: Record<string, string>
  stylesheet?: string
  structured?: StructuredPluginTheme
  compatibilityNotes?: string[]
}

interface PluginExtensionContribution {
  pluginId: string
  ui: UiContribution[]
  themes: ThemeContribution[]
}

const uiContributions = ref<UiContribution[]>([])
const themeContributions = ref<ThemeContribution[]>([])
const syncInFlight = ref<Promise<void> | null>(null)
let listenerSetup = false

export function useExtensionRegistry() {
  setupExtensionChangeListener()
  return {
    uiContributions: computed(() => uiContributions.value),
    themeContributions: computed(() => themeContributions.value),
    syncExtensions
  }
}

function setupExtensionChangeListener(): void {
  if (listenerSetup) return
  listenerSetup = true
  window.api.plugins.onChanged(() => {
    void syncExtensions()
  })
  window.api.plugins.onNotice((notice) => {
    useAppNoticeStore().pushNotice({
      kind: notice.kind,
      message: notice.message,
      durationMs: notice.durationMs,
      dedupeKey: `plugin-notice:${notice.pluginId}:${notice.kind}`
    })
  })
}

export function startPluginPlaylistImports(ready: Promise<unknown>): Promise<() => void> {
  return consumePluginPlaylistImports({
    ready,
    subscribe: window.api.plugins.onImportPlaylist,
    take: window.api.plugins.takePlaylistImports,
    apply: importPluginPlaylist,
    onError: (error) => {
      useAppNoticeStore().pushNotice({
        kind: 'error',
        message: `插件导入歌单失败：${error instanceof Error ? error.message : String(error)}`,
        durationMs: 10000
      })
    }
  })
}

/**
 * Applies a plugin's local-playlist import through the ordinary store actions,
 * so it goes through the same matching and revision-guarded persistence as the
 * built-in importer. The plugin is not told the outcome — this toast is.
 */
function importPluginPlaylist(request: PluginPlaylistImportNotice): void {
  const notices = useAppNoticeStore()
  try {
    const store = useMusicStore()
    let importedCount = 0
    let unresolvedEntries = 0
    for (const result of store.importPlaylistPathBatch(request.playlists)) {
      importedCount += result.importedCount
      unresolvedEntries += result.unresolvedEntries
    }
    const playlistCount = request.playlists.length
    const message =
      importedCount > 0
        ? `已从 ${playlistCount} 个歌单导入 ${importedCount} 首到本地歌单` +
          (unresolvedEntries > 0 ? `，${unresolvedEntries} 首不在本地音乐库中` : '')
        : `${playlistCount} 个歌单里的曲目都不在本地音乐库中，未导入任何歌曲`
    notices.pushNotice({
      kind: importedCount > 0 ? 'success' : 'warning',
      message,
      durationMs: 8000,
      dedupeKey: `plugin-import:${request.pluginId}`
    })
  } catch (error) {
    notices.pushNotice({
      kind: 'error',
      message: `插件导入歌单失败：${error instanceof Error ? error.message : String(error)}`,
      durationMs: 10000
    })
  }
}

export async function syncExtensions(): Promise<void> {
  if (syncInFlight.value) return syncInFlight.value
  const api = window.api?.extensions
  if (!api) return

  syncInFlight.value = (async () => {
    const entries = await api.list()
    const nextUi: UiContribution[] = []
    for (const experience of await api.experiences?.() ?? []) {
      nextUi.push({ pluginId: experience.pluginId, id: experience.id, kind: 'sidebarPage',
        title: experience.name, icon: 'pi pi-box', experience })
    }
    const nextThemes: ThemeContribution[] = []
    for (const entry of entries as PluginExtensionContribution[]) {
      nextUi.push(
        ...entry.ui.map((contribution) => ({
          ...contribution,
          pluginId: entry.pluginId
        }))
      )
      nextThemes.push(
        ...entry.themes.map((theme) => ({
          ...theme,
          pluginId: entry.pluginId
        }))
      )
    }
    uiContributions.value = nextUi
    themeContributions.value = nextThemes
  })()

  try {
    await syncInFlight.value
  } finally {
    syncInFlight.value = null
  }
}
