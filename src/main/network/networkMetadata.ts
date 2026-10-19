import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadEntryToCache } from './networkCache.ts'
import { coverExtension } from './networkCover.ts'
import type { NetworkSourceSession } from './adapters/types.ts'
import type { NetworkEntry, NetworkEntryMetadata } from '../../shared/networkSources.ts'

interface ParsedEntry {
  metadata: NetworkEntryMetadata
  cover: Buffer | undefined
  coverFormat: string | undefined
}

async function parseCachedEntry(cacheFilePath: string): Promise<ParsedEntry | null> {
  try {
    const { parseFile } = await import('music-metadata')
    const parsed = await parseFile(cacheFilePath, { duration: false })
    const common = parsed.common
    const format = parsed.format
    const picture = common.picture?.[0]
    const metadata: NetworkEntryMetadata = {
      title: common.title || undefined,
      artist: common.artist || undefined,
      album: common.album || undefined,
      duration: format.duration ? Math.round(format.duration * 1000) / 1000 : undefined,
      format: format.container || format.codec || undefined,
      sampleRate: format.sampleRate,
      bitrate: format.bitrate,
      bitDepth: format.bitsPerSample
    }
    if (Object.values(metadata).every((value) => value === undefined)) return null
    return {
      metadata,
      cover: picture?.data ? Buffer.from(picture.data) : undefined,
      coverFormat: picture?.format
    }
  } catch {
    return null
  }
}

export async function saveEntryCover(
  entryId: string,
  cover: Buffer | undefined,
  coverMime: string | undefined,
  coverCacheRoot: string
): Promise<string | undefined> {
  if (!cover?.length) return undefined
  // 与下载缓存一致的标识约束：入口 id 必须是无路径分隔符的短令牌，
  // 防止污染/穿越 cover-cache 目录。
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(entryId)) return undefined
  const target = join(coverCacheRoot, `${entryId}.${coverExtension(coverMime)}`)
  await mkdir(coverCacheRoot, { recursive: true })
  await writeFile(target, cover)
  return target
}

/** 下载条目到缓存并解析标签/封面，返回带 metadata 的条目（解析失败返回原条目）。 */
export async function enrichNetworkEntry(deps: {
  session: NetworkSourceSession
  entry: NetworkEntry
  cacheRoot: string
  coverCacheRoot: string
}): Promise<NetworkEntry> {
  const { session, entry, cacheRoot, coverCacheRoot } = deps
  try {
    const cacheFilePath = await downloadEntryToCache({ session, entry, cacheRoot })
    const parsed = await parseCachedEntry(cacheFilePath)
    if (!parsed) return { ...entry, metadata: undefined }
    const coverPath = await saveEntryCover(
      entry.id,
      parsed.cover,
      parsed.coverFormat,
      coverCacheRoot
    )
    return { ...entry, metadata: parsed.metadata, coverPath }
  } catch {
    return { ...entry, metadata: undefined }
  }
}
