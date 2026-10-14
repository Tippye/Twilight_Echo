<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Track } from '../../types/music'
import { syncPluginProviders, useMediaProviders } from '../../providers'
import type { MediaProvider, MediaProviderPlaybackQuality } from '../../providers/mediaProvider.ts'
import { isPluginProviderEnabled } from '../../providers/mediaProvider.ts'
import { usePlayerStore } from '../../stores/usePlayerStore'
import { useAppNoticeStore } from '../../stores/useAppNoticeStore'

const props = defineProps<{ track: Track; disabled?: boolean }>()
const { changePlaybackQuality } = usePlayerStore()
const { pushNotice } = useAppNoticeStore()
const provider = shallowRef<MediaProvider | null>(null)
const state = ref<MediaProviderPlaybackQuality | null>(null)
const busy = ref(false)
const loadError = ref(false)
let revision = 0
let selectionRevision = 0
let active = true
let unsubscribe: (() => void) | undefined

async function refresh(): Promise<void> {
  const request = ++revision
  const track = props.track
  try {
    await syncPluginProviders()
    if (!active || request !== revision || props.track.id !== track.id) return
    const current = useMediaProviders().getForTrack(track)
    provider.value =
      current?.getPlaybackQuality &&
      current.setPlaybackQuality &&
      isPluginProviderEnabled(current.health)
        ? current
        : null
    if (!provider.value) {
      state.value = null
      return
    }
    const next = await provider.value.getPlaybackQuality!()
    if (active && request === revision) {
      state.value = next
      loadError.value = false
    }
  } catch {
    if (active && request === revision) {
      loadError.value = true
    }
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
  const track = { id: props.track.id, source: props.track.source, entry: props.track.queueEntryId }
  const selectedProvider = provider.value
  const providers = useMediaProviders()
  const generation = selectedProvider ? providers.getGeneration(selectedProvider.id) : -1
  const ownsSelection = (): boolean =>
    active &&
    request === selectionRevision &&
    props.track.id === track.id &&
    props.track.source === track.source &&
    props.track.queueEntryId === track.entry &&
    !!selectedProvider &&
    providers.getGeneration(selectedProvider.id) === generation
  busy.value = true
  try {
    const next = await changePlaybackQuality(quality)
    if (ownsSelection()) state.value = next
  } catch (error) {
    if (ownsSelection()) {
      pushNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : '音质切换失败，请重试'
      })
    }
  } finally {
    if (ownsSelection()) {
      busy.value = false
      await refresh()
    }
  }
}

function invalidate(): void {
  selectionRevision += 1
  revision += 1
  busy.value = false
  state.value = null
  provider.value = null
  loadError.value = false
  void refresh()
}

watch(() => [props.track.id, props.track.source, props.track.queueEntryId], invalidate, {
  immediate: true
})
onMounted(() => {
  unsubscribe = window.api.plugins.onChanged(() => {
    invalidate()
  })
})
onBeforeUnmount(() => {
  active = false
  revision += 1
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
      <option v-for="option in state?.options ?? []" :key="option.value" :value="option.value">
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
