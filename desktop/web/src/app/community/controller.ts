import { computed } from '@preact/signals'
import { importDesignTemplateIntoCurrentSession } from '../design-template-import/workflow'
import { getTemplateCatalog, getTemplatePreview } from '#design-template-catalog'
import type { TemplateMeta } from '../../types/community'
import {
  catalogError,
  catalogLoading,
  climateFilter,
  selectedTemplate,
  styleFilter,
  templateCatalog,
  templateImportError,
  templateImporting,
} from './state'

let previewRequestId = 0
let templateImportRequestId = 0

export const communityView = computed(() => ({
  catalog: templateCatalog.value,
  loading: catalogLoading.value,
  error: catalogError.value,
  selected: selectedTemplate.value,
  climate: climateFilter.value,
  style: styleFilter.value,
  importPending: templateImporting.value,
  importError: templateImportError.value,
}))

export async function loadTemplateCatalog(force = false): Promise<void> {
  if (catalogLoading.value) return
  if (!force && templateCatalog.value.length > 0) return

  catalogLoading.value = true
  catalogError.value = null

  try {
    templateCatalog.value = await getTemplateCatalog()
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : String(error)
  } finally {
    catalogLoading.value = false
  }
}

export async function selectTemplate(template: TemplateMeta | null): Promise<void> {
  if (template === null) {
    previewRequestId += 1
    selectedTemplate.value = null
    return
  }

  if (selectedTemplate.value?.id === template.id && selectedTemplate.value.description) {
    return
  }

  const requestId = ++previewRequestId
  try {
    const preview = await getTemplatePreview(template.id)
    if (requestId === previewRequestId) {
      selectedTemplate.value = preview
    }
  } catch {
    if (requestId === previewRequestId) {
      selectedTemplate.value = template
    }
  }
}

export function setClimateFilter(value: string): void {
  climateFilter.value = value
}

export function setStyleFilter(value: string): void {
  styleFilter.value = value
}

export async function importTemplateIntoCurrentSession(template: TemplateMeta): Promise<void> {
  const requestId = ++templateImportRequestId
  templateImporting.value = true
  templateImportError.value = null

  try {
    const result = await importDesignTemplateIntoCurrentSession(template)
    if (requestId !== templateImportRequestId) return
    if (
      result !== 'cancelled'
      && result !== 'superseded'
      && selectedTemplate.value?.id === template.id
    ) {
      selectedTemplate.value = null
    }
  } catch (error) {
    if (requestId !== templateImportRequestId) return
    templateImportError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (requestId === templateImportRequestId) {
      templateImporting.value = false
    }
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    templateImportRequestId += 1
    templateImporting.value = false
  })
}
