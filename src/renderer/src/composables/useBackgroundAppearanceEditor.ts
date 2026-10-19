import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useSettingsStore } from '../stores/useSettingsStore'
import { previewAppearance } from '../stores/useThemeStore.ts'
import { useEscapeToClose, useFocusTrap } from '../app/useDismissLayer.ts'
import {
  appearanceEditorOpen,
  appearanceEditorArea,
  appearanceFullWindowPreview
} from './appearanceEditorState.ts'
import { useAppearanceDraft } from './useAppearanceDraft.ts'
import { loadLiquidGlassContextImage } from '../utils/liquidGlassContextImage.ts'
import { recommendTransparentAppearance } from '../utils/transparentAppearanceRecipe.ts'
import {
  BACKGROUND_EFFECT_RANGES,
  applyAppearancePreset,
  backgroundCssVariables,
  backgroundEffect,
  cardCssVariables,
  defaultBackground,
  defaultBackgroundEffect,
  defaultCardAppearance,
  resolveBackground,
  type AppearancePreset,
  type AppearanceTone
} from '../../../shared/appAppearance.ts'
import {
  DEFAULT_LIQUID_GLASS,
  liquidGlassCssVariables,
  normalizeLiquidGlass
} from '../../../shared/liquidGlass.ts'
import type {
  AppBackgroundColorPair,
  AppBackgroundEffect,
  AppBackgroundPage
} from '../../../shared/appSettings.ts'

