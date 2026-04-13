import { signal } from '@preact/signals'
import type { Guide } from './guides'

export const northBearingDeg = signal<number>(0)
export const guides = signal<Guide[]>([])
