import { randomUUID } from 'node:crypto'
import { runtime } from '../core/runtime'
import { experienceDocument } from './experienceDocuments.ts'
import type { MusicAlbum } from '../../shared/rhineMusic.ts'
import {
  createIntroductionTask,
  previewIntroductionImport,
  introductionEditionRevision,
  introductionRevision,
  reconcileIntroductionResult
} from './rhine-vendor/album-introduction-exchange.mjs'
import { AlbumIntroductionProvider } from './rhine-vendor/album-introductions.mjs'
import { QQCreditsProvider } from './rhine-vendor/qq-credits.mjs'
import { MusicBrainzProvider } from './rhine-vendor/musicbrainz.mjs'
import {
  introductionPatch,
  creditsPatch,
  selectMetadataAlbums
} from '../../shared/rhineMetadata.ts'

interface MusicMetadata {
  albums?: Record<string, Partial<MusicAlbum>>
  proofs?: Record<string, string>
  config?: { musicBrainzContact?: string; onlineEnabled?: boolean }
  [key: string]: unknown
}
const jobs = new Map<
  string,
  {
    running: boolean
    completed: number
    total: number
    updated: number
    failed: number
    notFound: number
    currentAlbum?: string
    error?: string
  }
>()

/** Called only by the trusted parent renderer; album identities come from its library. */
export async function experienceMusicOperation(
  pluginId: string,
  operation: string,
  rawAlbums: MusicAlbum[],
  args: Record<string, unknown>
) {
  const plugin = (await runtime.pluginManager?.list())?.find((p) => p.id === pluginId && p.enabled)
  if (!plugin?.permissions.includes('library:write'))
    throw new Error('Music metadata access denied')
  if (!Array.isArray(rawAlbums) || rawAlbums.length > 100000)
    throw new Error('Invalid music library')
  const document = await experienceDocument(pluginId)
  const metadata = document.value as MusicMetadata
  const albums = rawAlbums.map((album) => ({
    ...album,
    ...metadata.albums?.[album.id],
    id: album.id,
    title: album.title,
    artist: album.artist,
    tracks: album.tracks
  }))
  if (operation === 'status')
    return Object.fromEntries(
      ['introductions', 'credits', 'enrich'].map((key) => [key, jobs.get(`${pluginId}:${key}`)])
    )
  if (
    ['task', 'preview', 'import', 'reconcile'].includes(operation) &&
    ['introductions', 'credits', 'enrich'].some((key) => jobs.get(`${pluginId}:${key}`)?.running)
  )
    throw new Error('资料查询正在进行，请结束后重新导出或预览')
  if (operation === 'task') {
    const task = createIntroductionTask(albums, {
      scope: String(args.scope ?? 'missing'),
      albumId: typeof args.albumId === 'string' ? args.albumId : undefined
    })
    const proofs = { ...metadata.proofs }
    for (const album of albums)
      if (task.albums.some((entry) => entry.id === album.id))
        proofs[introductionRevision(album)] = introductionEditionRevision(album)
    await experienceDocument(pluginId, {
      revision: document.revision,
      value: { ...metadata, proofs }
    })
    return task
  }
  if (operation === 'reconcile')
    return reconcileIntroductionResult(
      albums,
      args.result,
      new Map(Object.entries(metadata.proofs ?? {}))
    )
  if (operation === 'preview' || operation === 'import') {
    const preview = previewIntroductionImport(albums, args.result, {
      allowReplace: args.allowReplace === true
    })
    if (operation === 'preview') return preview
    if (!preview.canApply) throw new Error('导入存在冲突或没有可写入的介绍，请重新预览')
    const updated = { ...metadata.albums },
      proofs = { ...metadata.proofs }
    const importedAt = new Date().toISOString(),
      batchId = randomUUID()
    for (const entry of preview.entries) {
      if (!['add', 'replace'].includes(entry.action)) continue
      const album = albums.find((a) => a.id === entry.id)!
      proofs[introductionRevision(album)] = introductionEditionRevision(album)
      updated[entry.id] = {
        ...updated[entry.id],
        description: entry.description,
        descriptionSource: {
          ...entry.sources[0],
          references: entry.sources,
          method: 'external-ai',
          importedAt,
          batchId
        },
        introduction: { status: 'matched', checkedAt: importedAt, method: 'external-ai' }
      }
    }
    await experienceDocument(pluginId, {
      revision: document.revision,
      value: { ...metadata, albums: updated, proofs }
    })
    return {
      ...preview,
      imported: preview.counts.add + preview.counts.replace,
      backup: `music-metadata.backup-${document.revision}.json`
    }
  }
  if (operation === 'introductions' || operation === 'credits' || operation === 'enrich') {
    if (!plugin.permissions.includes('network')) throw new Error('请授予插件网络权限后查询公开资料')
    const key = `${pluginId}:${operation}`
    if (jobs.get(key)?.running) return jobs.get(key)
    const selected = selectMetadataAlbums(albums, operation, args)
    if (operation === 'enrich' && !metadata.config?.musicBrainzContact)
      throw new Error('请先填写 MusicBrainz 联系邮箱或项目网址')
    const job = {
      running: true,
      completed: 0,
      total: selected.length,
      updated: 0,
      failed: 0,
      notFound: 0,
      currentAlbum: '',
      error: ''
    }
    jobs.set(key, job)
    const credits = new QQCreditsProvider({ dataDir: plugin.paths.dataDir })
    const introductions = new AlbumIntroductionProvider({
      contact: () => metadata.config?.musicBrainzContact ?? ''
    })
    const enrichment = new MusicBrainzProvider({
      contact: metadata.config?.musicBrainzContact ?? ''
    })
    void (async () => {
      try {
        let consecutiveFailures = 0
        for (const album of selected) {
          const active = (await runtime.pluginManager?.list())?.find(
            (p) => p.id === pluginId && p.enabled
          )
          if (!active?.permissions.includes('network')) break
          job.currentAlbum = album.title
          try {
            const result =
              operation === 'credits'
                ? await credits.lookup(album, { force: args.force === true })
                : operation === 'introductions'
                  ? await introductions.lookup(album)
                  : await enrichment.lookup(album)
            const latest = await experienceDocument(pluginId)
            const data = latest.value as MusicMetadata
            const current = { ...album, ...data.albums?.[album.id], tracks: album.tracks }
            const patch =
              operation === 'credits'
                ? creditsPatch(current, result as Awaited<ReturnType<QQCreditsProvider['lookup']>>)
                : operation === 'introductions'
                  ? introductionPatch(
                      current,
                      result as Awaited<ReturnType<AlbumIntroductionProvider['lookup']>>
                    )
                  : (result as Partial<MusicAlbum>)
            if (current.descriptionSource?.method === 'external-ai') {
              delete patch.description
              delete patch.descriptionSource
            }
            await experienceDocument(pluginId, {
              revision: latest.revision,
              value: {
                ...data,
                albums: { ...data.albums, [album.id]: { ...data.albums?.[album.id], ...patch } }
              }
            })
            const status = patch.creditsLookup ?? patch.introduction ?? patch.online
            if (status?.status === 'error') {
              job.failed++
              consecutiveFailures++
              job.error = status.error ?? '查询失败'
            } else {
              consecutiveFailures = 0
              if (status?.status === 'matched' || status?.status === 'partial') job.updated++
              else job.notFound++
            }
            if (
              patch.creditsLookup?.retryAt &&
              Date.parse(patch.creditsLookup.retryAt) > Date.now()
            )
              consecutiveFailures = 3
          } catch (error) {
            job.failed++
            consecutiveFailures++
            job.error = String(error)
          }
          job.completed++
          if (consecutiveFailures >= 3) {
            job.error += '；已暂停剩余查询，已有资料保留。'
            break
          }
        }
      } finally {
        job.running = false
        job.currentAlbum = ''
      }
    })().catch((error) => {
      job.running = false
      console.error('[Rhine metadata]', error)
    })
    return job
  }
  throw new Error('Unsupported music metadata operation')
}
