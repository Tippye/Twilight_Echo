<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Track } from '../../types/music'
import { syncPluginProviders, useMediaProviders } from '../../providers'
import type {
  MediaProvider,
  MediaProviderPlaybackQuality,
  MediaProviderTrackPlaybackQualities
} from '../../providers/mediaProvider.ts'
import { isPluginProviderEnabled } from '../../providers/mediaProvider.ts'
import { usePlayerStore } from '../../stores/usePlayerStore'
import { useAppNoticeStore } from '../../stores/useAppNoticeStore'
import { friendlyStreamingError } from '../streaming-page/friendlyStreamingError.ts'
import { parseAppError } from '../../../../shared/errors/appError.ts'

const props = defineProps<{ track: Track; disabled?: boolean }>()
const { changePlaybackQuality } = usePlayerStore()
const { pushNotice } = useAppNoticeStore()
const provider = shallowRef<MediaProvider | null>(null)
const state = ref<MediaProviderPlaybackQuality | null>(null)
const trackQualities = ref<MediaProviderTrackPlaybackQualities | null>(null)
const busy = ref(false)
const loadError = ref(false)
let revision = 0
let selectionRevision = 0
let pluginChangeRevision = 0
let providerGeneration = -1
let active = true
let unsubscribe: (() => void) | undefined
let refreshing: AbortController | undefined
let selecting: AbortController | undefined

const displayedOptions = computed(() =>
  (state.value?.options ?? []).map((option) => {
    if (!provider.value?.getTrackPlaybackQualities)
      return { ...option, unavailable: false, reason: undefined }
    const detail = trackQualities.value?.options.find((item) => item.value === option.value)
    const unavailable = !detail || detail.availability === 'unavailable'
    const reason = detail?.reason || (unavailable ? '该歌曲没有此音质记录' : '')
    return {
      ...option,
      unavailable,
      reason,
      label: unavailable
        ? `${option.label}（不可用${reason ? `：${reason}` : ''}）`
        : detail.availability === 'unknown'
          ? `${option.label}（待验证）`
          : option.label
    }
  })
)

async function refresh(): Promise<void> {
  const request = ++revision
  refreshing?.abort()
  const controller = new AbortController()
  refreshing = controller
  const track = { ...props.track }
  const providers = useMediaProviders()
  let capturedProvider: MediaProvider | null = null
  let generation = -1
  const sameTrack = (): boolean =>
    props.track.id === track.id &&
    props.track.source === track.source &&
    props.track.queueEntryId === track.queueEntryId
  const currentRequest = (): boolean =>
    active &&
    !controller.signal.aborted &&
    request === revision &&
    sameTrack() &&
    (!capturedProvider || providers.getGeneration(capturedProvider.id) === generation)
  try {
    await syncPluginProviders()
    if (!currentRequest()) return
    const current = providers.getForTrack(track)
    provider.value =
      current?.getPlaybackQuality &&
      current.setPlaybackQuality &&
      isPluginProviderEnabled(current.health)
        ? current
        : null
    if (!provider.value) {
      state.value = null
      trackQualities.value = null
      return
    }
    const selectedProvider = provider.value
    capturedProvider = selectedProvider
    generation = providers.getGeneration(selectedProvider.id)
    const next = await selectedProvider.getPlaybackQuality!({ signal: controller.signal })
    if (!currentRequest() || providers.getGeneration(selectedProvider.id) !== generation) return
    const qualities = selectedProvider.getTrackPlaybackQualities
      ? await selectedProvider.getTrackPlaybackQualities(track, { signal: controller.signal })
      : null
    if (currentRequest() && providers.getGeneration(selectedProvider.id) === generation) {
      state.value = next
      trackQualities.value = qualities
      providerGeneration = generation
      loadError.value = false
    }
  } catch {
    if (currentRequest()) {
      loadError.value = true
      // A failed catalogue refresh cannot leave an older song's choices selectable.
      if (provider.value?.getTrackPlaybackQualities) state.value = null
    }
  } finally {
    if (refreshing === controller) refreshing = undefined
  }
}

