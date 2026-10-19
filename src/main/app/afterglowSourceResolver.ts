import { afterglowTrackPathOf, isAfterglowPlayableSource } from '../../shared/afterglowMode.ts'

export interface ResolvedAfterglowSource {
  source: string
  /** Absolute epoch ms when the provider URL expires; null when unknown. */
  expiresAt: number | null
}

export interface AfterglowSourceResolver {
  resolve(track: unknown): Promise<ResolvedAfterglowSource | null>
}

export interface AfterglowSourceResolverDependencies {
  callProvider?: (providerId: string, method: 'getPlaybackUrl', args: unknown[]) => Promise<unknown>
  quality?: string
  now?: () => number
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i
const PROVIDER_TIMEOUT_MS = 12_000
const UNKNOWN_PROVIDER_TTL_MS = 8 * 60 * 1000

const providerIdOf = (track: unknown): string => {
  if (!track || typeof track !== 'object') return ''
  const record = track as Record<string, unknown>
  if (typeof record.source === 'string' && record.source.trim()) {
    return record.source.trim()
  }
  if (typeof record.id === 'string') {
    const separator = record.id.indexOf(':')
    if (separator > 0) return record.id.slice(0, separator)
  }
  return ''
}

const normalizeProviderResult = (
  result: unknown,
  now: number
): { source: string; expiresAt: number | null } | null => {
  if (typeof result === 'string') {
    return { source: result.trim(), expiresAt: null }
  }
  if (!result || typeof result !== 'object') return null
  const record = result as Record<string, unknown>
  const streamUrl = typeof record.streamUrl === 'string' ? record.streamUrl.trim() : ''
  if (!streamUrl) return null
  const providerSource =
    record.providerSource && typeof record.providerSource === 'object'
      ? (record.providerSource as Record<string, unknown>)
      : null
  const rawExpiry = providerSource?.expiresAt
  const expiresAt =
    typeof rawExpiry === 'number' && Number.isFinite(rawExpiry) && rawExpiry > now
      ? rawExpiry
      : null
  return { source: streamUrl, expiresAt }
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('provider resolve timeout')), timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

/**
 * Resolves a logical queue entry into a native-playable source while the renderer
 * is unloaded. Local files are used as-is; provider tracks go through the same
 * trusted `getPlaybackUrl` route the renderer uses.
 */
export const createAfterglowSourceResolver = (
  dependencies: AfterglowSourceResolverDependencies = {}
): AfterglowSourceResolver => {
  const now = dependencies.now ?? Date.now
  const injectedCallProvider = dependencies.callProvider
  return {
    async resolve(track: unknown): Promise<ResolvedAfterglowSource | null> {
      if (!track || typeof track !== 'object') return null
      const localPath = afterglowTrackPathOf(track)
      if (isAfterglowPlayableSource(localPath)) {
        return { source: localPath, expiresAt: null }
      }

      const providerId = providerIdOf(track)
      if (!providerId || !PROVIDER_ID_PATTERN.test(providerId)) return null

      const options: Record<string, unknown> = {}
      if (providerId === 'ncm') {
        let quality = dependencies.quality
        if (!quality) {
          const { runtime } = await import('../core/runtime.ts')
          quality = runtime.appSettings.ncmPlaybackQuality ?? 'auto'
        }
        options.quality = quality
      }

      const callProvider =
        injectedCallProvider ??
        (async (targetProviderId: string, method: 'getPlaybackUrl', args: unknown[]) => {
          const { runtime } = await import('../core/runtime.ts')
          if (!runtime.pluginManager) throw new Error('provider manager unavailable')
          return runtime.pluginManager.callProvider(targetProviderId, method, args)
        })

      try {
        const result = await withTimeout(
          callProvider(providerId, 'getPlaybackUrl', [track, options]),
          PROVIDER_TIMEOUT_MS
        )
        const normalized = normalizeProviderResult(result, now())
        if (!normalized || !isAfterglowPlayableSource(normalized.source)) return null
        return {
          source: normalized.source,
          expiresAt: normalized.expiresAt ?? now() + UNKNOWN_PROVIDER_TTL_MS
        }
      } catch (error) {
        console.warn(
          `[afterglow] provider ${providerId} could not resolve a playback source:`,
          error instanceof Error ? error.message : String(error)
        )
        return null
      }
    }
  }
}
