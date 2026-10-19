export const SHORTCUT_IDS = [
  'closeWindow',
  'commandPalette',
  'playbackSpace',
  'volumeUp',
  'volumeDown',
  'previous',
  'next',
  'playPause',
  'toggleDesktopLyrics',
  'toggleDesktopLyricsLock',
  'MediaPreviousTrack',
  'MediaNextTrack',
  'MediaPlayPause',
  'MediaStop'
] as const

export type ShortcutId = (typeof SHORTCUT_IDS)[number]
export type ShortcutEnabledSettings = Partial<Record<ShortcutId, boolean>>

// Missing entries stay enabled so existing installations retain their shortcuts.
export function normalizeShortcutEnabled(raw: unknown): ShortcutEnabledSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return Object.fromEntries(
    SHORTCUT_IDS.filter((id) => value[id] === false).map((id) => [id, false])
  )
}

export const LOCAL_SHORTCUTS = [
  { id: 'closeWindow', accelerator: 'CommandOrControl+W', label: '关闭窗口' },
  { id: 'commandPalette', accelerator: 'CommandOrControl+K', label: '命令面板' },
  { id: 'playbackSpace', accelerator: 'Space', label: '播放 / 暂停' }
] as const

export function isCloseWindowAccelerator(accelerator: string): boolean {
  return /^(commandorcontrol|cmdorctrl|control|ctrl|command|cmd|meta|super)\+w$/i.test(
    accelerator.trim()
  )
}
