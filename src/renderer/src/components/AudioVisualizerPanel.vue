<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useAudioOutputDspStore } from '../stores/useAudioOutputDspStore'
import { usePlayerStore } from '../stores/usePlayerStore'
import { useCover } from '../utils/coverLoader'
import { formatVisualizerSource, resolveVisualizerAudioMetadata } from './audioVisualizerFormatting'
import { AudioTempoEstimator, normalizeBpm, type TempoEstimate } from './audioTempoEstimator'

const props = defineProps<{ active: boolean }>()

const playbackStore = usePlayerStore()
const audioOutputDspStore = useAudioOutputDspStore()
const { currentTrack, isPlaying, currentTime, duration } = playbackStore
const { audioEngineReady, playbackInfo } = storeToRefs(audioOutputDspStore)
const { formatTime, togglePlay, next, prev, seek } = playbackStore
const resolvedCover = useCover(
  computed(() => currentTrack.value?.cover ?? null),
  computed(() => currentTrack.value?.coverSource ?? null)
)

const iframeRef = ref<HTMLIFrameElement | null>(null)
const iframeReady = ref(false)
const visualizerSrc = ref(buildVisualizerSrc())
const documentVisible = ref(!document.hidden)
const VISUALIZER_BAR_COUNT = 140
const VISUALIZER_ANALYSIS_POINTS = 4096
const visualizationOptions = {
  spectrumPoints: VISUALIZER_ANALYSIS_POINTS,
  waveformPoints: 256,
  spectrogramFrames: 0,
  oscilloscopePoints: 0,
  visualizerBarCount: VISUALIZER_BAR_COUNT
} as const
const VISUALIZER_POLL_INTERVAL_MS = 50
const CONTROL_VISUALIZATION_PAUSE_MS = 220
let visualizationTimer: number | null = null
let visualizationRequestInFlight = false
let visualizerUnmounted = false
let visualizationPausedUntil = 0
const tempoEstimator = new AudioTempoEstimator()
let lastPostedTempo: TempoEstimate = { source: 'analyzing', confidence: 0 }
let lastPlaybackPosition: number | null = null
let currentMetadataBpm: number | undefined
const shouldPollVisualization = computed(
  () =>
    props.active &&
    iframeReady.value &&
    documentVisible.value &&
    isPlaying.value &&
    audioEngineReady.value &&
    currentTrack.value
)

function post(msg: unknown, transfer: Transferable[] = []): void {
  const targetWindow = iframeRef.value?.contentWindow
  if (!targetWindow) return
  const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin
  try {
    targetWindow.postMessage(msg, targetOrigin, transfer)
  } catch {
    targetWindow.postMessage(msg, '*', transfer)
  }
}

function buildVisualizerSrc(): string {
  return `./audio-visualizer/index.html?v=${Date.now()}`
}

function formatVisualizerBpm(value: unknown): string {
  const bpm = normalizeBpm(value)
  return bpm === undefined ? '' : bpm.toFixed(1).replace(/\.0$/, '')
}

function getPrimaryTrackBpm(
  track: { bpmAnalysis?: { bpm?: number }; bpm?: number } | null
): number | undefined {
  return normalizeBpm(track?.bpmAnalysis?.bpm) ?? normalizeBpm(track?.bpm)
}

function postTempo(tempo: TempoEstimate): void {
  if (tempo.source === 'live' && currentMetadataBpm !== undefined) return
  if (tempo.source === 'analyzing' && currentMetadataBpm !== undefined) return
  if (tempo.source === 'analyzing' && lastPostedTempo.bpm !== undefined) return
  const previousBpm = lastPostedTempo.bpm ?? 0
  const nextBpm = tempo.bpm ?? 0
  const shouldPost =
    tempo.source !== lastPostedTempo.source ||
    Math.abs(nextBpm - previousBpm) >= 0.1 ||
    Math.abs(tempo.confidence - lastPostedTempo.confidence) >= 0.05
  if (!shouldPost) return
  lastPostedTempo = { ...tempo }
  post({
    kind: 'bpm',
    bpm: tempo.bpm,
    confidence: tempo.confidence,
    source: tempo.source
  })
}

function resetTempoEstimator(): void {
  tempoEstimator.reset()
  lastPostedTempo = { source: 'analyzing', confidence: 0 }
}

