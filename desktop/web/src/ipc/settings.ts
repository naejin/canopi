import { invoke } from '@tauri-apps/api/core'
import type { AppFolder, AppFolderLocations } from '../generated/contracts'
import type { Settings } from '../types/settings'

export async function getSettings(): Promise<Settings> {
  return invoke('get_settings')
}

export async function setSettings(settings: Settings): Promise<void> {
  return invoke('set_settings', { settings })
}

/** Settings › Files and data: where Drafts and the Data library live. Shown on screen only. */
export async function getAppFolders(): Promise<AppFolderLocations> {
  return invoke('get_app_folders')
}

export async function showAppFolder(folder: AppFolder): Promise<void> {
  return invoke('show_app_folder', { folder })
}
