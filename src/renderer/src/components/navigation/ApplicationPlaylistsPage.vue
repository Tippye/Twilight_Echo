<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
const SongList = defineAsyncComponent(() => import('@renderer/components/SongList.vue'))
const AggregatePlaylistPage = defineAsyncComponent(
  () => import('@renderer/components/aggregate-playlist/AggregatePlaylistPage.vue')
)
defineProps<{
  category: string
  filter: string | null
  hasPlayer: boolean
  transitionName: 'page-down' | 'page-up'
  returnFromDetail: () => void
}>()
const emit = defineEmits<{
  selectView: [category: string, filter: string | null]
  customizeAppearance: []
}>()
</script>

<template>
  <section class="application-playlists-page">
    <div class="playlist-tabs">
      <div class="playlist-segmented" role="group" aria-label="歌单分类">
        <button
          type="button"
          :aria-pressed="category === 'playlists'"
          @click="emit('selectView', 'playlists', null)"
        >
          应用歌单
        </button>
        <button
          type="button"
          :aria-pressed="category === 'aggregate'"
          @click="emit('selectView', 'aggregate', null)"
        >
          聚合歌单
        </button>
      </div>
    </div>
    <div class="playlist-content">
      <AggregatePlaylistPage
        v-if="category === 'aggregate'"
        :has-player="hasPlayer"
        surface="local"
        :initial-playlist-id="filter"
        :navigate-playlist="(id) => emit('selectView', 'aggregate', id)"
        :return-from-detail="returnFromDetail"
      />
      <SongList
        v-else
        category="playlists"
        :filter="filter"
        :has-player="hasPlayer"
        :transition-name="transitionName"
        :return-from-detail="returnFromDetail"
        @select-view="(category, filter) => emit('selectView', category, filter)"
        @customize-appearance="emit('customizeAppearance')"
      />
    </div>
  </section>
</template>

<style scoped>
.application-playlists-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
}
.playlist-tabs {
  display: flex;
  flex-shrink: 0;
  padding: 52px min(4.4vw, 48px) 0;
}
.playlist-segmented {
  display: inline-flex;
  gap: 3px;
  padding: 4px;
  border: 1px solid var(--te-card-border);
  border-radius: 12px;
  background: var(--te-subtle-bg);
  max-width: 100%;
}
.playlist-tabs button {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--te-neutral-500);
  padding: 7px 16px;
  line-height: 1.4;
  white-space: nowrap;
  font: inherit;
  font-weight: 600;
  transition:
    background 0.18s,
    color 0.18s;
  cursor: pointer;
}
.playlist-tabs button:hover {
  background: var(--te-hover-bg);
  color: var(--te-neutral-900);
}
.playlist-tabs button[aria-pressed='true'] {
  background: var(--te-card-bg);
  color: var(--te-primary-500);
  border-color: var(--te-card-border);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--te-neutral-900) 8%, transparent);
}
.playlist-tabs button:focus-visible {
  outline: 2px solid var(--te-navigation-indicator);
  outline-offset: 2px;
}
.playlist-content {
  flex: 1;
  min-height: 0;
}
.playlist-content :deep(.song-list),
.playlist-content :deep(.aggregate-page) {
  height: 100% !important;
  padding-top: 24px;
}
:global(html[data-theme='pureWhite'] .application-playlists-page) {
  background: var(--te-card-bg);
}
.playlist-content :deep(.song-list) {
  background: transparent;
}
.playlist-content :deep(.aggregate-page) {
  padding-inline: min(4.4vw, 48px);
}
:global(html[data-te-shell-layout='custom'] .application-playlists-page) {
  height: 100%;
}
:global(html[data-te-shell-layout='custom'] .playlist-tabs) {
  padding-top: 20px;
}
</style>
