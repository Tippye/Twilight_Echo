import { computed, onBeforeUnmount, watch } from 'vue'
import type { DynamicIslandLyricsPayload } from '../../../shared/dynamicIsland.ts'
import { projectManagedLyrics } from '../../../shared/lyricsManagement.ts'
import { useLyricsManagement } from '../stores/lyricsManagement.ts'
import { usePlayerStore } from '../stores/usePlayerStore.ts'
import { createLyricContentCache } from '../utils/lyricContentCache.ts'
import type { LyricLine } from '../utils/lyricTypes.ts'

/**
 * Flatten managed lyric lines into the island payload. Unsynced lines keep
 * `time: null`; the island shows them as plain text but never as active.
 */
function projectIslandLyrics(lines: readonly LyricLine[]): DynamicIslandLyricsPayload['lines'] {
  return lines
    .map((line) => ({
      time: line.time,
      original: line.text.trim(),
      translation: line.translation?.trim() ?? null,
      romanization: line.romanization?.trim() ?? null
    }))
    .filter((line) => line.original.length > 0)
}

/**
 * Publishes parsed lyrics to the host on the island-only channel. The shared
 * mini-player snapshot stays lyric-free on purpose; the island re-syncs from
 * `currentTime`, so this only runs when the track or its lyrics change.
 */
export function useDynamicIslandLyrics(): void {
  const player = usePlayerStore()
  const management = useLyricsManagement()
  const buildCachedLyricLines = createLyricContentCache()
  let parsedLines: LyricLine[] | null = null
  let projectedLines: DynamicIslandLyricsPayload['lines'] = []

  const payload = computed<DynamicIslandLyricsPayload>(() => {
    const track = player.currentTrack.value
    if (!track) {
      parsedLines = null
      projectedLines = []
      return { trackId: null, lines: projectedLines }
    }
    const override = management.entryFor(track.id)
    const managed = projectManagedLyrics(
      {
        original: track.lyrics,
        translation: track.translatedLyrics,
        romanization: track.romanizedLyrics,
        originalSource: track.lyricsSource,
        translationSource: track.translatedLyricsSource,
        romanizationSource: track.romanizedLyricsSource
      },
      override
    )
    const nextParsed = buildCachedLyricLines(
      managed.original,
      managed.translation,
      managed.romanization,
      {
        replaceTtmlTranslation:
          override?.translationSelection === 'manual' ||
          (override?.translationSelection == null && override?.source === 'manual'),
        replaceTtmlRomanization:
          override?.romanizationSelection === 'manual' ||
          (override?.romanizationSelection == null && override?.source === 'manual')
      }
    )
    if (nextParsed !== parsedLines) {
      parsedLines = nextParsed
      projectedLines = projectIslandLyrics(nextParsed)
    }
    return { trackId: track.id, lines: projectedLines }
  })

  let lastPublished: DynamicIslandLyricsPayload | null = null
  const publish = (): void => {
    const next = payload.value
    // The computed returns a fresh wrapper object, but `lines` keeps its array
    // identity until the track or its lyrics actually change. Skip no-op sends
    // so progress-driven recomputes never re-serialize the lyric array.
    if (
      lastPublished &&
      lastPublished.trackId === next.trackId &&
      lastPublished.lines === next.lines
    ) {
      return
    }
    lastPublished = next
    window.api?.miniPlayer?.publishLyrics?.(next)
  }
  const stop = watch(payload, publish, { immediate: true })
  onBeforeUnmount(stop)
}