async function pollVisualizationFrame(): Promise<void> {
  if (visualizerUnmounted || !shouldPollVisualization.value || visualizationRequestInFlight) return
  if (performance.now() < visualizationPausedUntil) return
  visualizationRequestInFlight = true
  try {
    const v = await window.api.audioEngine.getVisualizationData(visualizationOptions)
    if (visualizerUnmounted || !shouldPollVisualization.value) return
    // Synthetic fallback data is deterministic UI scaffolding, not a real FFT.
    // Never present it as if it described the current audio signal.
    if (v.tapStatus === 'synthetic-fallback') {
      postInactiveVisualizationFrame()
      return
    }
    const bars = Float32Array.from(v.visualizerBars ?? [])
    const waveform = Float32Array.from(v.waveform)
    const tempo = tempoEstimator.pushFrame({
      timestamp: performance.now(),
      visualizerBars: bars,
      waveform,
      rmsDb: v.rmsDb,
      active: v.active,
      referenceBpm: currentMetadataBpm
    })
    postTempo(tempo)
    post(
      {
        kind: 'spectrum',
        bars,
        waveform,
        sampleRate: v.sampleRate,
        maxFrequency: v.maxFrequency,
        peakDb: v.peakDb,
        rmsDb: v.rmsDb,
        lufsMomentary: v.lufsMomentary,
        active: v.active
      },
      [bars.buffer, waveform.buffer]
    )
  } catch {
    // The playback controls remain usable if visualization sampling is unavailable.
  } finally {
    visualizationRequestInFlight = false
  }
}

function postInactiveVisualizationFrame(): void {
  if (!iframeReady.value) return
  resetTempoEstimator()
  const bars = new Float32Array(VISUALIZER_BAR_COUNT)
  const waveform = new Float32Array(visualizationOptions.waveformPoints)
  post(
    {
      kind: 'spectrum',
      bars,
      waveform,
      sampleRate: 0,
      maxFrequency: 20000,
      peakDb: -120,
      rmsDb: -120,
      lufsMomentary: null,
      active: false
    },
    [bars.buffer, waveform.buffer]
  )
}

function scheduleVisualizationFrame(delayMs = 0): void {
  if (!shouldPollVisualization.value || visualizationTimer !== null) return
  visualizationTimer = window.setTimeout(async () => {
    visualizationTimer = null
    await pollVisualizationFrame()
    if (!visualizerUnmounted && shouldPollVisualization.value) {
      scheduleVisualizationFrame(VISUALIZER_POLL_INTERVAL_MS)
    }
  }, delayMs)
}

function startVisualizationPolling(): void {
  scheduleVisualizationFrame()
}

function stopVisualizationPolling(): void {
  if (visualizationTimer === null) return
  window.clearTimeout(visualizationTimer)
  visualizationTimer = null
}

function syncVisualizationPolling(): void {
  if (shouldPollVisualization.value) {
    startVisualizationPolling()
    return
  }
  const wasPolling = visualizationTimer !== null
  stopVisualizationPolling()
  if (wasPolling) postInactiveVisualizationFrame()
}

function pauseVisualizationForControl(): void {
  visualizationPausedUntil = performance.now() + CONTROL_VISUALIZATION_PAUSE_MS
  resetTempoEstimator()
}

// Buffer the latest track/cover/playback payloads so they can be re-sent once
// the iframe signals readiness — otherwise early messages would be dropped.
let pendingTrack: { track: Record<string, unknown> } | null = null
let pendingCover: { url: string | null } | null = null
let pendingPlayback: {
  isPlaying: boolean
  position: number
  duration: number
} | null = null

function flushPending(): void {
  if (pendingTrack) {
    post(pendingTrack)
    pendingTrack = null
  }
  if (pendingCover) {
    post(pendingCover)
    pendingCover = null
  }
  if (pendingPlayback) {
    post(pendingPlayback)
    pendingPlayback = null
  }
}

function onMessage(event: MessageEvent): void {
  if (event.source !== iframeRef.value?.contentWindow) return
  if (event.data?.kind === 'ready') {
    iframeReady.value = true
    flushPending()
    syncVisualizationPolling()
    return
  }

  if (event.data?.kind !== 'control') return
  pauseVisualizationForControl()
  switch (event.data.action) {
    case 'togglePlay':
      void togglePlay()
      break
    case 'previous':
      prev()
      break
    case 'next':
      next()
      break
    case 'seek': {
      const position = event.data.position
      if (typeof position === 'number' && Number.isFinite(position)) {
        seek(position)
      }
      break
    }
  }
}

