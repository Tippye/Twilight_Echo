<script setup lang="ts">
import { computed } from 'vue'
import type { AppBackgroundPage } from '../../../shared/appSettings.ts'
const props = defineProps<{
  page: AppBackgroundPage | 'app'
  embedded?: boolean
  ambient?: boolean
}>()
const style = computed(() =>
  Object.fromEntries(
    [
      ['color', `var(--te-${props.page}-bg)`],
      ['image', `var(--te-${props.page}-bg-image, none)`],
      ...['blur', 'brightness', 'dim', 'scale', 'position'].map((field) => [
        field,
        `var(--te-${props.page}-background-${field})`
      ])
    ].map(([field, value]) => [`--appearance-${field}`, value])
  )
)
</script>
<template>
  <div
    class="app-background-layer"
    :class="{ 'app-background-layer--embedded': embedded }"
    :data-background-page="page"
    :style="style"
    aria-hidden="true"
  >
    <div class="app-background-image" />
    <div class="app-background-dim" />
  </div>
  <div v-if="ambient" class="app-background-ambient" aria-hidden="true" />
</template>
