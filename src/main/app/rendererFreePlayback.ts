import type { PlayMode } from '../../shared/audioEngineTypes.ts'
import {
  afterglowTrackPathOf,
  isAfterglowPlayableSource,
  type AfterglowTransportCommand
} from '../../shared/afterglowMode.ts'
import type { AudioEngineManager } from '../audioEngineManager.ts'
import {
  ensureAudioEngineRuntime,
  scheduleSoftwareVolumePersist,
  stopActiveOutputTest
} from '../audio/engineIpc.ts'
import { resolveAuthorizedAudioSource } from '../security/localPaths.ts'
import { playbackSessionService } from './playbackSessionService.ts'

const NATIVE_CYCLE: PlayMode[] = ['sequential', 'listLoop', 'repeat']

let transportLane: Promise<unknown> = Promise.resolve()

const enqueueTransport = <T>(operation: () => Promise<T>): Promise<T> => {
  const run = transportLane.then(operation, operation)
  transportLane = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const resumeCurrentQueueItem = async (
  engine: AudioEngineManager,
  info: { queueIndex: number; position: number; duration: number; source?: string }
): Promise<void> => {
  const session = playbackSessionService.getCachedSession()
  const queue = playbackSessionService.getCachedQueue()
  const queueIndex =
    info.queueIndex >= 0 && info.queueIndex < queue.length
      ? info.queueIndex
      : (session?.queueIndex ?? -1)
  const path = afterglowTrackPathOf(queue[queueIndex])
  // Online queue entries expose `ncm:…` as filePath and are not a playable
  // source. The engine's last authorized source is the only valid resume target
  // once the renderer is gone; local tracks still go through path authorization.
  const source =
    info.source && isAfterglowPlayableSource(info.source)
      ? info.source
      : path
        ? await resolveAuthorizedAudioSource(path)
        : ''
  if (!source) throw new Error('afterglow_no_resumable_track')
  const insideTrack =
    Number.isFinite(info.position) && info.position > 0 && info.position < info.duration
  await engine.play(source, insideTrack ? info.position : 0)
}

/**
 * Transport commands executed by the main process while no renderer exists.
 * Serialized like the IPC handlers so rapid tray/media-key input cannot
 * interleave two `play` requests.
 */
export function dispatchRendererFreeTransport(command: AfterglowTransportCommand): Promise<void> {
  return enqueueTransport(async () => {
    const engine = await ensureAudioEngineRuntime()
    await stopActiveOutputTest()
    const info = await engine.getPlaybackInfo()

    switch (command.type) {
      case 'play':
        if (info.state === 'playing') return
        if (info.state === 'paused') {
          await engine.togglePause()
          return
        }
        await resumeCurrentQueueItem(engine, info)
        return
      case 'pause':
        if (info.state === 'playing') await engine.togglePause()
        return
      case 'toggle-play':
        if (info.state === 'playing' || info.state === 'paused') {
          await engine.togglePause()
          return
        }
        await resumeCurrentQueueItem(engine, info)
        return
      case 'stop':
        await engine.stop()
        return
      case 'next':
        await engine.next()
        return
      case 'previous':
        await engine.previous()
        return
      case 'seek':
        await engine.seek(Math.max(0, command.positionSeconds || 0))
        return
      case 'seek-by':
        await engine.seek(Math.max(0, (info.position || 0) + command.deltaSeconds))
        return
      case 'set-volume': {
        const volume = clamp(command.volume, 0, 1, info.volume)
        await engine.setVolume(volume)
        scheduleSoftwareVolumePersist(volume)
        return
      }
      case 'volume-step': {
        const volume = clamp((info.volume ?? 1) + command.delta, 0, 1, info.volume ?? 1)
        await engine.setVolume(volume)
        scheduleSoftwareVolumePersist(volume)
        return
      }
      case 'toggle-mute': {
        const volume = (info.volume ?? 1) > 0 ? 0 : 1
        await engine.setVolume(volume)
        scheduleSoftwareVolumePersist(volume)
        return
      }
      case 'set-playback-rate':
        await engine.setPlaybackRate(clamp(command.playbackRate, 0.5, 2, info.playbackRate ?? 1))
        return
      case 'rate-step':
        await engine.setPlaybackRate(
          clamp((info.playbackRate ?? 1) + command.delta, 0.5, 2, info.playbackRate ?? 1)
        )
        return
      case 'set-play-mode':
        await engine.setPlayMode(command.mode)
        return
      case 'cycle-play-mode': {
        const index = NATIVE_CYCLE.indexOf(info.playMode)
        const next = NATIVE_CYCLE[(index + 1) % NATIVE_CYCLE.length] ?? 'sequential'
        await engine.setPlayMode(next)
        return
      }
    }
  })
}

/** Play modes the renderer-free tray cycle can offer while unloaded. */
export const rendererFreePlayModes = (): readonly PlayMode[] => NATIVE_CYCLE
