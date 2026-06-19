import { invoke } from '@tauri-apps/api/core'
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