async function selectQuality(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  const previous = state.value
  const quality = select.value
  // Keep the last confirmed preference visible while the source persists it.
  select.value = previous?.quality ?? ''
  if (!previous || busy.value || quality === previous.quality) return
  const request = ++selectionRevision
  selecting?.abort()
  const controller = new AbortController()
  selecting = controller
  const track = { id: props.track.id, source: props.track.source, entry: props.track.queueEntryId }
  const selectedProvider = provider.value
  const providers = useMediaProviders()
  const generation = selectedProvider ? providers.getGeneration(selectedProvider.id) : -1
  const ownsSelection = (): boolean =>
    active &&
    !controller.signal.aborted &&
    request === selectionRevision &&
    props.track.id === track.id &&
    props.track.source === track.source &&
    props.track.queueEntryId === track.entry &&
    !!selectedProvider &&
    providers.getGeneration(selectedProvider.id) === generation
  busy.value = true
  try {
    const next = await changePlaybackQuality(quality, { signal: controller.signal })
    if (ownsSelection()) state.value = next
  } catch (error) {
    if (ownsSelection()) {
      const parsed = parseAppError(error)
      pushNotice({
        kind: 'error',
        // These errors come from the selected provider or the quality controller.
        // Preserve their stage-specific prose (including HTTP codes); the generic
        // platform classifier would otherwise turn a media 403 into a login error.
        message: parsed.code
          ? friendlyStreamingError(error, '音质切换失败，请重试')
          : parsed.message || '音质切换失败，请重试'
      })
    }
  } finally {
    if (ownsSelection()) {
      busy.value = false
      await refresh()
    }
    if (selecting === controller) selecting = undefined
  }
}

function invalidate(): void {
  selectionRevision += 1
  revision += 1
  refreshing?.abort()
  selecting?.abort()
  busy.value = false
  state.value = null
  trackQualities.value = null
  provider.value = null
  providerGeneration = -1
  loadError.value = false
  void refresh()
}

async function onPluginsChanged(): Promise<void> {
  const request = ++pluginChangeRevision
  const previous = provider.value
  const generation = providerGeneration
  const track = { id: props.track.id, source: props.track.source, entry: props.track.queueEntryId }
  const isCurrentChange = (): boolean =>
    active &&
    request === pluginChangeRevision &&
    props.track.id === track.id &&
    props.track.source === track.source &&
    props.track.queueEntryId === track.entry
  try {
    await syncPluginProviders()
  } catch {
    // An unrelated registry refresh failure cannot revoke a playback command.
    if (isCurrentChange() && !busy.value) loadError.value = true
    return
  }
  if (!isCurrentChange()) return
  const providers = useMediaProviders()
  const current = providers.getForTrack(props.track)
  // plugins:changed is an application-wide bus. Only the current provider's
  // ownership change may cancel its selection; other plugin events are refreshes.
  const sameOwner =
    previous &&
    current &&
    previous.id === current.id &&
    previous.health?.pluginId === current.health?.pluginId &&
    providers.getGeneration(current.id) === generation &&
    current.getPlaybackQuality &&
    current.setPlaybackQuality &&
    isPluginProviderEnabled(current.health)
  if (!sameOwner) invalidate()
  else if (!busy.value) void refresh()
}

watch(() => [props.track.id, props.track.source, props.track.queueEntryId], invalidate, {
  immediate: true
})
onMounted(() => {
  unsubscribe = window.api.plugins.onChanged(() => {
    void onPluginsChanged()
  })
})
onBeforeUnmount(() => {
  active = false
  revision += 1
  refreshing?.abort()
  selecting?.abort()
  unsubscribe?.()
})
</script>

<template>
  <label
    v-if="provider"
    class="player-quality-control"
    title="首选音质；实际音频格式可在 HiFi 控制台查看"
  >
    <span>音质</span>
    <button v-if="loadError && !state" type="button" class="player-quality-select" @click="refresh">
      重试
    </button>
    <select
      v-else
      class="player-quality-select"
      aria-label="播放音质"
      :aria-busy="busy"
      :disabled="disabled || busy || !state"
      :value="state?.quality ?? ''"
      @focus="refresh"
      @change="selectQuality"
    >
      <option v-if="!state" value="">加载中</option>
      <option
        v-for="option in displayedOptions"
        :key="option.value"
        :value="option.value"
        :disabled="option.unavailable"
        :title="option.reason"
      >
        {{ option.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.player-quality-control {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}
.player-quality-select {
  max-width: 112px;
  min-height: 28px;
  padding: 3px 4px;
  border: 1px solid var(--border-color, var(--te-card-border));
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.player-quality-select:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
.player-quality-select:disabled {
  opacity: 0.55;
  cursor: wait;
}
</style>
