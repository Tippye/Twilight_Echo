import { diagnosticsApi } from './diagnostics.ts'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  MiniPlayerBootstrap,
  MiniPlayerCommand,
  MiniPlayerSettings,
  MiniPlayerSettingsPatch,
  MiniPlayerStateSnapshot,
  DynamicIslandBootstrap,
  DynamicIslandLyricsPayload,
  DynamicIslandPresentation,
  TrayNavigationTarget,
  TrayPlayerBootstrap,
  MotionPreference
} from './types'
import type { ExperienceWindowOptions, ExperienceWindowTheme } from '../shared/experienceWindow.ts'
import { createSleepTimerEventBridge } from './sleepTimerEvents.ts'
import { dataApi, miniPlayerCoverDataApi } from './domains/dataApi.ts'
import { audioEngineApi, bindAudioEngineIpcEvents } from './domains/audioEngineApi.ts'
import {
  bindDesktopLyricsIpcEvents,
  desktopLyricsHostApi,
  desktopLyricsWindowApi
} from './domains/desktopLyricsApi.ts'
import { libraryAndFileSystemApi } from './domains/libraryApi.ts'
import { mediaSubscriptionsApi } from './domains/mediaSubscriptionsApi.ts'
import { networkSourcesApi } from './domains/networkSourcesApi.ts'
import { bindSettingsIpcEvents, settingsApi } from './domains/settingsApi.ts'
import { bindThemesIpcEvents, themesApi } from './domains/themesApi.ts'
import { themeWorkshopApi } from './domains/themeWorkshopApi.ts'
import { bindPluginsIpcEvents, pluginsApi } from './domains/pluginsApi.ts'
import { bindSystemIpcEvents, systemApi } from './domains/systemApi.ts'

const miniPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const miniPlayerSettingsCallbacks = new Set<(settings: MiniPlayerSettings) => void>()
const miniPlayerMotionPreferenceCallbacks = new Set<(preference: MotionPreference) => void>()
const miniPlayerCommandCallbacks = new Set<(command: MiniPlayerCommand) => void>()
const trayPlayerStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const dynamicIslandStateCallbacks = new Set<(state: MiniPlayerStateSnapshot) => void>()
const dynamicIslandLyricsCallbacks = new Set<(payload: DynamicIslandLyricsPayload) => void>()
const dynamicIslandExpandedCallbacks = new Set<(expanded: boolean) => void>()
const dynamicIslandConfigCallbacks = new Set<(presentation: DynamicIslandPresentation) => void>()
const experienceWindowThemeCallbacks = new Set<(theme: ExperienceWindowTheme) => void>()
let latestExperienceWindowTheme: ExperienceWindowTheme | undefined
const sleepTimerEvents = createSleepTimerEventBridge()

bindSettingsIpcEvents()
bindPluginsIpcEvents()
bindSystemIpcEvents()
bindAudioEngineIpcEvents()
bindDesktopLyricsIpcEvents()
bindThemesIpcEvents()

sleepTimerEvents.bind(ipcRenderer)
ipcRenderer.on('miniPlayer:state', (_event, state: MiniPlayerStateSnapshot) => {
  for (const cb of miniPlayerStateCallbacks) cb(state)
})

ipcRenderer.on('miniPlayer:settings', (_event, settings: MiniPlayerSettings) => {
  for (const cb of miniPlayerSettingsCallbacks) cb(settings)
})

ipcRenderer.on('miniPlayer:motionPreference', (_event, preference: MotionPreference) => {
  for (const cb of miniPlayerMotionPreferenceCallbacks) cb(preference)
})

ipcRenderer.on('miniPlayer:command', (_event, command: MiniPlayerCommand) => {
  for (const cb of miniPlayerCommandCallbacks) cb(command)
})

ipcRenderer.on('trayPlayer:state', (_event, state: MiniPlayerStateSnapshot) => {
  for (const cb of trayPlayerStateCallbacks) cb(state)
})

ipcRenderer.on('dynamicIsland:state', (_event, state: MiniPlayerStateSnapshot) => {
  for (const cb of dynamicIslandStateCallbacks) cb(state)
})

ipcRenderer.on('dynamicIsland:expanded', (_event, value: boolean) => {
  for (const cb of dynamicIslandExpandedCallbacks) cb(value)
})

ipcRenderer.on('dynamicIsland:config', (_event, presentation: DynamicIslandPresentation) => {
  for (const cb of dynamicIslandConfigCallbacks) cb(presentation)
})

