<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import {
  copyWorkshopDraft,
  type WorkshopProject,
  type WorkshopAsset
} from '../../../../shared/themeWorkshop.ts'
import {
  workshopAssetBytes,
  workshopAssetReferences
} from '../../../../shared/themeWorkshopEditing.ts'
const props = defineProps<{ project: WorkshopProject; busy: boolean }>()
const emit = defineEmits<{
  change: [project: WorkshopProject]
  import: [type: 'image' | 'font']
  replace: [asset: WorkshopAsset]
}>()
const sizes = shallowRef<Record<string, string>>({})
const fonts = computed(() => props.project.assets?.filter((asset) => asset.type === 'font') ?? [])
const totalBytes = computed(
  () => props.project.assets?.reduce((total, asset) => total + workshopAssetBytes(asset), 0) ?? 0
)
const references = computed(
  () =>
    new Map(
      props.project.assets?.map((asset) => [
        asset.id,
        workshopAssetReferences(props.project, asset)
      ])
    )
)
let generation = 0
const pendingImages = new Set<HTMLImageElement>()
function releaseImage(image: HTMLImageElement): void {
  pendingImages.delete(image)
  image.onload = null
  image.onerror = null
  image.src = ''
}
function cancelPendingImages(): void {
  for (const image of pendingImages) releaseImage(image)
}
watch(
  () => props.project.assets,
  (assets) => {
    const version = ++generation
    cancelPendingImages()
    for (const asset of assets ?? []) {
      if (asset.type !== 'image' || sizes.value[asset.id]) continue
      const image = new Image()
      pendingImages.add(image)
      image.onload = () => {
        try {
          if (version === generation)
            sizes.value = {
              ...sizes.value,
              [asset.id]: `${image.naturalWidth} × ${image.naturalHeight}`
            }
        } finally {
          releaseImage(image)
        }
      }
      image.onerror = () => {
        try {
          if (version === generation) sizes.value = { ...sizes.value, [asset.id]: '无法解码' }
        } finally {
          releaseImage(image)
        }
      }
      image.src = asset.dataUrl
    }
  },
  { immediate: true }
)
onBeforeUnmount(cancelPendingImages)
function update(asset: WorkshopAsset, key: 'name' | 'license' | 'source', value: string): void {
  const next = copyWorkshopDraft(props.project)
  next.assets!.find((item) => item.id === asset.id)![key] = value
  emit('change', next)
}
function font(family: string, value: string): void {
  const next = copyWorkshopDraft(props.project)
  next.fonts = { ...next.fonts }
  if (value) next.fonts[family as keyof typeof next.fonts] = value
  else delete next.fonts[family as keyof typeof next.fonts]
  emit('change', next)
}
function remove(asset: WorkshopAsset): void {
  if (references.value.get(asset.id)?.length) return
  emit('change', {
    ...props.project,
    assets: props.project.assets?.filter((item) => item.id !== asset.id)
  })
}
function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
function replace(asset: WorkshopAsset): void {
  sizes.value = {}
  emit('replace', asset)
}
</script>
<template>
  <div class="workshop-inline">
    <button
      :disabled="busy || (project.assets?.length ?? 0) >= 128"
      @click="emit('import', 'image')"
    >
      ＋ 图片</button
    ><button
      :disabled="busy || (project.assets?.length ?? 0) >= 128"
      @click="emit('import', 'font')"
    >
      ＋ WOFF2 字体
    </button>
  </div>
  <p class="workshop-hint">
    {{ project.assets?.length ?? 0 }}/128 个素材 · 原始数据
    {{ megabytes(totalBytes) }}。裁剪保留原图；导出包含许可和署名。
  </p>
  <label v-for="family in ['sans', 'display', 'rounded'] as const" :key="family"
    >{{ { sans: '正文字体', display: '标题字体', rounded: '圆体' }[family]
    }}<select
      :disabled="busy"
      :value="project.fonts?.[family] ?? ''"
      @change="font(family, ($event.target as HTMLSelectElement).value)"
    >
      <option value="">继承主题</option>
      <option v-for="asset in fonts" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
    </select></label
  >
  <article
    v-for="asset in project.assets"
    :key="asset.id"
    class="workshop-asset-card"
    :data-workshop-asset="asset.id"
    tabindex="-1"
  >
    <img
      v-if="asset.type === 'image'"
      :src="asset.dataUrl"
      :alt="asset.name"
      loading="lazy"
      decoding="async"
    />
    <h3>{{ asset.name }}</h3>
    <small
      >{{ sizes[asset.id] ?? (asset.type === 'font' ? 'WOFF2' : '读取尺寸中…') }} ·
      {{ megabytes(workshopAssetBytes(asset)) }}</small
    >
    <label
      v-for="[key, label] in [
        ['name', '名称'],
        ['source', '素材来源'],
        ['license', '许可／署名']
      ] as const"
      :key="key"
      >{{ label
      }}<input
        :disabled="busy"
        :value="asset[key]"
        @change="update(asset, key, ($event.target as HTMLInputElement).value)"
    /></label>
    <details>
      <summary>引用位置（{{ references.get(asset.id)?.length ?? 0 }}）</summary>
      <p v-for="reference in references.get(asset.id)" :key="reference">{{ reference }}</p>
    </details>
    <div class="workshop-inline">
      <button :disabled="busy" @click="replace(asset)">替换素材</button
      ><button
        :disabled="busy || !!references.get(asset.id)?.length"
        :title="references.get(asset.id)?.length ? '先移除引用，再删除素材' : '删除未引用素材'"
        @click="remove(asset)"
      >
        删除素材
      </button>
    </div>
  </article>
</template>
