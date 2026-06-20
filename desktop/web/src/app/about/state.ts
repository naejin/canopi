import { signal } from '@preact/signals'

export const aboutCanopiDialogOpen = signal(false)

export function openAboutCanopiDialog(): void {
  aboutCanopiDialogOpen.value = true
}

export function closeAboutCanopiDialog(): void {
  aboutCanopiDialogOpen.value = false
}
