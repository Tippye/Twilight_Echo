import type { Track } from '../../types/music'
import type { MediaProvider, MediaProviderPlaybackQuality } from '../../providers/mediaProvider.ts'

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

  async function changeQuality(quality: string): Promise<MediaProviderPlaybackQuality> {
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
    const request = ++revision
    const ownsSelection = deps.captureOwner(track, provider)
    const isCurrent = (): boolean => request === revision && ownsSelection() && deps.canReload()
    const state = await provider.setPlaybackQuality(quality)
    if (!isCurrent()) return state

    // Acquire the requested quality while the existing stream keeps playing.
    // The provider remains the only authority for preference and availability.
    const target = await provider.getPlaybackUrl(
      { ...track },
      { quality: state.quality, force: true }
    )
    if (!isCurrent()) return state
    if (!target) throw new Error('音质已保存，但当前歌曲无法使用所选音质，现有播放继续保留')
    await deps.reload({ ...track }, target, deps.getPosition(), deps.isPlaying())
    return state
  }

  return { changeQuality }
}
