<script setup lang="ts">
import { computed, useId } from 'vue'
import {
  filterNcmAlbums,
  getNcmAlbumFilterOptions,
  type NcmAlbumClassification
} from './ncmAlbumClassification'

const props = defineProps<{
  albums: NcmAlbumClassification[]
  releaseType: string
}>()
const emit = defineEmits<{
  'update:releaseType': [value: string]
}>()
const groupId = `ncm-album-type-${useId()}`
const types = computed(() => [
  { value: '', label: '全部', count: props.albums.length },
  ...getNcmAlbumFilterOptions(props.albums)
])
const count = computed(() => filterNcmAlbums(props.albums, props.releaseType).length)
</script>

<template>
  <div class="ncm-album-filters" role="region" aria-label="网易云专辑分类">
    <fieldset>
      <legend>发行类型</legend>
      <div class="ncm-album-options">
        <label
          v-for="option in types"
          :key="option.value"
          :class="{ 'is-active': releaseType === option.value }"
        >
          <input
            type="radio"
            :name="groupId"
            :value="option.value"
            :checked="releaseType === option.value"
            @change="emit('update:releaseType', option.value)"
          />
          <span>{{ option.label }}（{{ option.count }}）</span>
        </label>
      </div>
    </fieldset>
    <span class="ncm-album-count" role="status">{{ count }} / {{ albums.length }} 张</span>
    <span class="ncm-album-source">按网易云标注</span>
  </div>
</template>

<style scoped>
.ncm-album-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 16px;
  color: var(--te-neutral-500);
  font-size: 13px;
}
fieldset {
  flex: 1 1 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
legend {
  margin-bottom: 8px;
  padding: 0;
}
.ncm-album-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--te-card-border);
  border-radius: 8px;
  color: var(--te-neutral-900);
  background: var(--te-card-bg);
  cursor: pointer;
}
label.is-active {
  border-color: var(--te-primary-500);
  background: var(--te-active-bg);
}
label > span {
  overflow-wrap: anywhere;
}
input {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--te-primary-500);
  cursor: inherit;
}
input:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 2px;
}
.ncm-album-count {
  font-variant-numeric: tabular-nums;
}
.ncm-album-source {
  margin-left: auto;
  font-size: 12px;
}
</style>
