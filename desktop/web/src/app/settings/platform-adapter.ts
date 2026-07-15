import type { Settings } from '../../types/settings'

export interface SettingsPlatformAdapter {
  load(): Settings | Promise<Settings>
  save(settings: Settings): Promise<void>
}
