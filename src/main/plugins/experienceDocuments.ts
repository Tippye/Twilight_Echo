import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { runtime } from '../core/runtime'
import { normalizeExperiences } from '../../shared/pluginExperience.ts'

export interface ExperienceDocument {
  revision: number
  value: Record<string, unknown>
}
const writes = new Map<string, Promise<unknown>>()

/** Large, versioned music metadata is deliberately separate from UI preferences. */
export async function experienceDocument(
  pluginId: string,
  update?: ExperienceDocument
): Promise<ExperienceDocument> {
  const plugin = (await runtime.pluginManager?.list())?.find((p) => p.id === pluginId && p.enabled)
  if (
    !plugin ||
    !normalizeExperiences(plugin).length ||
    !plugin.permissions.includes('library:write')
  )
    throw new Error('Music metadata access denied')
  const file = join(plugin.paths.dataDir, 'music-metadata.json')
  const read = async (): Promise<ExperienceDocument> => {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, value: {} }
      throw error
    }
  }
  if (!update) {
    await writes.get(file)
    return read()
  }
  if (
    !Number.isSafeInteger(update.revision) ||
    update.revision < 0 ||
    !update.value ||
    typeof update.value !== 'object' ||
    Array.isArray(update.value)
  )
    throw new Error('Invalid metadata document')
  const input = JSON.stringify(update.value)
  if (Buffer.byteLength(input) > 16 * 1024 * 1024)
    throw new Error('Metadata document exceeds 16 MiB')
  const operation = (writes.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const previous = await read()
      if (previous.revision !== update.revision)
        throw new Error('资料已发生变化，请重新读取并预览后再保存')
      await mkdir(plugin.paths.dataDir, { recursive: true })
      if (previous.revision)
        await writeFile(
          join(plugin.paths.dataDir, `music-metadata.backup-${previous.revision}.json`),
          JSON.stringify(previous),
          { flag: 'wx' }
        ).catch((error) => {
          if (error.code !== 'EEXIST') throw error
        })
      const next = { revision: previous.revision + 1, value: JSON.parse(input) }
      await writeFile(`${file}.tmp`, JSON.stringify(next), 'utf8')
      await rename(`${file}.tmp`, file)
      return next
    })
  writes.set(file, operation)
  try {
    return await operation
  } finally {
    if (writes.get(file) === operation) writes.delete(file)
  }
}
