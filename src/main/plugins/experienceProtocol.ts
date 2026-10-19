import { net, protocol } from 'electron'
import { extname, resolve, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { runtime } from '../core/runtime'
import { resolvePluginFile } from './packageSecurity.ts'
import { normalizeExperiences, type InstalledExperience } from '../../shared/pluginExperience.ts'

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf'
}

export async function listExperiences(): Promise<InstalledExperience[]> {
  await runtime.pluginManagerReady
  const plugins = (await runtime.pluginManager?.list()) ?? []
  return plugins
    .filter((p) => p.enabled && p.status !== 'invalid')
    .flatMap((p) =>
      normalizeExperiences(p).map((item) => ({
        ...item,
        pluginId: p.id,
        version: p.version,
        url: `plugin-ui://${p.id}/${p.version}/${item.entry}`,
        permissions: [...p.permissions]
      }))
    )
}

export function installExperienceProtocol(): void {
  protocol.handle('plugin-ui', async (request) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const parts = url.pathname.split('/').slice(1).map(decodeURIComponent)
      const version = parts.shift()
      if (parts.some((p) => !p || p === '.' || p === '..' || /[\\:\0]/.test(p)))
        return new Response(null, { status: 403 })
      const plugin = (await runtime.pluginManager?.list())?.find(
        (p) => p.id === url.hostname && p.version === version && p.enabled
      )
      if (!plugin) return new Response(null, { status: 404 })
      const entries = normalizeExperiences(plugin)
      const file = resolvePluginFile(
        resolve(plugin.paths.versionRoot, ...parts),
        plugin.paths.versionRoot
      )
      if (
        !file ||
        !entries.some((e) => {
          const child = relative(resolve(plugin.paths.versionRoot, dirname(e.entry)), file)
          return child && !child.startsWith('..') && !child.includes(':')
        })
      )
        return new Response(null, { status: 403 })
      const type = mime[extname(file).toLowerCase()]
      if (!type) return new Response(null, { status: 403 })
      const response = await net.fetch(pathToFileURL(file).href, {
        bypassCustomProtocolHandlers: true
      })
      return new Response(request.method === 'HEAD' ? null : response.body, {
        headers: {
          'Content-Type': type,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: cover:; font-src 'self'; connect-src 'self'; media-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

const pendingWrites = new Map<string, Promise<void>>()
export async function experiencePreferences(pluginId: string, value?: unknown): Promise<unknown> {
  const plugin = (await runtime.pluginManager?.list())?.find((p) => p.id === pluginId && p.enabled)
  if (!plugin || !normalizeExperiences(plugin).length || !plugin.permissions.includes('settings'))
    throw new Error('Experience unavailable')
  const file = resolve(plugin.paths.dataDir, 'experience-preferences.json')
  if (value === undefined) {
    await pendingWrites.get(pluginId)
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return {}
    }
  }
  const text = JSON.stringify(value)
  if (!value || typeof value !== 'object' || Array.isArray(value) || text.length > 64 * 1024)
    throw new Error('Invalid preferences')
  const write = (pendingWrites.get(pluginId) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(plugin.paths.dataDir, { recursive: true })
      await writeFile(`${file}.tmp`, text, 'utf8')
      await rename(`${file}.tmp`, file)
    })
  pendingWrites.set(pluginId, write)
  try {
    await write
  } finally {
    if (pendingWrites.get(pluginId) === write) pendingWrites.delete(pluginId)
  }
  return value
}
