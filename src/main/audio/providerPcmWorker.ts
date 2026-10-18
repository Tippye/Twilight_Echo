import { existsSync } from 'node:fs'
import type { AudioEngineQueueItem } from '../../shared/audioEngineTypes.ts'
import {
  providerPlaybackIdentities,
  type ProviderPlaybackIdentityRegistry
} from './providerPlaybackIdentity.ts'

/** Executable selection stays in main; provider/renderer supply no path or args. */
export function bindProviderPcmWorker(
  item: AudioEngineQueueItem,
  authorizedSource: string,
  options: {
    workerPath: string
    identities?: ProviderPlaybackIdentityRegistry
    now?: () => number
    exists?: (path: string) => boolean
    platform?: string
  }
): AudioEngineQueueItem {
  const result = { ...item }
  delete result.pcmWorkerExecutable
  delete result.pcmWorkerExpiresAt
  delete result.sourceEffect
  const identity = (options.identities ?? providerPlaybackIdentities).get(authorizedSource)
  if (!identity?.effect) return result
  if (
    identity.effect !== 'qq-excellent' ||
    identity.providerId !== 'qq' ||
    identity.pluginId !== 'com.twilightecho.provider.qqmusic' ||
    !identity.nativePcmAuthorized ||
    !['flac', '320', '128'].includes(identity.actualQuality ?? '') ||
    (options.platform ?? process.platform) !== 'win32'
  ) {
    throw new Error('当前音源未授权使用此 PCM 音效')
  }
  const now = (options.now ?? Date.now)()
  if (
    !identity.expiresAt ||
    identity.expiresAt <= now ||
    identity.expiresAt - now > 6 * 60 * 60 * 1000 ||
    !(options.exists ?? existsSync)(options.workerPath)
  ) {
    throw new Error('臻品音效处理组件不可用或音源授权已过期')
  }
  return {
    ...result,
    pcmWorkerExecutable: options.workerPath,
    pcmWorkerExpiresAt: identity.expiresAt,
    sourceEffect: '臻品音质（本地音效）'
  }
}
