import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { CanopiFile } from '../types/design'
import type { SavedObjectStamp } from '../types/saved-object-stamps'

export async function getSavedObjectStamps(): Promise<SavedObjectStamp[]> {
  return invoke('get_saved_object_stamps')
}

export async function createSavedObjectStamp(
  name: string,
  payloadJson: string,
): Promise<SavedObjectStamp> {
  return invoke('create_saved_object_stamp', { name, payloadJson })
}

export async function renameSavedObjectStamp(
  id: string,
  name: string,
): Promise<SavedObjectStamp> {
  return invoke('rename_saved_object_stamp', { id, name })
}

export async function deleteSavedObjectStamp(id: string): Promise<boolean> {
  return invoke('delete_saved_object_stamp', { id })
}

export async function reorderSavedObjectStamps(ids: string[]): Promise<SavedObjectStamp[]> {
  return invoke('reorder_saved_object_stamps', { ids })
}

export async function exportSavedObjectStampCanopiFile(
  content: CanopiFile,
  defaultName: string,
): Promise<string> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Canopi Design', extensions: ['canopi'] }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  return invoke('export_saved_object_stamp_canopi_file', { path: filePath, content })
}

export async function importSavedObjectStampCanopiFile(): Promise<CanopiFile> {
  const selected = await open({
    filters: [{ name: 'Canopi Design', extensions: ['canopi'] }],
    multiple: false,
  })
  if (!selected) throw new Error('Dialog cancelled')
  const filePath = typeof selected === 'string' ? selected : selected[0]!
  return invoke('load_saved_object_stamp_canopi_file', { path: filePath })
}
