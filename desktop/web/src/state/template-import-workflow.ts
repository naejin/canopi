import { openDesignAsTemplate } from '../app/document-session/actions'
import {
  selectedTemplate,
  templateImportError,
  templateImporting,
} from './community'
import { downloadTemplate } from '../ipc/community'
import type { TemplateMeta } from '../types/community'

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
