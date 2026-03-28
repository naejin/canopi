import { signal } from '@preact/signals'
import type { TemplateMeta } from '../types/community'

/** Full catalog of featured design templates. */
export const templateCatalog = signal<TemplateMeta[]>([])

/** Currently selected template for preview. */
export const selectedTemplate = signal<TemplateMeta | null>(null)

/** Whether the catalog is being fetched. */
export const catalogLoading = signal<boolean>(false)

/** Active climate zone filter (empty string = no filter). */
export const climateFilter = signal<string>('')

/** Active style/tag filter (empty string = no filter). */
export const styleFilter = signal<string>('')
