import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ENTRY_ID_PATTERN = /^[0-9a-f]{64}$/

/** 封面缓存支持的扩展名 → MIME；保存与回读共用同一份映射，避免写出读不回来。 */
const COVER_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

const COVER_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/png': 'png',
  'image/x-png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
  'image/x-tiff': 'tiff'
}

/**
 * 把元数据里的封面 MIME 归一化为受支持的扩展名。未知格式回退 jpg，
 * 保证写出的文件一定能被 readCoverDataUrl 读回。
 */
export function coverExtension(mime: string | undefined): string {
  const normalized = mime?.trim().toLowerCase()
  if (normalized && COVER_EXTENSION_BY_MIME[normalized]) return COVER_EXTENSION_BY_MIME[normalized]
  return 'jpg'
}

/**
 * 读取 cover-cache 中按条目 id 命名的封面并返回 data URL。
 * entryId 必须是 64 位十六进制（条目稳定 id），防止路径穿越。
 */
export async function readCoverDataUrl(
  entryId: string,
  coverCacheRoot: string
): Promise<string | null> {
  if (!ENTRY_ID_PATTERN.test(entryId)) return null
  for (const [extension, mime] of Object.entries(COVER_MIME_BY_EXTENSION)) {
    try {
      const data = await readFile(join(coverCacheRoot, `${entryId}.${extension}`))
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      // 尝试下一个扩展名
    }
  }
  return null
}
