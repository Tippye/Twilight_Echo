import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref
} from 'vue'
import { compileWorkshopProject, type WorkshopProject } from '../../../../shared/themeWorkshop.ts'
import {
  workshopDiagnosticReport,
  type WorkshopDiagnostic,
  type WorkshopDiagnosticReport
} from '../../../../shared/themeWorkshopDiagnostics.ts'
import { createThemePreviewScheduler } from '@renderer/utils/themePreviewScheduler'
import { createThemePerformanceRecorder } from '@renderer/utils/themePerformance'
import { WORKSHOP_PREVIEW_SURFACES } from '@renderer/components/theme-workshop/workshopCatalog'
import type { ThemeTone } from '../../../../shared/theme.ts'
import { diagnoseWorkshopCssSupport } from '../../../../shared/themeWorkshopCssDiagnostics.ts'
import type { WorkshopAsset } from '../../../../shared/themeWorkshop.ts'

export interface WorkshopPreviewScene {
  tone: ThemeTone
  surface: string
  width: number
  state: string
}
export function useWorkshopDiagnostics(
  project: ComputedRef<WorkshopProject | undefined>,
  generation: Ref<number>,
  candidate: Ref<unknown>,
  inspect: () => Promise<WorkshopDiagnostic[]>
) {
  const css = ref('')
  const validProject = shallowRef<WorkshopProject>()
  const previewValid = ref(true)
  const baseReport = shallowRef<WorkshopDiagnosticReport>(workshopDiagnosticReport([]))
  const visual = shallowRef<WorkshopDiagnostic[]>([])
  const bufferProblems = shallowRef<WorkshopDiagnostic[]>([])
  const checking = ref(false)
  const progress = ref('')
  const stale = ref(true)
  const scene = shallowRef<WorkshopPreviewScene>()
  const performance = createThemePerformanceRecorder()
  const previewP95 = ref<number | null>(null)
  const report = computed(() =>
    workshopDiagnosticReport([
      ...bufferProblems.value,
      ...baseReport.value.diagnostics,
      ...visual.value
    ])
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  let epoch = 0
  let disposed = false
  const diagnosticModule = import('../../../../shared/themeWorkshopDiagnostics.ts')
  const decodeCache = new Map<string, Promise<WorkshopDiagnostic | null>>()
  // Keep full data URLs in the project model, never as cache keys. Large theme
  // assets would otherwise be retained a second time by this 128-entry cache.
  const decodeKeyCache = new WeakMap<WorkshopAsset, string>()

  function decodeKey(asset: WorkshopAsset): string {
    const cached = decodeKeyCache.get(asset)
    if (cached) return cached
    let first = 2166136261
    let second = 16777619
    let index = 0
    const feed = (code: number): void => {
      first = Math.imul(first ^ code, 16777619)
      second = Math.imul(second ^ (code + index), 2246822519)
      index += 1
    }
    for (let offset = 0; offset < asset.type.length; offset += 1)
      feed(asset.type.charCodeAt(offset))
    feed(0)
    for (let offset = 0; offset < asset.dataUrl.length; offset += 1)
      feed(asset.dataUrl.charCodeAt(offset))
    const key = `${asset.type}:${asset.dataUrl.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`
    decodeKeyCache.set(asset, key)
    return key
  }

  function decode(project: WorkshopProject): Promise<(WorkshopDiagnostic | null)[]> {
    return Promise.all(
      (project.assets ?? []).map((asset) => {
        const key = decodeKey(asset)
        const cached = decodeCache.get(key)
        if (cached)
          return cached.then(
            (item) =>
              item && {
                ...item,
                id: `asset.decode:${asset.id}`,
                message: asset.name + ' 无法解码，请替换素材',
                location: { kind: 'asset' as const, id: asset.id }
              }
          )
        const pending = new Promise<WorkshopDiagnostic | null>((resolve) => {
          let done = false
          let image: HTMLImageElement | null = null
          const finish = (invalid: boolean): void => {
            if (done) return
            done = true
            clearTimeout(timeout)
            if (image) {
              image.onload = null
              image.onerror = null
              image.src = ''
              image = null
            }
            resolve(
              invalid
                ? {
                    id: `asset.decode:${asset.id}`,
                    code: 'asset.decode',
                    severity: 'error',
                    message: `${asset.name} 无法解码，请替换素材`,
                    location: { kind: 'asset', id: asset.id }
                  }
                : null
            )
          }
          const timeout = setTimeout(() => finish(true), 5000)
          if (asset.type === 'image') {
            image = new Image()
            image.onload = () => finish(!image?.naturalWidth)
            image.onerror = () => finish(true)
            image.src = asset.dataUrl
          } else {
            const font = new FontFace('workshop-diagnostic', `url('${asset.dataUrl}')`)
            void font.load().then(
              () => finish(false),
              () => finish(true)
            )
          }
        })
        if (decodeCache.size >= 128) decodeCache.delete(decodeCache.keys().next().value!)
        decodeCache.set(key, pending)
        return pending
      })
    )
  }
  async function runtimeCheck(): Promise<void> {
    const version = generation.value
    const currentEpoch = epoch
    const current = project.value
    if (!current || !previewValid.value || checking.value) return
    const [items, assets] = await Promise.all([inspect(), decode(current)])
    if (disposed || version !== generation.value || currentEpoch !== epoch) return
    visual.value = [
      ...diagnoseWorkshopCssSupport(current.css, (property, value) =>
        CSS.supports(property, value)
      ),
      ...items,
      ...assets.filter((item): item is WorkshopDiagnostic => !!item)
    ]
  }
  const scheduler = createThemePreviewScheduler(async (snapshot: WorkshopProject) => {
    const version = generation.value
    const module = await diagnosticModule
    if (
      disposed ||
      generation.value !== version ||
      project.value?.id !== snapshot.id ||
      project.value?.base !== snapshot.base
    )
      return
    const start = performanceNow()
    const diagnostics = module.diagnoseWorkshopProject(snapshot)
    baseReport.value = diagnostics
    try {
      if (diagnostics.errors) {
        previewValid.value = false
        return
      }
      css.value = compileWorkshopProject(snapshot)
      validProject.value = snapshot
      previewValid.value = true
      const metric = performance.record('preview', performanceNow() - start)
      previewP95.value = metric.preview.p95Ms
    } catch (cause) {
      previewValid.value = false
      baseReport.value = workshopDiagnosticReport([
        ...diagnostics.diagnostics,
        {
          id: 'compile',
          severity: 'error',
          code: 'compile',
          message: cause instanceof Error ? cause.message : String(cause),
          location: { kind: 'project' }
        }
      ])
    }
    if (version === generation.value) {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void runtimeCheck()
      }, 250)
    }
  })
  function performanceNow(): number {
    return globalThis.performance.now()
  }
  function cancel(): void {
    epoch++
    checking.value = false
    scene.value = undefined
    stale.value = true
    progress.value = '完整检查未完成'
  }
  watch(
    [generation, candidate],
    () => {
      if (checking.value) cancel()
      epoch++
      visual.value = []
      stale.value = true
      clearTimeout(timer)
      if (project.value) scheduler.schedule(project.value)
      else {
        css.value = ''
        validProject.value = undefined
        baseReport.value = workshopDiagnosticReport([])
      }
    },
    { immediate: true }
  )
  async function fullCheck(): Promise<void> {
    await scheduler.flush()
    if (!project.value || !previewValid.value || report.value.errors) return
    const version = generation.value
    const request = ++epoch
    checking.value = true
    const scenes: WorkshopPreviewScene[] = []
    for (const surface of WORKSHOP_PREVIEW_SURFACES) {
      const states = [
        'normal',
        'empty',
        'done',
        'listening',
        ...(surface.id.startsWith('streaming') ? ['loading'] : []),
        ...(['library', 'streaming-list'].includes(surface.id) ? ['selected'] : [])
      ]
      for (const tone of ['pureWhite', 'dark'] as const)
        for (const width of [640, 760, 1180, 1600])
          for (const state of states) scenes.push({ tone, surface: surface.id, width, state })
    }
    const results: WorkshopDiagnostic[] = []
    try {
      const assets = await decode(project.value)
      for (const asset of assets) if (asset) results.push(asset)
      for (const [index, next] of scenes.entries()) {
        if (disposed || epoch !== request || generation.value !== version) return
        scene.value = next
        progress.value = `${index + 1}/${scenes.length} · ${WORKSHOP_PREVIEW_SURFACES.find((surface) => surface.id === next.surface)?.label} · ${next.tone === 'dark' ? '深色' : '浅色'} · ${next.width}px`
        await nextTick()
        const items = await inspect()
        if (disposed || epoch !== request || generation.value !== version) return
        for (const item of items)
          results.push({
            ...item,
            id: `${item.id}:${next.surface}:${next.tone}:${next.width}:${next.state}`,
            location: { ...item.location, ...next }
          })
      }
      visual.value = results
      stale.value = false
      progress.value = `已检查 ${scenes.length} 个场景`
    } finally {
      if (epoch === request) {
        checking.value = false
        scene.value = undefined
      }
    }
  }
  function scheduleRuntime(): void {
    if (checking.value) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void runtimeCheck()
    }, 250)
  }
  onBeforeUnmount(() => {
    disposed = true
    cancel()
    clearTimeout(timer)
    scheduler.cancel()
    decodeCache.clear()
  })
  return {
    css,
    validProject,
    previewValid,
    report,
    checking,
    progress,
    stale,
    scene,
    previewP95,
    bufferProblems,
    fullCheck,
    cancel,
    scheduleRuntime,
    flush: scheduler.flush
  }
}
