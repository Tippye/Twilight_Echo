<template>
  <slot v-if="!displayCover && $slots.placeholder" name="placeholder" />
  <img
    v-else-if="displayCover || fallback"
    :key="displayCover ? coverIdentityKey : `fb:${coverIdentityKey}`"
    :src="displayCover || fallback"
    :alt="alt"
    :class="$attrs.class"
    decoding="async"
    :loading="loading"
    @error="displayCover && onImageError($event)"
    @load="displayCover && onImageLoad()"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DEFAULT_TRACK_COVER from '../assets/images/default-track-cover.webp'
import { recordCoverDiagnostic } from '../utils/coverDiagnostics.ts'
import {
  clearLocalCoverDataCache,
  invalidateRemoteCoverGrant,
  resolveCover
} from '../utils/coverLoader.ts'

const props = withDefaults(
  defineProps<{
    cover: string | null | undefined
    /** Durable remote origin used to re-grant expired twilight-media handles. */
    coverSource?: string | null | undefined
    /** Stable identity (track id) — changes force full remount + re-resolve. */
    identity?: string | null | undefined
    alt?: string
    fallback?: string
    loading?: 'lazy' | 'eager'
  }>(),
  { fallback: DEFAULT_TRACK_COVER }
)

const emit = defineEmits<{ error: [event: Event] }>()

defineOptions({ inheritAttrs: false })

const displayCover = ref<string | null>(null)
const remountNonce = ref(0)
let requestId = 0
let retriedCover = false

const coverIdentityKey = computed(
  () =>
    `${props.identity ?? ''}:${props.cover ?? ''}:${props.coverSource ?? ''}:${remountNonce.value}`
)

async function reloadCover(): Promise<void> {
  const id = ++requestId
  retriedCover = false
  // Blank first so Chromium cannot keep the previous bitmap while we resolve.
  displayCover.value = null

  const cover = typeof props.cover === 'string' ? props.cover.trim() : ''
  const source = typeof props.coverSource === 'string' ? props.coverSource.trim() : ''
  if (!cover && !source) {
    recordCoverDiagnostic('source.missing', null, null)
    return
  }

  try {
    const next = await resolveCover(cover || null, source || null)
    if (id !== requestId) return
    displayCover.value = next
    if (!next) recordCoverDiagnostic('resolve.empty', cover, source, {}, 'warn')
  } catch {
    if (id !== requestId) return
    recordCoverDiagnostic('resolve.failed', cover, source, {}, 'warn')
    displayCover.value = null
  }
}

watch(
  () => [props.identity, props.cover, props.coverSource] as const,
  () => {
    remountNonce.value += 1
    void reloadCover()
  },
  { immediate: true }
)

async function onImageError(event: Event): Promise<void> {
  const id = requestId
  const source =
    (typeof props.coverSource === 'string' && props.coverSource.trim()) ||
    (typeof props.cover === 'string' && /^https?:\/\//i.test(props.cover.trim())
      ? props.cover.trim()
      : '')
  recordCoverDiagnostic(
    'image.failed',
    displayCover.value,
    source,
    { retried: retriedCover },
    'warn'
  )
  // Recover an expired handle once per identity; a broken image must not loop.
  if (!retriedCover) {
    retriedCover = true
    try {
      if (source) {
        invalidateRemoteCoverGrant(source)
        const next = await resolveCover(null, source)
        if (id !== requestId) return
        recordCoverDiagnostic('retry.resolved', next, source, {
          sameHandle: next === displayCover.value,
          available: Boolean(next)
        })
        if (next && next !== displayCover.value) {
          displayCover.value = next
          remountNonce.value += 1
          return
        }
      }
      // Local protocol art: drop materialize cache and retry once.
      if (typeof props.cover === 'string' && /^cover:/i.test(props.cover)) {
        clearLocalCoverDataCache()
        const next = await resolveCover(props.cover, null)
        if (id !== requestId) return
        if (next && next !== displayCover.value) {
          displayCover.value = next
          remountNonce.value += 1
          return
        }
      }
    } catch {
      // Failed grants/materialization use the same local fallback as missing art.
    }
  }
  if (id !== requestId) return
  recordCoverDiagnostic(
    'fallback.shown',
    displayCover.value,
    source,
    { retried: retriedCover },
    'warn'
  )
  displayCover.value = null
  emit('error', event)
}

function onImageLoad(): void {
  if (retriedCover) recordCoverDiagnostic('image.recovered', displayCover.value, props.coverSource)
}
</script>