ipcRenderer.on('dynamicIsland:lyrics', (_event, payload: DynamicIslandLyricsPayload) => {
  for (const cb of dynamicIslandLyricsCallbacks) cb(payload)
})

ipcRenderer.on('experience:windowTheme', (_event, theme: ExperienceWindowTheme) => {
  latestExperienceWindowTheme = theme
  for (const cb of experienceWindowThemeCallbacks) cb(theme)
})

const miniPlayerWindowApi = {
  getBootstrap: (): Promise<MiniPlayerBootstrap> => ipcRenderer.invoke('miniPlayer:getBootstrap'),
  command: (command: MiniPlayerCommand): void => {
    ipcRenderer.send('miniPlayer:command', command)
  },
  updateSettings: (patch: MiniPlayerSettingsPatch): Promise<MiniPlayerSettings> =>
    ipcRenderer.invoke('miniPlayer:updateSettings', patch),
  chooseBackgroundImage: (): Promise<string | null> =>
    ipcRenderer.invoke('miniPlayer:chooseBackgroundImage'),
  minimize: (): void => {
    ipcRenderer.send('miniPlayer:minimize')
  },
  returnToMain: (): void => {
    ipcRenderer.send('miniPlayer:returnToMain')
  },
  moveTo: (x: number, y: number): void => {
    ipcRenderer.send('miniPlayer:moveTo', { x, y })
  },
  moveEnd: (): void => {
    ipcRenderer.send('miniPlayer:moveEnd')
  },
  onState: (cb: (state: MiniPlayerStateSnapshot) => void): (() => void) => {
    miniPlayerStateCallbacks.add(cb)
    return () => miniPlayerStateCallbacks.delete(cb)
  },
  onSettings: (cb: (settings: MiniPlayerSettings) => void): (() => void) => {
    miniPlayerSettingsCallbacks.add(cb)
    return () => miniPlayerSettingsCallbacks.delete(cb)
  },
  onMotionPreference: (cb: (preference: MotionPreference) => void): (() => void) => {
    miniPlayerMotionPreferenceCallbacks.add(cb)
    return () => miniPlayerMotionPreferenceCallbacks.delete(cb)
  }
}

const miniPlayerHostApi = {
  ...miniPlayerWindowApi,
  open: (options?: ExperienceWindowOptions): Promise<MiniPlayerSettings> =>
    ipcRenderer.invoke('miniPlayer:open', options),
  publishState: (state: MiniPlayerStateSnapshot): void => {
    ipcRenderer.send('miniPlayer:publishState', state)
  },
  /** Island-only lyric channel; keeps lyric payloads out of the shared snapshot. */
  publishLyrics: (payload: DynamicIslandLyricsPayload): void => {
    ipcRenderer.send('miniPlayer:publishLyrics', payload)
  },
  onCommand: (cb: (command: MiniPlayerCommand) => void): (() => void) => {
    miniPlayerCommandCallbacks.add(cb)
    return () => miniPlayerCommandCallbacks.delete(cb)
  }
}

const experienceWindowApi = {
  onTheme: (cb: (theme: ExperienceWindowTheme) => void): (() => void) => {
    experienceWindowThemeCallbacks.add(cb)
    if (latestExperienceWindowTheme) cb(latestExperienceWindowTheme)
    return () => experienceWindowThemeCallbacks.delete(cb)
  }
}

const trayPlayerWindowApi = {
  onMotionPreference: (cb: (preference: MotionPreference) => void): (() => void) =>
    settingsApi.onChanged((snapshot) => cb(snapshot.settings.motionPreference)),
  getBootstrap: (): Promise<TrayPlayerBootstrap> => ipcRenderer.invoke('trayPlayer:getBootstrap'),
  command: (command: MiniPlayerCommand): void => {
    ipcRenderer.send('trayPlayer:command', command)
  },
  navigate: (target: TrayNavigationTarget): void => {
    ipcRenderer.send('trayPlayer:navigate', target)
  },
  hide: (): void => {
    ipcRenderer.send('trayPlayer:hide')
  },
  onState: (cb: (state: MiniPlayerStateSnapshot) => void): (() => void) => {
    trayPlayerStateCallbacks.add(cb)
    return () => trayPlayerStateCallbacks.delete(cb)
  }
}

