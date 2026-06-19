import { signal } from '@preact/signals'
import type { SavedObjectStampPayload } from './saved-object-stamp-payload'
import {
  normalizeSavedObjectStampPayload,
  parseSavedObjectStampPayload,
} from './saved-object-stamp-payload'
import type { CanvasToolCommandSurface } from './runtime/runtime'
import { currentCanvasToolCommandSurface } from './session'
import type { SavedObjectStamp } from '../types/saved-object-stamps'

const selectedSavedObjectStampSource = signal<SavedObjectStampPayload | null>(null)

export function readSavedObjectStampSource(): SavedObjectStampPayload | null {
  return selectedSavedObjectStampSource.value
}

export function selectSavedObjectStampSource(
  source: SavedObjectStampPayload,
): SavedObjectStampPayload | null {
  const normalized = normalizeSavedObjectStampPayload(source)
  selectedSavedObjectStampSource.value = normalized
  return normalized
}

export function clearSavedObjectStampSource(): void {
  selectedSavedObjectStampSource.value = null
}

export function beginSavedObjectStampPlacement(
  stamp: SavedObjectStamp,
  commandSurface: CanvasToolCommandSurface | null | undefined = currentCanvasToolCommandSurface.value,
): boolean {
  const payload = parseSavedObjectStampPayload(stamp.payload_json)
  if (!payload || !commandSurface) return false
  selectedSavedObjectStampSource.value = payload
  commandSurface.setTool('saved-object-stamp')
  return true
}