export function useBackgroundAppearanceEditor() {
  const { settings, updateSettings, importBackgroundImage } = useSettingsStore()
  const session = useAppearanceDraft({
    confirmed: () => settings.value,
    persist: updateSettings,
    preview: previewAppearance
  })
  const { state } = session
  const dialogRef = ref<HTMLElement | null>(null)
  const bodyRef = ref<HTMLElement | null>(null)
  const fileInput = ref<HTMLInputElement | null>(null)
  const target = ref<'global' | AppBackgroundPage>('global')
  const previewPage = ref<AppBackgroundPage>('local')
  const tone = ref<AppearanceTone>(
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  )
  const importing = ref(false)
  const matching = ref(false)
  const recipePromptOpen = ref(false)
  const recipePromptRef = ref<HTMLElement | null>(null)
  const busy = computed(() => importing.value || matching.value)
  const advancedOpen = ref(appearanceEditorArea.value === 'advanced')
  let importRevision = 0
  let recipeRequest: AbortController | null = null
  let pickerTarget: typeof target.value = 'global'
  const pageOptions: Array<{ value: AppBackgroundPage; label: string }> = [
    { value: 'local', label: '本地音乐' },
    { value: 'streaming', label: '在线音乐' },
    { value: 'player', label: '播放页' },
    { value: 'settings', label: '设置页' }
  ]
  const materials: Array<{ value: AppearancePreset; label: string; icon: string }> = [
    { value: 'theme', label: '跟随主题', icon: 'pi pi-palette' },
    { value: 'transparent', label: '透明', icon: 'pi pi-eye' },
    { value: 'frosted', label: '毛玻璃', icon: 'pi pi-cloud' },
    { value: 'liquidGlass', label: '液态玻璃', icon: 'pi pi-sparkles' }
  ]
  const activeBackground = computed(() =>
    target.value === 'global'
      ? state.draft.appBackground.global
      : resolveBackground(state.draft.appBackground, target.value)
  )
  const inherited = computed(
    () => target.value !== 'global' && state.draft.appBackground.pages[target.value].inherit
  )
  const effect = computed(() => backgroundEffect(activeBackground.value, tone.value))
  const activeMaterial = computed(() =>
    state.draft.surfaceMaterial === 'standard'
      ? state.draft.cardAppearance.enabled
        ? 'frosted'
        : 'theme'
      : state.draft.surfaceMaterial
  )
  const previewStyle = computed(() => {
    const background = resolveBackground(state.draft.appBackground, previewPage.value)
    const card = state.draft.cardAppearance[tone.value]
    const glass = state.draft.liquidGlass[tone.value]
    return {
      ...backgroundCssVariables(background, tone.value),
      ...cardCssVariables(card),
      ...liquidGlassCssVariables(glass),
      '--preview-surface':
        state.draft.surfaceMaterial === 'transparent'
          ? 'transparent'
          : state.draft.surfaceMaterial === 'liquidGlass'
            ? `color-mix(in srgb, ${tone.value === 'dark' ? '#17181a' : '#ffffff'} ${glass.tintOpacity}%, transparent)`
            : state.draft.cardAppearance.enabled
              ? 'var(--te-card-bg)'
              : tone.value === 'dark'
                ? '#181818dd'
                : '#ffffffdd',
      '--preview-filter':
        state.draft.surfaceMaterial === 'transparent'
          ? 'none'
          : state.draft.surfaceMaterial === 'liquidGlass'
            ? `blur(${glass.blurAmount}px) saturate(${glass.saturation}%)`
            : state.draft.cardAppearance.enabled
              ? `blur(${card.blurRadius}px) saturate(${card.blurSaturation}%)`
              : 'none',
      '--preview-border':
        state.draft.surfaceMaterial === 'transparent' ? 'transparent' : 'var(--te-card-border)',
      '--preview-shadow':
        state.draft.surfaceMaterial === 'transparent'
          ? 'none'
          : state.draft.surfaceMaterial === 'liquidGlass'
            ? 'inset 0 1px 0 #ffffff40'
            : state.draft.cardAppearance.enabled
              ? 'var(--te-card-shadow)'
              : 'none'
    }
  })
  useFocusTrap(
    dialogRef,
    () => appearanceEditorOpen.value && !state.fullWindow && !recipePromptOpen.value
  )
  useFocusTrap(recipePromptRef, recipePromptOpen)
  useEscapeToClose(
    () => appearanceEditorOpen.value,
    () => {
      if (state.saving || importing.value) return
      if (state.fullWindow) void fullPreview(false)
      else void cancel()
    }
  )
  useEscapeToClose(recipePromptOpen, () => {
    recipePromptOpen.value = false
  })
  watch(
    recipePromptOpen,
    async (open) => {
      if (!open) return
      await nextTick()
      recipePromptRef.value?.focus({ preventScroll: true })
    },
    { flush: 'post' }
  )
  watch(
    appearanceEditorOpen,
    (open) => {
      if (open) session.begin()
    },
    { immediate: true }
  )
  async function scrollToArea(): Promise<void> {
    if (appearanceEditorArea.value === 'advanced') advancedOpen.value = true
    await nextTick()
    bodyRef.value
      ?.querySelector(`#appearance-${appearanceEditorArea.value}`)
      ?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }
  watch([appearanceEditorArea, bodyRef], () => void scrollToArea(), { flush: 'post' })
  watch(
    () => state.draft,
    () => {
      if (state.fullWindow) void previewAppearance(state.draft)
    },
    { deep: true }
  )
  watch(
    () => state.fullWindow,
    (value) => {
      appearanceFullWindowPreview.value = value
    },
    { flush: 'sync' }
  )
  watch(target, (page) => {
    if (page !== 'global') previewPage.value = page
  })

  function editableBackground(page = target.value, customize = true): AppBackgroundColorPair {
    const background =
      page === 'global' ? state.draft.appBackground.global : state.draft.appBackground.pages[page]
    if (customize) background.customized = true
    return background
  }
  function setEffect<K extends keyof AppBackgroundEffect>(
    field: K,
    value: AppBackgroundEffect[K]
  ): void {
    if (inherited.value) return
    const background = editableBackground(target.value, false)
    background.effects ??= {
      light: backgroundEffect(background, 'light'),
      dark: backgroundEffect(background, 'dark')
    }
    background.effects[tone.value][field] = value
  }
  function setInheritance(event: Event): void {
    if (target.value === 'global') return
    const inherit = (event.target as HTMLInputElement).checked
    const page = state.draft.appBackground.pages[target.value]
    if (!inherit && page.inherit) {
      const global = state.draft.appBackground.global
      Object.assign(page, {
        ...global,
        effects: {
          light: { ...backgroundEffect(global, 'light') },
          dark: { ...backgroundEffect(global, 'dark') }
        }
      })
    }
    page.inherit = inherit
  }
  function chooseImage(): void {
    pickerTarget = target.value
    fileInput.value?.click()
  }

  function setBackgroundKind(kind: AppBackgroundColorPair['kind']): void {
    const background = editableBackground(target.value, false)
    if (kind === 'image') {
      if (background.kind === 'image') return
      background.kind = kind
      background.customized = true
      return
    }

    // Removing wallpaper also removes its contrast treatment. In particular,
    // a default solid colour must stop suppressing the artwork on the player.
    if (state.draft.surfaceMaterial === 'transparent')
      state.draft = applyAppearancePreset(state.draft, 'theme')
    const restored = editableBackground(target.value, false)
    const defaults = defaultBackground(target.value)
    restored.kind = 'color'
    restored.image = ''
    restored.customized = restored.light !== defaults.light || restored.dark !== defaults.dark
    restored.effects = {
      light: defaultBackgroundEffect(),
      dark: defaultBackgroundEffect()
    }
  }

  async function importImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const revision = ++importRevision
    const selectedTarget = pickerTarget
    importing.value = true
    state.error = ''
    try {
      if (!/\.(jpe?g|png|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024)
        throw new Error('请选择 20MB 以内的 JPG、PNG 或 WebP 图片')
      const image = await importBackgroundImage(file)
      if (!image) throw new Error('图片导入失败，请重新选择')
      const bitmap = new Image()
      try {
        bitmap.src = image
        await bitmap.decode()
        if (revision !== importRevision) return
        const background = editableBackground(selectedTarget)
        background.image = image
        background.kind = 'image'
        recipePromptOpen.value = true
      } finally {
        bitmap.onload = null
        bitmap.onerror = null
        bitmap.src = ''
      }
    } catch (error) {
      if (revision === importRevision)
        state.error = error instanceof Error ? error.message : '无法读取这张图片'
    } finally {
      if (revision === importRevision) importing.value = false
    }
  }
  function removeImage(): void {
    setBackgroundKind('color')
  }
  function resetCurrent(): void {
    if (appearanceEditorArea.value !== 'background') {
      state.draft.cardAppearance = defaultCardAppearance()
      state.draft.liquidGlass = normalizeLiquidGlass(DEFAULT_LIQUID_GLASS)
      state.draft.surfaceMaterial = 'standard'
    } else if (target.value === 'global') {
      state.draft.appBackground.global = defaultBackground()
    } else {
      state.draft.appBackground.pages[target.value] = {
        ...defaultBackground(target.value),
        inherit: true
      }
    }
  }
  function selectMaterial(preset: AppearancePreset): void {
    state.draft = applyAppearancePreset(state.draft, preset)
  }
  async function useTransparentRecipe(): Promise<void> {
    if (inherited.value || state.saving || importing.value) return
    recipeRequest?.abort()
    const request = new AbortController()
    recipeRequest = request
    matching.value = true
    state.error = ''
    const selectedTarget = target.value
    const selectedTone = tone.value
    const background = activeBackground.value
    const source = background.kind === 'image' ? background.image : ''
    let recipe = recommendTransparentAppearance([])
    let samplingFailed = false
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = Math.max(
        16,
        Math.min(128, Math.round((64 * window.innerHeight) / Math.max(1, window.innerWidth)))
      )
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('图片采样不可用')
      context.fillStyle = background[selectedTone]
      context.fillRect(0, 0, canvas.width, canvas.height)
      if (source) {
        const image = await loadLiquidGlassContextImage(source, request.signal, undefined, 2500)
        try {
          const aspect = canvas.width / canvas.height
          const cropWidth = Math.min(image.naturalWidth, image.naturalHeight * aspect)
          const cropHeight = cropWidth / aspect
          const position = backgroundEffect(background, selectedTone)
          context.drawImage(
            image,
            ((image.naturalWidth - cropWidth) * position.positionX) / 100,
            ((image.naturalHeight - cropHeight) * position.positionY) / 100,
            cropWidth,
            cropHeight,
            0,
            0,
            canvas.width,
            canvas.height
          )
        } finally {
          // Sampling is synchronous; release the decoded wallpaper immediately.
          image.src = ''
        }
      }
      recipe = recommendTransparentAppearance(
        context.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width
      )
    } catch {
      samplingFailed = !request.signal.aborted
    } finally {
      if (recipeRequest === request) matching.value = false
    }
    // A late image result must not overwrite a new target, image, or editor session.
    if (
      request.signal.aborted ||
      recipeRequest !== request ||
      !appearanceEditorOpen.value ||
      target.value !== selectedTarget ||
      tone.value !== selectedTone ||
      activeBackground.value !== background ||
      (background.kind === 'image' ? background.image : '') !== source
    ) {
      if (recipeRequest === request) recipeRequest = null
      return
    }
    recipeRequest = null
    if (samplingFailed) state.error = '无法分析背景，已采用浅色文字与保护遮罩。'
    // Clear previous custom card/glass layers so the recipe has one predictable material.
    state.draft = applyAppearancePreset(applyAppearancePreset(state.draft, 'theme'), 'transparent')
    for (const [field, value] of Object.entries({
      ...recipe,
      blur: 0,
      brightness: 100,
      scale: 1
    })) {
      setEffect(
        field as keyof AppBackgroundEffect,
        value as AppBackgroundEffect[keyof AppBackgroundEffect]
      )
    }
  }

  function dismissRecipePrompt(): void {
    recipePromptOpen.value = false
  }

  async function applyRecipeFromPrompt(): Promise<void> {
    recipePromptOpen.value = false
    await useTransparentRecipe()
  }
  async function fullPreview(value: boolean): Promise<void> {
    await session.preview(value)
    if (!value) {
      await nextTick()
      dialogRef.value?.focus({ preventScroll: true })
    }
  }
  async function cancel(): Promise<void> {
    if (state.saving) return
    recipeRequest?.abort()
    importRevision++
    await session.cancel()
    appearanceEditorOpen.value = false
  }
  async function save(): Promise<void> {
    if (!busy.value && (await session.save())) appearanceEditorOpen.value = false
  }
  onBeforeUnmount(() => {
    recipeRequest?.abort()
    importRevision++
    appearanceFullWindowPreview.value = false
    void session.cancel()
  })
  return {
    state,
    dialogRef,
    bodyRef,
    fileInput,
    target,
    previewPage,
    tone,
    importing,
    matching,
    recipePromptOpen,
    recipePromptRef,
    busy,
    advancedOpen,
    pageOptions,
    materials,
    activeBackground,
    inherited,
    effect,
    activeMaterial,
    previewStyle,
    editableBackground,
    setBackgroundKind,
    setEffect,
    setInheritance,
    chooseImage,
    importImage,
    removeImage,
    resetCurrent,
    selectMaterial,
    useTransparentRecipe,
    dismissRecipePrompt,
    applyRecipeFromPrompt,
    fullPreview,
    cancel,
    save,
    ranges: BACKGROUND_EFFECT_RANGES
  }
}
