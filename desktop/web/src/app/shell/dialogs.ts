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

export const gettingStartedDialogOpen = signal(false)

export function openGettingStartedDialog(): void {
  gettingStartedDialogOpen.value = true
}

export function closeGettingStartedDialog(): void {
  gettingStartedDialogOpen.value = false
}

/** The command palette (Help › Command palette, Ctrl Shift P); Desktop only. */
export const commandPaletteOpen = signal(false)

export function openCommandPalette(): void {
  commandPaletteOpen.value = true
}

export function closeCommandPalette(): void {
  commandPaletteOpen.value = false
}
