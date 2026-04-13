import { computed } from '@preact/signals'
import { openDesignAsTemplate } from '../document-session/actions'
import { downloadTemplate, getTemplateCatalog, getTemplatePreview } from '../../ipc/community'
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

export function clearCommunityFilters(): void {
  climateFilter.value = ''
  styleFilter.value = ''
}

export async function importTemplateIntoCurrentSession(template: TemplateMeta): Promise<void> {
  templateImporting.value = true
  templateImportError.value = null

  try {
    const path = await downloadTemplate(template.download_url)
    const result = await openDesignAsTemplate(path, template.title)
    if (result !== 'cancelled') {
      selectedTemplate.value = null
    }
  } catch (error) {
    templateImportError.value = error instanceof Error ? error.message : String(error)
  } finally {
    templateImporting.value = false
  }
}
