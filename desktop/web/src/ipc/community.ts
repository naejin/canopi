import { invoke } from '@tauri-apps/api/core'
import type { TemplateMeta } from '../types/community'

/** Fetch the full catalog of featured design templates. */
export async function getTemplateCatalog(): Promise<TemplateMeta[]> {
  return invoke('get_template_catalog')
}

/** Fetch metadata for a single template by ID. */
export async function getTemplatePreview(id: string): Promise<TemplateMeta> {
  return invoke('get_template_preview', { id })
}

/** Download a .canopi template file, returning the temp file path. */
export async function downloadTemplate(url: string): Promise<string> {
  return invoke('download_template', { url })
}
