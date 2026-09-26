import { signal } from '@preact/signals'

/** Workspace dialogs opened by commands; each dialog component owns its focus and Escape. */
export const settingsDialogOpen = signal(false)
export const keyboardShortcutsDialogOpen = signal(false)

export function openSettingsDialog(): void {
  settingsDialogOpen.value = true
}

export function closeSettingsDialog(): void {
  settingsDialogOpen.value = false
}

export function openKeyboardShortcutsDialog(): void {
  keyboardShortcutsDialogOpen.value = true
}

export function closeKeyboardShortcutsDialog(): void {
  keyboardShortcutsDialogOpen.value = false
}
