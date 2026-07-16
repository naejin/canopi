import { acquireDesignTemplate } from '../../ipc/community'
import type { TemplateMeta } from '../../types/community'
import type { CanopiFile } from '../../types/design'
import {
  openDesignAsTemplate,
} from '../document-session/actions'
import {
  createDesignTemplateImportCoordinator,
} from './coordinator'
import type { DesignTemplateImportResult } from './types'

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
    open: (envelope, isCancelled) => adapters.openDesignAsTemplate(
      envelope,
      { isCancelled },
    ),
  })
}

const defaultWorkflow = createDesktopDesignTemplateImportWorkflow(DEFAULT_ADAPTERS)

export async function importDesignTemplateIntoCurrentSession(
  template: TemplateMeta,
): Promise<DesignTemplateImportResult> {
  return defaultWorkflow.importTemplate(template)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => defaultWorkflow.dispose())
}
