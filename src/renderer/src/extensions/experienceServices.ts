import { useRadioStore } from '../stores/useRadioStore'
import { usePodcastStore } from '../stores/usePodcastStore'
import {
  getRecentTracks,
  getTopTracks,
  getTopArtists,
  useListeningStatsStore,
  waitForListeningStatsReady
} from '../stores/useListeningStatsStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import type { Track } from '../types/music'
import type { NetworkEntry, NetworkSourceProfileInput } from '../../../shared/networkSources.ts'
import { assertExperienceMethod } from '../../../shared/pluginExperience.ts'

const text = (value: unknown, max = 4096) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('无效的文本参数')
  return value
}

/** Explicit adapters to the existing services. Stream paths and credentials stay in the host. */
export function createExperienceServices(permissions: string[]) {
  const radio = useRadioStore(),
    podcasts = usePodcastStore(),
    player = usePlayerStore()
  const entries = new Map<string, NetworkEntry>()
  const networkEntry = (value: unknown) => {
    const entry = entries.get(text(value))
    if (!entry) throw new Error('条目已失效，请刷新目录')
    return entry
  }
  return async function invoke(method: string, args: Record<string, unknown>): Promise<unknown> {
    assertExperienceMethod(method, permissions)
    switch (method) {
      case 'themes.list': {
        const { WORKSHOP_TEMPLATES, THEME_WORKSHOP_ID } =
          await import('../../../shared/themeWorkshop.ts')
        const plugin = (await window.api.plugins.list()).find((p) => p.id === THEME_WORKSHOP_ID)
        if (!plugin?.enabled) return { enabled: false, projects: [], templates: WORKSHOP_TEMPLATES }
        return {
          enabled: true,
          projects: await window.api.themeWorkshop.list(),
          templates: WORKSHOP_TEMPLATES
        }
      }
      case 'themes.create':
        await window.api.themeWorkshop.create(text(args.template, 100))
        return null
      case 'themes.import':
        return { imported: !!(await window.api.themeWorkshop.importProject()) }
      case 'themes.read': {
        const { workshopEditor } = await import('../../../shared/themeWorkshop.ts')
        const p = await window.api.themeWorkshop.get(text(args.id))
        return {
          id: p.id,
          revision: p.revision,
          name: p.name,
          controls: (workshopEditor(p)?.controls || []).filter((c) => c.type !== 'image'),
          values: p.values
        }
      }
      case 'themes.edit': {
        const { workshopEditor } = await import('../../../shared/themeWorkshop.ts')
        const p = await window.api.themeWorkshop.get(text(args.id))
        if (p.revision !== args.revision) throw new Error('主题已在其他页面更改，请重新打开后编辑')
        if (args.tone !== 'dark' && args.tone !== 'pureWhite') throw new Error('无效的主题模式')
        const control = workshopEditor(p)?.controls.find((c) => c.id === args.control)
        if (!control || control.type === 'image') throw new Error('该控件不能在这里修改')
        const value = text(args.value, 2048)
        if (control.type === 'number') {
          const numeric = Number(value.replace(control.unit || '', ''))
          if (
            !Number.isFinite(numeric) ||
            numeric < (control.min ?? -Infinity) ||
            numeric > (control.max ?? Infinity)
          )
            throw new Error('数值超出范围')
        }
        if (control.type === 'select' && !control.options?.includes(value))
          throw new Error('无效的选项')
        p.values[args.tone][control.id] = value
        const saved = await window.api.themeWorkshop.save(p)
        return { revision: saved.revision }
      }
      case 'themes.export':
        if (args.format !== 'tep' && args.format !== 'project') throw new Error('无效的导出格式')
        return {
          saved: !!(await window.api.themeWorkshop.exportProject(
            text(args.id),
            args.format,
            Number(args.revision)
          ))
        }
      case 'themes.apply':
        assertExperienceMethod('themes.read', permissions)
        await window.api.themeWorkshop.apply(text(args.id), Number(args.revision))
        return null
      case 'radio.list':
        await radio.ensureLoaded()
        if (radio.error.value) throw new Error(radio.error.value)
        return radio.stations.value.map(({ id, name, tags }) => ({ id, name, tags }))
      case 'radio.add':
        await radio.addStation({
          name: text(args.name, 120),
          streamUrl: text(args.url),
          allowInsecureHttp: args.allowInsecureHttp === true
        })
        return null
      case 'radio.remove':
        await radio.removeStation(text(args.id))
        return null
      case 'radio.import':
        return radio.importPlaylistText(text(args.content, 200000), {
          allowInsecureHttp: args.allowInsecureHttp === true
        })
      case 'radio.search':
        return radio.searchDirectory(text(args.query, 200), { limit: 50 })
      case 'radio.play': {
        assertExperienceMethod('player.play', permissions)
        await radio.ensureLoaded()
        const station = radio.stations.value.find((s) => s.id === args.id)
        if (!station) throw new Error('电台已移除')
        const track = radio.radioStationToTrack(station)
        await player.playTrack(track, [track])
        return null
      }
      case 'podcasts.list':
        await podcasts.ensureLoaded()
        if (podcasts.error.value) throw new Error(podcasts.error.value)
        return podcasts.subscriptions.value.map((s) => ({
          id: s.id,
          title: s.title,
          author: s.author,
          count: s.episodes.length
        }))
      case 'podcasts.episodes': {
        await podcasts.ensureLoaded()
        const subscription = podcasts.subscriptions.value.find((s) => s.id === args.id)
        if (!subscription) throw new Error('订阅已移除')
        return subscription.episodes.map((e) => ({
          guid: e.guid,
          title: e.title,
          duration: e.durationSeconds,
          progress: e.progressSeconds
        }))
      }
      case 'podcasts.subscribe':
        {
          let url: URL
          try {
            url = new URL(text(args.url))
          } catch {
            throw new Error('请输入有效的 RSS 地址')
          }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
            throw new Error('RSS 地址必须使用 HTTP 或 HTTPS，且不能包含账号密码')
          assertExperienceMethod('podcasts.list', permissions)
          await podcasts.subscribe(url.href)
        }
        return null
      case 'podcasts.remove':
        await podcasts.unsubscribe(text(args.id))
        return null
      case 'podcasts.refresh':
        await podcasts.refresh(text(args.id))
        return null
      case 'podcasts.play': {
        assertExperienceMethod('player.play', permissions)
        await podcasts.ensureLoaded()
        const s = podcasts.subscriptions.value.find((s) => s.id === args.id)
        const e = s?.episodes.find((e) => e.guid === args.guid)
        if (!s || !e) throw new Error('节目已失效，请刷新订阅')
        const track = podcasts.podcastEpisodeToTrack(s, e)
        await player.playTrack(track, [track])
        if (e.progressSeconds && e.progressSeconds < (e.durationSeconds || Infinity))
          player.seek(e.progressSeconds)
        return null
      }
      case 'network.profiles':
        return window.api.networkSources.listProfiles()
      case 'network.create': {
        const input = args.profile as NetworkSourceProfileInput
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('无效的连接配置')
        // The main-process profile manager validates input and encrypts credentials.
        return window.api.networkSources.createProfile(input)
      }
      case 'network.remove':
        await window.api.networkSources.deleteProfile(text(args.id))
        return null
      case 'network.test':
        return window.api.networkSources.testConnection(text(args.id))
      case 'network.browse':
      case 'network.library': {
        const items =
          method === 'network.browse'
            ? await window.api.networkSources.listDirectory(text(args.id), text(args.path ?? '/'))
            : await window.api.networkSources.listLibrary(
                text(args.id),
                text(args.query ?? '', 200)
              )
        return items.map((entry) => {
          entries.set(entry.id, entry)
          if (entries.size > 10000) entries.delete(entries.keys().next().value!)
          return {
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            path: entry.path,
            metadata: entry.metadata
          }
        })
      }
      case 'network.scan':
        return window.api.networkSources.scanDirectory(text(args.id), text(args.path ?? '/'))
      case 'network.play': {
        assertExperienceMethod('player.play', permissions)
        const entry = networkEntry(args.id)
        if (entry.kind !== 'audio') throw new Error('该条目不是音频')
        const plan = await window.api.networkSources.resolvePlayback(entry.profileId, entry)
        const track: Track = {
          id: entry.id,
          title: entry.metadata?.title || entry.name,
          artist: entry.metadata?.artist || '网络音乐',
          album: entry.metadata?.album || '',
          fileName: entry.name,
          filePath: plan.kind === 'direct-url' ? plan.url || '' : plan.cacheFilePath || '',
          duration: entry.metadata?.duration || 0,
          size: entry.sizeBytes || 0,
          cover: null,
          lyrics: null,
          source: 'network',
          networkSource: { profileId: entry.profileId, entry },
          format: entry.metadata?.format
        }
        await player.playTrack(track, [track])
        return null
      }
      case 'stats.read': {
        await waitForListeningStatsReady()
        const { listeningStats } = useListeningStatsStore()
        const clean = (s: ReturnType<typeof getTopTracks>[number]) => ({
          title: s.title,
          artist: s.artist,
          seconds: s.seconds,
          plays: s.plays,
          lastPlayed: s.lastPlayed
        })
        return {
          days: listeningStats.value.days,
          recent: getRecentTracks(50).map(clean),
          top: getTopTracks(50).map(clean),
          artists: getTopArtists(30).map((a) => ({
            name: a.name,
            seconds: a.seconds,
            plays: a.plays
          }))
        }
      }
      case 'diagnostics.status': {
        const s = await window.api.diagnostics.getStatus()
        return {
          bytes: s.bytes,
          files: s.files,
          droppedEvents: s.droppedEvents,
          lastWriteAt: s.lastWriteAt,
          error: s.error
        }
      }
      case 'diagnostics.mark':
        return window.api.diagnostics.markProblem(text(args.note ?? '', 1000))
      case 'diagnostics.export':
        return { saved: !!(await window.api.diagnostics.exportBundle()).filePath }
      case 'plugins.catalog':
        return (await window.api.plugins.refreshIndex()).map((p) => ({
          id: p.id,
          name: p.name,
          version: p.version,
          description: p.description
        }))
      case 'plugins.update':
        await window.api.plugins.installFromIndex(text(args.id))
        return null
    }
    throw new Error('Unsupported service operation')
  }
}
