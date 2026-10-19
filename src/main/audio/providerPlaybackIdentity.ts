import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type { AudioEngineQueueItem } from '../../shared/audioEngineTypes.ts'

export interface ProviderPlaybackIdentity {
  pluginId?: string
  providerId: string
  trackId: string
  source: string
  originSource: string
  requestedQuality: string
  actualQuality: string | null
  format: string | null
  sampleRate: number | null
  bitrate: number | null
  bytes: number | null
  expiresAt: number | null
}
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= 8192 ? v : null
const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Internal provenance only. A resolution revision is never a content digest;
 * native analysis/transport must still hash and lease the actual local bytes. */
export class ProviderPlaybackIdentityRegistry extends EventEmitter {
  private sequence = 0
  private readonly tracks = new Map<
    string,
    { identity: ProviderPlaybackIdentity; revision: number; digest: string }
  >()
  private readonly sources = new Map<string, { key: string; revision: number; pluginId?: string }>()
  record(
    providerId: string,
    trackId: string,
    requestedQuality: string,
    result: unknown,
    pluginId?: string
  ): void {
    const envelope = object(result)
    const source = text(envelope.streamUrl ?? result)
    if (!source || !trackId) return
    const meta = object(envelope.providerSource)
    const identity: ProviderPlaybackIdentity = {
      ...(pluginId ? { pluginId } : {}),
      providerId,
      trackId,
      source,
      originSource: text(meta.originSource) ?? source,
      requestedQuality,
      actualQuality: text(meta.actualQuality),
      format: text(meta.format),
      sampleRate: positive(meta.sampleRate),
      bitrate: positive(meta.bitrate),
      bytes: positive(meta.bytes),
      expiresAt: positive(meta.expiresAt)
    }
    const key = JSON.stringify([providerId, trackId])
    const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
    const old = this.tracks.get(key)
    if (old?.digest === digest) return
    const revision = ++this.sequence
    this.tracks.delete(key)
    this.tracks.set(key, { identity, revision, digest })
    this.sources.set(source, { key, revision, ...(pluginId ? { pluginId } : {}) })
    // Preserve revoked aliases until bounded eviction; these must not become
    // eligible simply because the queue still contains an older cached path.
    while (this.tracks.size > 1024) this.tracks.delete(this.tracks.keys().next().value!)
    const retiredSources: string[] = []
    while (this.sources.size > 4096) {
      const retired = this.sources.keys().next().value!
      retiredSources.push(retired)
      this.sources.delete(retired)
    }
    // An existing native queue may still hold the execution specification of
    // an evicted alias. Retire it through the same queue lifecycle before the
    // registry can forget which plugin could later revoke that source.
    if (retiredSources.length) this.emit('revoked', retiredSources)
    this.emit('changed', [
      ...new Set([old?.identity.source, source].filter((s): s is string => !!s))
    ])
  }
  revokePlugin(pluginId: string): void {
    // A newer quality resolution may already have replaced tracks[key] while
    // an older authorized alias is still playing. Revoke every owned alias.
    const sources = [...this.sources]
      .filter(([, alias]) => alias.pluginId === pluginId)
      .map(([source]) => source)
    for (const [key, record] of this.tracks) {
      if (record.identity.pluginId !== pluginId) continue
      this.tracks.delete(key)
    }
    if (sources.length) {
      this.emit('changed', sources)
      this.emit('revoked', sources)
    }
  }
  revision(source: string): string {
    const alias = this.sources.get(source)
    if (!alias) return ''
    const record = this.tracks.get(alias.key)
    return `${alias.revision}:${record?.revision ?? 'evicted'}:${record?.digest ?? ''}`
  }
  assertCurrent(source: string): void {
    const alias = this.sources.get(source)
    if (!alias) return
    const record = this.tracks.get(alias.key)
    if (!record || record.revision !== alias.revision)
      throw new Error('provider_source_resolution_changed')
    if (
      /^https?:/i.test(source) &&
      record.identity.expiresAt !== null &&
      record.identity.expiresAt <= Date.now()
    )
      throw new Error('provider_source_expired')
  }
  get(source: string): ProviderPlaybackIdentity | null {
    this.assertCurrent(source)
    const alias = this.sources.get(source)
    const record = alias && this.tracks.get(alias.key)
    return record ? structuredClone(record.identity) : null
  }
}
export const providerPlaybackIdentities = new ProviderPlaybackIdentityRegistry()

/** Bind a metadata snapshot after authorization. A later provider resolution may
 * revoke registry aliases while this already committed stream is still playing. */
export function bindPlaybackSourceMetadata(
  item: AudioEngineQueueItem,
  authorizedSource: string,
  identities: ProviderPlaybackIdentityRegistry = providerPlaybackIdentities
): AudioEngineQueueItem {
  let bytes: number | null = null
  try {
    bytes = identities.get(authorizedSource)?.bytes ?? null
  } catch {
    // Revoked/unknown provider metadata conveys no size authority to a new queue.
  }
  return {
    ...item,
    source: authorizedSource,
    rendererSource: item.source,
    sourceBytes: bytes !== null && Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined
  }
}
