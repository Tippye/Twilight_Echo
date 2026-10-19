/**
 * Plugin → host request to materialise playlists into the user's local
 * playlists (the ones stored in `playlists.json`).
 *
 * The plugin host runs in a utilityProcess and cannot touch the renderer's
 * playlist store, so the request is forwarded to the main window, which applies
 * it through the normal store actions and therefore through the normal
 * revision-guarded persistence.
 *
 * The call is deliberately **fire-and-forget and batched**: plugins import tens
 * of playlists at once, so they arrive in a single payload and the renderer
 * reports one combined toast rather than one per playlist. A plugin never has
 * to wait on the UI thread.
 */

export const PLUGIN_IMPORT_PLAYLIST_CHANNEL = 'plugins:importPlaylist'
export const PLUGIN_TAKE_PLAYLIST_IMPORTS_CHANNEL = 'plugins:takePlaylistImports'

/** Matches the renderer's own per-playlist import ceiling. */
export const MAX_PLUGIN_PLAYLIST_ENTRIES = 20_000
export const MAX_PLUGIN_PLAYLIST_NAME_LENGTH = 80
/** Ceiling for one batched request; a scan caps out well below this. */
export const MAX_PLUGIN_PLAYLISTS_PER_REQUEST = 1_000
export const MAX_PLUGIN_PATHS_PER_REQUEST = 200_000

export interface PluginPlaylistImportEntry {
  /** Playlist to create, or to append to when one with this name exists. */
  name: string
  /** Absolute audio file paths, in playlist order. */
  paths: string[]
}

export interface PluginPlaylistImportRequest {
  playlists: PluginPlaylistImportEntry[]
}

export interface PluginPlaylistImportNotice extends PluginPlaylistImportRequest {
  pluginId: string
}

export class PluginPlaylistImportError extends Error {}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!name) throw new PluginPlaylistImportError('歌单名称不能为空')
  if (name.length > MAX_PLUGIN_PLAYLIST_NAME_LENGTH) {
    throw new PluginPlaylistImportError('歌单名称不能超过 80 个字符')
  }
  return name
}

function normalizePaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new PluginPlaylistImportError('paths 必须是数组')
  const paths: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const path = entry.trim()
    // Local playlists only ever hold filesystem paths; a URL here would create
    // an entry that can never resolve to a library track.
    if (!path || path.includes('\0')) continue
    paths.push(path)
  }
  return paths
}

/** Validates an untrusted payload coming from a plugin over the RPC bridge. */
export function normalizePluginPlaylistImportRequest(value: unknown): PluginPlaylistImportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginPlaylistImportError('导入请求必须是对象')
  }
  const raw = (value as Record<string, unknown>).playlists
  if (!Array.isArray(raw)) throw new PluginPlaylistImportError('playlists 必须是数组')
  if (raw.length === 0) throw new PluginPlaylistImportError('playlists 不能为空')
  if (raw.length > MAX_PLUGIN_PLAYLISTS_PER_REQUEST) {
    throw new PluginPlaylistImportError(`一次最多导入 ${MAX_PLUGIN_PLAYLISTS_PER_REQUEST} 个歌单`)
  }

  const playlists: PluginPlaylistImportEntry[] = []
  let total = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const paths = normalizePaths(record.paths)
    // An empty playlist is skipped rather than rejected: a scan legitimately
    // produces them when every referenced file is missing.
    if (paths.length === 0) continue
    if (paths.length > MAX_PLUGIN_PLAYLIST_ENTRIES) {
      throw new PluginPlaylistImportError(
        `单个歌单超过 ${MAX_PLUGIN_PLAYLIST_ENTRIES.toLocaleString()} 条上限`
      )
    }
    total += paths.length
    if (total > MAX_PLUGIN_PATHS_PER_REQUEST) {
      throw new PluginPlaylistImportError(
        `一次最多导入 ${MAX_PLUGIN_PATHS_PER_REQUEST.toLocaleString()} 条曲目`
      )
    }
    playlists.push({ name: normalizeName(record.name), paths })
  }

  if (playlists.length === 0) throw new PluginPlaylistImportError('playlists 里没有可导入的曲目')
  return { playlists }
}
