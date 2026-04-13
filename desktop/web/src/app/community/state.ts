import { signal } from '@preact/signals'
import type { TemplateMeta } from '../../types/community'

/** Full catalog of featured design templates. */
export const templateCatalog = signal<TemplateMeta[]>([])

/** Currently selected template for preview. */
export const selectedTemplate = signal<TemplateMeta | null>(null)

/** Whether the catalog is being fetched. */
export const catalogLoading = signal<boolean>(false)

/** User-visible catalog loading failure. */
export const catalogError = signal<string | null>(null)

/** Active climate zone filter (empty string = no filter). */
export const climateFilter = signal<string>('')

/** Active style/tag filter (empty string = no filter). */
export const styleFilter = signal<string>('')

/** True while a template is being imported into the current document session. */
export const templateImporting = signal<boolean>(false)

/** User-visible import failure for the selected template. */
export const templateImportError = signal<string | null>(null)
