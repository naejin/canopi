import { signal } from '@preact/signals'

export type SettingsSection = 'preferences' | 'currentDesign'

export const settingsModalOpen = signal(false)
export const settingsModalSection = signal<SettingsSection>('preferences')

export function openSettingsModal(section: SettingsSection = 'preferences'): void {
  settingsModalSection.value = section
  settingsModalOpen.value = true
}

export function closeSettingsModal(): void {
  settingsModalOpen.value = false
  settingsModalSection.value = 'preferences'
}

export function setSettingsModalSection(section: SettingsSection): void {
  settingsModalSection.value = section
}
