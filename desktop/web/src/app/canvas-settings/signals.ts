import { signal } from '@preact/signals'
import { DEFAULT_SETTINGS } from '../../generated/settings'

export const snapToGridEnabled = signal<boolean>(DEFAULT_SETTINGS.snap_to_grid)
export const gridVisible = signal<boolean>(true)
