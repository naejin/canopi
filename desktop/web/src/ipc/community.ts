import { invoke } from '@tauri-apps/api/core'
import type { TemplateMeta } from '../types/community'
import type { CanopiFile } from '../types/design'

export async function getTemplateCatalog(): Promise<TemplateMeta[]> {
  return invoke('get_template_catalog')
}

export async function getTemplatePreview(id: string): Promise<TemplateMeta> {
  return invoke('get_template_preview', { id })
}

export async function acquireDesignTemplate(id: string): Promise<CanopiFile> {
  return invoke('acquire_design_template', { id })
}
