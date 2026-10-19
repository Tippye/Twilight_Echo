/**
 * Track-bound cover display for the playbar / now-playing / dashboard hero.
 *
 * Always materializes local covers to a *fresh* blob: URL per track identity so
 * Chromium cannot keep painting the previous track's decoded bitmap (custom
 * protocol + data: reuse both failed after cold start). Revokes the previous
 * object URL on change / dispose.
 */

import { onScopeDispose, ref, watch, type Ref, type ComputedRef } from 'vue'
import { resolveCover } from './coverLoader.ts'
import { recordCoverDiagnostic } from './coverDiagnostics.ts'
import { imageDataUrlToBlob } from './imageDataUrl.ts'

export function useTrackCoverSrc(
  trackRef: ComputedRef<{
    id?: string | null
    cover?: string | null
    coverSource?: string | null
  } | null>
): {
  src: Ref<string | null>
  key: Ref<string>
} {
  const src = ref<string | null>(null)
  const key = ref('none')
  let requestId = 0
  let objectUrl: string | null = null

  function revoke(): void {
    if (!objectUrl) return
    try {
      URL.revokeObjectURL(objectUrl)
    } catch {
      // ignore
    }
    objectUrl = null
  }

  async function toUniqueDisplayUrl(resolved: string): Promise<string | null> {
    if (/^data:/i.test(resolved)) {
      try {
        return URL.createObjectURL(imageDataUrlToBlob(resolved))
      } catch {
        return resolved
      }
    }
    // data: / already-fetched local art → mint a unique blob URL every time
    // so <img> cannot reuse a sticky decode for the previous track.
    if (/^(data:|blob:|cover:|background:)/i.test(resolved)) {
      try {
        const response = await fetch(resolved)
        if (!response.ok) return resolved.startsWith('data:') ? resolved : null
        const blob = await response.blob()
        if (!blob || blob.size <= 0) return null
        return URL.createObjectURL(blob)
      } catch {
        return resolved.startsWith('data:') ? resolved : null
      }
    }
    // twilight-media / other grants: unique enough per token; still wrap when possible.
    try {
      const response = await fetch(resolved)
      if (!response.ok) {
        recordCoverDiagnostic(
          'display.fetch.failed',
          resolved,
          null,
          { status: response.status },
          'warn'
        )
        return resolved
      }
      const blob = await response.blob()
      if (!blob || blob.size <= 0) {
        recordCoverDiagnostic('display.body.empty', resolved, null, {}, 'warn')
        return resolved
      }
      const display = URL.createObjectURL(blob)
      recordCoverDiagnostic('display.materialized', resolved, null, {
        displayUrl: display,
        bytes: blob.size
      })
      return display
    } catch {
      recordCoverDiagnostic('display.fetch.failed', resolved, null, {}, 'warn')
      return resolved
    }
  }

  watch(
    () =>
      [
        trackRef.value?.id ?? '',
        trackRef.value?.cover ?? '',
        trackRef.value?.coverSource ?? ''
      ] as const,
    ([id, cover, coverSource]) => {
      const rid = ++requestId
      key.value = `${id || 'none'}:${cover}:${coverSource}:${rid}`
      // Blank immediately so the previous track cannot remain painted.
      revoke()
      src.value = null

      if (!cover && !coverSource) return

      void (async () => {
        const resolved = await resolveCover(cover || null, coverSource || null)
        if (rid !== requestId) return
        if (!resolved) {
          src.value = null
          return
        }
        const unique = await toUniqueDisplayUrl(resolved)
        if (rid !== requestId) {
          if (unique && unique.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(unique)
            } catch {
              // ignore
            }
          }
          return
        }
        if (unique && unique.startsWith('blob:')) {
          objectUrl = unique
        }
        src.value = unique
      })()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    requestId += 1
    revoke()
  })

  return { src, key }
}
