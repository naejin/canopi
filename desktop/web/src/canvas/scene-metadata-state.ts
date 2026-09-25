import { signal } from '@preact/signals'
import type { Guide } from './guides'

export const guides = signal<Guide[]>([])
