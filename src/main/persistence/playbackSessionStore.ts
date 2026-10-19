import { app } from 'electron'
import { join } from 'path'
import type { PlaybackSession } from '../core/types.ts'
import { VersionedDataStore } from './versionedDataStore.ts'
import { isPlaybackQueueSnapshot, PlaybackSessionStorage } from './playbackSessionStorage.ts'
import { isPlaybackSession } from '../../shared/playbackSession.ts'
import { reportPersistentDataRecovery } from '../ipc/persistenceReporting.ts'

export const MAX_PLAYBACK_SESSION_BYTES = 2 * 1024 * 1024
export const MAX_PLAYBACK_QUEUE_BYTES = 32 * 1024 * 1024

export interface PlaybackSessionStoreBundle {
  sessionFile: string
  queueFile: string
  sessionStore: VersionedDataStore<PlaybackSession | null>
  queueStore: VersionedDataStore<unknown[]>
  storage: PlaybackSessionStorage
}

let bundle: PlaybackSessionStoreBundle | null = null

/**
 * The playback session is shared by the persistence IPC and by the Afterglow
 * supervisor, which keeps writing the current track while no renderer exists.
 * Resolve the userData paths lazily so `app.setName` has already run.
 */
export function getPlaybackSessionStoreBundle(): PlaybackSessionStoreBundle {
  if (bundle) return bundle
  const userDataPath = app.getPath('userData')
  const sessionFile = join(userDataPath, 'playback-session.json')
  const queueFile = join(userDataPath, 'playback-queue.json')
  const sessionStore = new VersionedDataStore<PlaybackSession | null>({
    filePath: sessionFile,
    label: 'playback session',
    maxBytes: MAX_PLAYBACK_SESSION_BYTES,
    isData: (value): value is PlaybackSession | null =>
      value === null || isPlaybackSessionFile(value),
    isLegacy: isPlaybackSessionFile,
    onRecovery: (result) => reportPersistentDataRecovery('Playback session', sessionFile, result)
  })
  const queueStore = new VersionedDataStore<unknown[]>({
    filePath: queueFile,
    label: 'playback queue',
    maxBytes: MAX_PLAYBACK_QUEUE_BYTES,
    isData: isPlaybackQueueSnapshot,
    isLegacy: isPlaybackQueueSnapshot,
    onRecovery: (result) => reportPersistentDataRecovery('Playback queue', queueFile, result)
  })
  bundle = {
    sessionFile,
    queueFile,
    sessionStore,
    queueStore,
    storage: new PlaybackSessionStorage(sessionStore, queueStore)
  }
  return bundle
}

function isPlaybackSessionFile(value: unknown): value is PlaybackSession {
  return isPlaybackSession(value)
}
