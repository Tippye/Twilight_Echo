import { ipcMain } from 'electron'
import { registerPersonalBackupIpc } from './personalBackupIpc.ts'
import { sleepTimerService } from '../sleepTimer.ts'
import { assertTrustedIpcSender } from '../security/electronSecurity.ts'
import { registerWindowIpc } from './windowIpc.ts'
import { registerShellIpc } from './shellIpc.ts'
import { registerDiscordIpc } from './discordIpc.ts'
import { registerAppIpc } from './appIpc.ts'
import { registerFontsIpc } from './fonts.ts'
import { registerSettingsIpc } from './settingsIpc.ts'
import { registerFilesystemIpc } from './filesystemIpc.ts'
import { registerLibraryIpc } from './libraryIpc.ts'
import { registerCoverIpc } from './coverIpc.ts'
import { registerLyricsIpc } from './lyricsIpc.ts'
import { registerPersistenceIpc } from './persistenceIpc.ts'
import { registerSleepTimerIpc } from './sleepTimerIpc.ts'
import { registerAfterglowModeIpc } from './afterglowModeIpc.ts'

export function setupDataIpc(): void {
  registerPersonalBackupIpc(ipcMain)
  registerWindowIpc(ipcMain)
  registerShellIpc(ipcMain)
  registerDiscordIpc(ipcMain)
  registerAppIpc(ipcMain)
  registerFontsIpc(ipcMain)
  registerSettingsIpc(ipcMain)
  registerFilesystemIpc(ipcMain)
  registerLibraryIpc(ipcMain)
  registerCoverIpc(ipcMain)
  registerLyricsIpc(ipcMain)
  registerPersistenceIpc(ipcMain)
  registerSleepTimerIpc(ipcMain, sleepTimerService, assertTrustedIpcSender)
  registerAfterglowModeIpc(ipcMain)
}
