import { invoke } from '@tauri-apps/api/core'
import type { TemplateMeta } from '../types/community'

export async function getTemplateCatalog(): Promise<TemplateMeta[]> {
  return invoke('get_template_catalog')
}

export async function getTemplatePreview(id: string): Promise<TemplateMeta> {
  return invoke('get_template_preview', { id })
}

export async function downloadTemplate(url: string): Promise<string> {
  return invoke('download_template', { url })
}
