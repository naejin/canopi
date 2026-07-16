import { acquireDesignTemplate } from '../../ipc/community'
import type { TemplateMeta } from '../../types/community'
import type { CanopiFile } from '../../types/design'
import {
  openDesignAsTemplate,
} from '../document-session/actions'
import {
  createDesignTemplateImportCoordinator,
  type DesignTemplateImportResult,
} from './coordinator'

export interface DesignTemplateImportAdapters {
  readonly acquireDesignTemplate: (id: string) => Promise<CanopiFile>
  readonly openDesignAsTemplate: typeof openDesignAsTemplate
}

const DEFAULT_ADAPTERS: DesignTemplateImportAdapters = {
  acquireDesignTemplate,
  openDesignAsTemplate,
}

export function createDesktopDesignTemplateImportWorkflow(
  adapters: DesignTemplateImportAdapters,
) {
  return createDesignTemplateImportCoordinator({
    acquire: (template) => adapters.acquireDesignTemplate(template.id),
    open: (file, template, isCancelled) => adapters.openDesignAsTemplate(
      file,
      template.title,
      { isCancelled },
    ),
  })
}

const defaultWorkflow = createDesktopDesignTemplateImportWorkflow(DEFAULT_ADAPTERS)

export async function importDesignTemplateIntoCurrentSession(
  template: TemplateMeta,
  adapters?: DesignTemplateImportAdapters,
): Promise<DesignTemplateImportResult> {
  return adapters
    ? createDesktopDesignTemplateImportWorkflow(adapters).importTemplate(template)
    : defaultWorkflow.importTemplate(template)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => defaultWorkflow.dispose())
}
