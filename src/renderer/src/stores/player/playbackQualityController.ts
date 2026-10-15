import type { Track } from '../../types/music'
import type { MediaProvider, MediaProviderPlaybackQuality } from '../../providers/mediaProvider.ts'
import { validatePlaybackQuality } from '../../providers/mediaProvider.ts'

export function createPlaybackQualityController(deps: {
  getTrack: () => Track | null
  getProvider: (track: Track) => MediaProvider | null
  captureOwner: (track: Track, provider: MediaProvider) => () => boolean
  canReload: () => boolean
  getPosition: () => number
  isPlaying: () => boolean
  reload: (track: Track, target: string, position: number, playing: boolean) => Promise<void>
}) {
  let revision = 0
  let pending: AbortController | undefined

  async function changeQuality(
    quality: string,
    options?: { signal?: AbortSignal }
  ): Promise<MediaProviderPlaybackQuality> {
    const track = deps.getTrack()
    const provider = track && deps.getProvider(track)
    if (
      !track ||
      !provider?.getPlaybackQuality ||
      !provider.setPlaybackQuality ||
      !provider.getPlaybackUrl ||
      !deps.canReload()
    ) {
      throw new Error('当前播放状态不支持切换音质')
    }
    if (options?.signal?.aborted) throw new Error('音质切换已取消')
    const request = ++revision
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    const onAbort = (): void => controller.abort()
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    const callOptions = { signal: controller.signal }
    const ownsSelection = deps.captureOwner(track, provider)
    const isCurrent = (): boolean =>
      !controller.signal.aborted && request === revision && ownsSelection() && deps.canReload()
    try {
      if (!isCurrent()) throw new Error('音质切换已取消')
      const state = validatePlaybackQuality(await provider.setPlaybackQuality(quality, callOptions))
      if (!isCurrent()) return state

      // Acquire this track while the existing stream keeps playing. The provider
      // owns any same-track downgrade without rewriting the saved preference.
      const target = await provider.getPlaybackUrl(
        { ...track },
        { quality: state.quality, force: true },
        callOptions
      )
      if (!isCurrent()) return state
      if (!target) throw new Error('音质已保存，但当前歌曲无法使用所选音质，现有播放继续保留')
      await deps.reload({ ...track }, target, deps.getPosition(), deps.isPlaying())
      return state
    } finally {
      options?.signal?.removeEventListener('abort', onAbort)
      if (pending === controller) pending = undefined
    }
  }

  return { changeQuality }
}
