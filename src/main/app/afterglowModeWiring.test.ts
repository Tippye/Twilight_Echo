import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = async (relative: string): Promise<string> =>
  await readFile(new URL(relative, import.meta.url), 'utf8')

test('lifecycle keeps the app alive without windows and shuts the mode down', async () => {
  const source = await read('./lifecycle.ts')
  assert.match(
    source,
    /app\.on\('window-all-closed',[\s\S]*?if \(isAfterglowModeActive\(\)\) return[\s\S]*?app\.quit\(\)/
  )
  assert.match(source, /app\.on\('will-quit',[\s\S]*?shutdownAfterglowMode\(\)/)
  assert.match(
    source,
    /app\.on\('second-instance',[\s\S]*?isAfterglowModeActive\(\)[\s\S]*?restoreAfterglowMode\(\)/
  )
  assert.match(
    source,
    /app\.on\('activate',[\s\S]*?isAfterglowModeActive\(\)[\s\S]*?restoreAfterglowMode\(\)/
  )
})

test('window teardown marks Afterglow unloads and the recreated window carries the flag', async () => {
  const source = await read('./window.ts')
  assert.match(
    source,
    /if \(afterglowUnloading\) \{[\s\S]*?afterglowUnloading = false[\s\S]*?\} else \{[\s\S]*?destroyWindowsSmtc\(\)/
  )
  assert.match(source, /export function setMainWindowAfterglowUnloading/)
  assert.match(source, /afterglowRendererRestoreQueryKey/)
  assert.match(source, /loadFile\([\s\S]*?\[afterglowRendererRestoreQueryKey\]: '1'/)
  assert.match(source, /on\('minimize',[\s\S]*?handleMainWindowMinimized\(\)/)
  assert.match(source, /handleMainWindowHidden\(\)/)
})

test('renderer restore adopts live engine state without reloading the queue', async () => {
  const source = await read('../../renderer/src/stores/usePlayerStore.ts')
  const start = source.indexOf('function adoptAfterglowRestore')
  assert.notEqual(start, -1)
  const end = source.indexOf('return {', start)
  assert.notEqual(end, -1)
  const body = source.slice(start, end)

  assert.doesNotMatch(body, /loadQueue\(/, 'adoption must not reload the native queue')
  assert.doesNotMatch(body, /audioEngine\.play\(|api\.play\(/, 'adoption must not restart playback')
  assert.match(body, /restoredPlaybackPending = false/)
  assert.match(body, /nativePlaybackActive = true/)
  assert.match(body, /nativeQueueLoader\.adopt/)
  assert.match(body, /adoptedAfterglowRestore = true/)

  const appSource = await read('../../renderer/src/App.vue')
  assert.match(appSource, /isAfterglowRendererRestore\(window\.location\.search\)/)
  assert.match(appSource, /adoptAfterglowRestore\(afterglowRestoreState\)/)
  assert.match(appSource, /rendererAdoptComplete\(\)/)
  assert.match(appSource, /options\?\.includeQueue[\s\S]*?savePlaybackSessionWithQueue\(\)/)
})

test('renderer-free control plane is serialized and reads live engine state', async () => {
  const source = await read('./rendererFreePlayback.ts')
  assert.match(source, /let transportLane: Promise<unknown> = Promise\.resolve\(\)/)
  assert.match(source, /enqueueTransport/)
  assert.match(source, /stopActiveOutputTest\(\)/)
  assert.match(source, /scheduleSoftwareVolumePersist\(/)
  assert.match(source, /getPlaybackInfo\(\)/)
  assert.match(source, /resolveAuthorizedAudioSource\(/)
})

test('tray, media keys and SMTC route through the renderer-free dispatcher', async () => {
  const tray = await read('../integrations/shortcutsTray.ts')
  assert.match(tray, /if \(isAfterglowModeActive\(\)\)[\s\S]*?dispatchAfterglowTransport/)
  assert.match(tray, /恢复界面/)
  assert.match(tray, /restoreAfterglowMode\(\)/)
  assert.match(tray, /进入余晖模式/)
  assert.match(tray, /Notification\.isSupported\(\)/)

  const smtc = await read('../integrations/windowsSmtc.ts')
  assert.match(smtc, /export function rebindWindowsSmtc/)
  assert.match(smtc, /routeRendererFreeCommand/)
  assert.match(smtc, /isAfterglowModeActive\(\)/)
})

test('the LAN remote and Discord keep working while the renderer is unloaded', async () => {
  const snapshot = await read('./afterglowSnapshot.ts')
  assert.match(snapshot, /publishRemotePlaybackSnapshot\?\./)
  assert.match(snapshot, /updateDiscordActivity\(/)
  assert.match(snapshot, /resolveRemoteCoverDataUrl/)
  assert.match(snapshot, /readCoverCacheFileBytes\(/)
  assert.match(snapshot, /engineState === 'stopped'/)

  const remote = await read('../remote/remoteIpc.ts')
  assert.match(remote, /isAfterglowModeActive\(\)[\s\S]*?dispatchAfterglowTransport/)
  assert.match(remote, /export function publishRemotePlaybackSnapshot/)
  assert.match(remote, /runtime\.publishRemotePlaybackSnapshot = publishRemotePlaybackSnapshot/)
  assert.match(remote, /case 'setPlayMode'[\s\S]*?dispatchAfterglowTransport/)

  const runtime = await read('../core/runtime.ts')
  assert.match(runtime, /publishRemotePlaybackSnapshot/)
})

test('the service rejects unloadable playback and keeps a restore escape hatch', async () => {
  const source = await read('./AfterglowModeService.ts')
  for (const reason of [
    'afterglow_requires_native_engine',
    'afterglow_requires_active_playback',
    'afterglow_requires_renderer_snapshot',
    'afterglow_requires_fully_local_queue',
    'afterglow_requires_fully_delegated_queue',
    'afterglow_requires_mappable_current_track',
    'afterglow_restore_shortcut_unavailable',
    'afterglow_renderer_flush_failed'
  ]) {
    assert.match(source, new RegExp(reason), `missing rejection reason: ${reason}`)
  }
  // Playback-resume is a user preference, not a prerequisite for unloading.
  assert.doesNotMatch(source, /playbackResumeMode === 'off'/)
  // Restore failures return to `active` so the tray/shortcut can try again.
  const failRestore = source.slice(source.indexOf('private failWindowRestore'))
  assert.match(failRestore, /this\.phase = 'active'/)
  assert.match(failRestore, /registerRestoreShortcut\(\)/)
})

test('the renderer hands its queue to main without touching playback-session.json', async () => {
  const app = await read('../../renderer/src/App.vue')
  assert.match(app, /publishRendererSnapshot\(\{/)
  assert.match(app, /queue: toPlainSnapshot\(queue\.value\)/)
  assert.match(app, /track: toPlainSnapshot\(track\)/)
  // Disk persistence must never run before the memory handoff, otherwise a
  // locked playback-session store reproduces "保存播放状态失败".
  const saveHandler = app.slice(app.indexOf('onSavePlaybackSession'))
  const handoff = saveHandler.slice(0, saveHandler.indexOf('savePlaybackSessionWithQueue'))
  assert.match(handoff, /publishRendererSnapshot/)
  assert.match(handoff, /toPlainSnapshot/)
  assert.match(handoff, /JSON\.parse\(JSON\.stringify/)
  assert.match(saveHandler, /non-fatal/)

  const ipc = await read('../ipc/afterglowModeIpc.ts')
  assert.match(ipc, /app:afterglow:publishRendererSnapshot/)
  assert.match(ipc, /publishAfterglowRendererSnapshot\(payload\)/)

  // Online queues are a window; the handoff carries the native→logical map.
  assert.match(app, /nativeQueueIndices/)
  const service = await read('./AfterglowModeService.ts')
  assert.match(service, /resolveAfterglowEngineMapping/)
  assert.match(service, /windowedQueue/)
  assert.match(service, /bindWindowedAutoRestore/)
  assert.match(service, /AFTERGLOW_WINDOWED_AUTO_RESTORE_DELAY_MS/)
  assert.match(service, /afterglow_requires_mappable_current_track/)
  // Queue-end/error restore is not limited to windowed queues, and the online
  // core starts for full queues too (so upcoming URLs can still be refreshed).
  assert.match(service, /this\.bindWindowedAutoRestore\(\)\n/)
  assert.match(service, /queue-core\.start/)
  assert.match(service, /queue-core\.capability/)
  // Route C: windowed queues extend through the native hot-update core.
  assert.match(service, /AfterglowQueueCore/)
  assert.match(service, /createAfterglowSourceResolver/)
  assert.match(service, /getQueueHotUpdateCapability/)
  assert.match(service, /onMappingChanged/)
  // A successful memory handoff survives a failed/blocked disk persistence.
  assert.match(
    service,
    /if \(!this\.rendererSnapshot\) return this\.fail\('afterglow_renderer_flush_failed'\)/
  )
  const sessionSource = await read('./playbackSessionService.ts')
  assert.match(sessionSource, /continuing in memory/)
  const core = await read('./afterglowQueueCore.ts')
  assert.match(core, /appendQueueItems/)
  assert.match(core, /updateQueueItemSource/)
  assert.match(core, /getMapping\(\)/)
  assert.doesNotMatch(core, /loadQueue\s*\(/)
  const resolver = await read('./afterglowSourceResolver.ts')
  assert.match(resolver, /getPlaybackUrl/)
  assert.match(resolver, /isAfterglowPlayableSource/)
  const snapshot = await read('./afterglowSnapshot.ts')
  assert.match(snapshot, /nativeQueueIndices: \[\.\.\.mapping\]/)
  assert.match(snapshot, /setAfterglowEngineMapping/)

  const session = await read('./playbackSessionService.ts')
  assert.match(session, /memoryOnly/)
  assert.match(session, /adoptRendererSnapshot/)
  assert.match(session, /playbackResumeMode === 'off'/)
  assert.match(session, /if \(this\.memoryOnly\) return/)
  assert.match(session, /logicalIndex/)
})
