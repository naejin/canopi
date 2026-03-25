import { invoke } from '@tauri-apps/api/core'
import type { Settings } from '../types/settings'

export async function getSettings(): Promise<Settings> {
  return invoke('get_settings')
}

export async function setSettings(settings: Settings): Promise<void> {
  return invoke('set_settings', { settings })
}
