import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Keep a 4K landscape wallpaper sharp while bounding portrait/panoramic images too.
export const BACKGROUND_DISPLAY_MAX_EDGE = 3840
export const BACKGROUND_DISPLAY_MAX_PIXELS = 3840 * 2160

export function backgroundDisplaySize(width: number, height: number) {
  const scale = Math.min(
    1,
    BACKGROUND_DISPLAY_MAX_EDGE / Math.max(width, height),
    Math.sqrt(BACKGROUND_DISPLAY_MAX_PIXELS / (width * height))
  )
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  }
}

type DisplayImage = {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(size: { width: number; height: number; quality: 'best' }): DisplayImage
  toPNG(): Buffer
}

/** Originals remain untouched for export. Only paths, never decoded images, are retained. */
export function createBackgroundDisplayCache(decode: (bytes: Buffer) => DisplayImage) {
  const pending = new Map<string, Promise<string>>()
  const resolved = new Map<string, string>()
  // A page switch can request several large wallpapers at once. Decode them serially.
  let conversion: Promise<unknown> = Promise.resolve()

  async function prepare(source: string): Promise<string> {
    const info = await stat(source)
    const directory = join(dirname(source), 'display-v1')
    const target = join(
      directory,
      `${basename(source)}-${info.size}-${Math.floor(info.mtimeMs)}.png`
    )
    try {
      await stat(target)
      return target
    } catch {
      // Generate once, then reuse the encoded derivative across app launches.
    }
    const image = decode(await readFile(source))
    if (image.isEmpty()) return source
    const size = image.getSize()
    const displaySize = backgroundDisplaySize(size.width, size.height)
    if (size.width === displaySize.width && size.height === displaySize.height) return source
    const bytes = image.resize({ ...displaySize, quality: 'best' }).toPNG()
    await mkdir(directory, { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return target
  }

  return async (source: string): Promise<string> => {
    const cached = resolved.get(source)
    if (cached) {
      try {
        // A disk-cache cleanup may remove derivatives while the app is running.
        if (cached !== source) await stat(cached)
        resolved.delete(source)
        resolved.set(source, cached)
        return cached
      } catch {
        resolved.delete(source)
      }
    }
    const existing = pending.get(source)
    if (existing) return existing
    const result = conversion
      .then(() => prepare(source))
      .then((path) => {
        resolved.set(source, path)
        if (resolved.size > 32) resolved.delete(resolved.keys().next().value!)
        return path
      })
      .catch(() => source)
      .finally(() => pending.delete(source))
    pending.set(source, result)
    conversion = result.then(() => undefined)
    return result
  }
}
