import { downloadTemplate } from '../../ipc/community'
import type { TemplateMeta } from '../../types/community'
import {
  openDesignAsTemplate,
  type TemplateOpenResult,
} from '../document-session/actions'

export interface DesignTemplateImportAdapters {
  readonly downloadTemplate: (url: string) => Promise<string>
  readonly openDesignAsTemplate: (path: string, name: string) => Promise<TemplateOpenResult>
}

const DEFAULT_ADAPTERS: DesignTemplateImportAdapters = {
  downloadTemplate,
  openDesignAsTemplate,
}

export async function importDesignTemplateIntoCurrentSession(
  template: TemplateMeta,
  adapters: DesignTemplateImportAdapters = DEFAULT_ADAPTERS,
): Promise<TemplateOpenResult> {
  const path = await adapters.downloadTemplate(template.download_url)
  return adapters.openDesignAsTemplate(path, template.title)
}