window.addEventListener('message', onMessage)
function onDocumentVisibilityChange(): void {
  documentVisible.value = !document.hidden
}
onMounted(() => document.addEventListener('visibilitychange', onDocumentVisibilityChange))
onBeforeUnmount(() => {
  visualizerUnmounted = true
  stopVisualizationPolling()
  window.removeEventListener('message', onMessage)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
})

watch(
  [
    () => props.active,
    iframeReady,
    documentVisible,
    isPlaying,
    audioEngineReady,
    () => currentTrack.value?.id
  ],
  () => syncVisualizationPolling(),
  { immediate: true }
)

watch(
  () => props.active,
  (active, wasActive) => {
    if (!active || wasActive) return
    iframeReady.value = false
    visualizerSrc.value = buildVisualizerSrc()
  }
)

// Post track metadata when the current track changes.
watch(
  currentTrack,
  (track) => {
    if (!track) return
    resetTempoEstimator()
    const primaryBpm = getPrimaryTrackBpm(track)
    const metadataBpm = primaryBpm
    currentMetadataBpm = metadataBpm
    const audioMetadata = resolveVisualizerAudioMetadata(track, playbackInfo.value)
    const trackPayload = {
      kind: 'track',
      track: {
        title: track.title,
        artist: track.artist,
        album: track.album,
        quality: audioMetadata.quality,
        bpm: formatVisualizerBpm(primaryBpm),
        source: formatVisualizerSource(track),
        duration: formatTime(track.duration),
        durationSeconds: track.duration,
        dynamicRange: '',
        loudness: '',
        samplerate: audioMetadata.samplerate,
        bitdepth: audioMetadata.bitdepth,
        channels: audioMetadata.channels,
        bitrate: audioMetadata.bitrate,
        filesize: audioMetadata.filesize,
        format: audioMetadata.format
      }
    }
    if (iframeReady.value) {
      post(trackPayload)
      if (metadataBpm !== undefined) {
        postTempo({
          source: 'metadata',
          bpm: metadataBpm,
          confidence: track.bpmAnalysis?.confidence ?? 1
        })
      }
    } else pendingTrack = trackPayload
  },
  { immediate: true }
)

watch(
  [
    () => playbackInfo.value?.source,
    () => playbackInfo.value?.nativePlaybackActive,
    () => playbackInfo.value?.rendererSource,
    () => playbackInfo.value?.sourceBytes,
    () => playbackInfo.value?.codec,
    () => playbackInfo.value?.sourceSampleRate,
    () => playbackInfo.value?.sourceChannels,
    () => playbackInfo.value?.sourceBitDepth,
    () => playbackInfo.value?.bitrate
  ],
  () => {
    const track = currentTrack.value
    if (!track) return
    const metadata = resolveVisualizerAudioMetadata(track, playbackInfo.value)
    if (iframeReady.value) post({ kind: 'technical-metadata', metadata })
    else if (pendingTrack) pendingTrack.track = { ...pendingTrack.track, ...metadata }
  }
)

// Post cover URL when resolved.
watch(
  resolvedCover,
  (url) => {
    const coverPayload = { kind: 'cover', url: url ?? null }
    if (iframeReady.value) post(coverPayload)
    else pendingCover = coverPayload
  },
  { immediate: true }
)

// Post playback state.
watch(
  [isPlaying, currentTime, duration],
  ([playing, position, dur]) => {
    if (lastPlaybackPosition !== null && Math.abs(position - lastPlaybackPosition) > 3) {
      resetTempoEstimator()
    }
    lastPlaybackPosition = position
    const playbackPayload = {
      kind: 'playback',
      isPlaying: playing,
      position,
      duration: dur
    }
    if (iframeReady.value) post(playbackPayload)
    else pendingPlayback = playbackPayload
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  post({ kind: 'playback', isPlaying: false, position: 0, duration: 0 })
})
</script>

<template>
  <div class="visualizer-panel">
    <iframe
      ref="iframeRef"
      :src="visualizerSrc"
      class="visualizer-iframe"
      frameborder="0"
      allow="autoplay; fullscreen; encrypted-media"
    />
  </div>
</template>

<style scoped>
.visualizer-panel {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #e4e6eb;
  /* Force the iframe into its own compositor layer so it doesn't interact
     with the backdrop's blur filter (which can stall the GPU process). */
  contain: strict;
  transform: translateZ(0);
  will-change: transform;
}

.visualizer-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #e4e6eb;
}
</style>