const dynamicIslandWindowApi = {
  getBootstrap: (): Promise<DynamicIslandBootstrap> =>
    ipcRenderer.invoke('dynamicIsland:getBootstrap'),
  command: (command: MiniPlayerCommand): void => {
    ipcRenderer.send('dynamicIsland:command', command)
  },
  getVisualizationData: audioEngineApi.audioEngine.getVisualizationData,
  setExpanded: (expanded: boolean): Promise<boolean> =>
    ipcRenderer.invoke('dynamicIsland:setExpanded', expanded),
  onState: (cb: (state: MiniPlayerStateSnapshot) => void): (() => void) => {
    dynamicIslandStateCallbacks.add(cb)
    return () => dynamicIslandStateCallbacks.delete(cb)
  },
  onExpanded: (cb: (expanded: boolean) => void): (() => void) => {
    dynamicIslandExpandedCallbacks.add(cb)
    return () => dynamicIslandExpandedCallbacks.delete(cb)
  },
  onConfig: (cb: (presentation: DynamicIslandPresentation) => void): (() => void) => {
    dynamicIslandConfigCallbacks.add(cb)
    return () => dynamicIslandConfigCallbacks.delete(cb)
  },
  onLyrics: (cb: (payload: DynamicIslandLyricsPayload) => void): (() => void) => {
    dynamicIslandLyricsCallbacks.add(cb)
    return () => dynamicIslandLyricsCallbacks.delete(cb)
  }
}

const api = {
  diagnostics: diagnosticsApi,
  sleepTimer: {
    configure: (state: import('../shared/sleepTimer.ts').SleepTimerState) =>
      ipcRenderer.invoke('sleepTimer:configure', state),
    cancel: () => ipcRenderer.invoke('sleepTimer:cancel'),
    getState: () => ipcRenderer.invoke('sleepTimer:getState'),
    boundary: (boundary: 'trackEnd' | 'queueEnd') =>
      ipcRenderer.invoke('sleepTimer:boundary', boundary),
    onState: sleepTimerEvents.onState,
    onTrigger: sleepTimerEvents.onTrigger
  },
  ...libraryAndFileSystemApi,
  ...audioEngineApi,
  ...mediaSubscriptionsApi,
  ...networkSourcesApi,
  data: dataApi,
  settings: settingsApi,
  ...systemApi,
  themes: themesApi,
  themeWorkshop: themeWorkshopApi,
  ...pluginsApi,
  desktopLyrics: desktopLyricsHostApi,
  miniPlayer: miniPlayerHostApi,
  trayPlayer: trayPlayerWindowApi,
  window: {
    ...systemApi.window,
    showTrayPlayer: (options?: ExperienceWindowOptions) =>
      ipcRenderer.invoke('window:showTrayPlayer', options)
  },
  experienceWindow: experienceWindowApi
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', exposedApiForDocument())
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = exposedApiForDocument()
}

function exposedApiForDocument():
  | typeof api
  | {
      diagnostics: typeof diagnosticsApi
      desktopLyrics: typeof desktopLyricsWindowApi
      experienceWindow: typeof experienceWindowApi
    }
  | {
      diagnostics: typeof diagnosticsApi
      miniPlayer: typeof miniPlayerWindowApi
      data: typeof miniPlayerCoverDataApi
      experienceWindow: typeof experienceWindowApi
    }
  | {
      diagnostics: typeof diagnosticsApi
      trayPlayer: typeof trayPlayerWindowApi
      experienceWindow: typeof experienceWindowApi
    }
  | { dynamicIsland: typeof dynamicIslandWindowApi; data: typeof miniPlayerCoverDataApi } {
  if (isDesktopLyricsDocument())
    return {
      diagnostics: diagnosticsApi,
      desktopLyrics: desktopLyricsWindowApi,
      experienceWindow: experienceWindowApi
    }
  if (isMiniPlayerDocument()) {
    return {
      diagnostics: diagnosticsApi,
      miniPlayer: miniPlayerWindowApi,
      data: miniPlayerCoverDataApi,
      experienceWindow: experienceWindowApi
    }
  }
  if (isTrayPlayerDocument())
    return {
      diagnostics: diagnosticsApi,
      trayPlayer: trayPlayerWindowApi,
      experienceWindow: experienceWindowApi
    }
  if (isDynamicIslandDocument()) {
    return { dynamicIsland: dynamicIslandWindowApi, data: miniPlayerCoverDataApi }
  }
  return api
}

function isDesktopLyricsDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'desktop-lyrics'
  } catch {
    return false
  }
}

function isMiniPlayerDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'mini-player'
  } catch {
    return false
  }
}

function isTrayPlayerDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'tray-player'
  } catch {
    return false
  }
}

function isDynamicIslandDocument(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'dynamic-island'
  } catch {
    return false
  }
}
