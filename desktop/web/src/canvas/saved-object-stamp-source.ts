import { signal } from '@preact/signals'
import type { SavedObjectStampPayload } from './saved-object-stamp-payload'
import {
  normalizeSavedObjectStampPayload,
  parseSavedObjectStampPayload,
} from './saved-object-stamp-payload'
import type { CanvasToolCommandSurface } from './runtime/runtime'
import { currentCanvasToolCommandSurface } from './session'
import type { SavedObjectStamp } from '../types/saved-object-stamps'

const SAVED_OBJECT_STAMP_MIME = 'application/x.canopi.saved-object-stamp+json'
const LEGACY_TEXT_MIME = 'text/plain'

type WritableDragData = Pick<DataTransfer, 'setData'> & { effectAllowed?: string }
type DragDataTypes = {
  readonly types?: {
    readonly length: number
    readonly [index: number]: string | undefined
    includes?(type: string): boolean
    item?(index: number): string | null
    contains?(type: string): boolean
  }
}
type ReadableDragData = Pick<DataTransfer, 'getData'> & DragDataTypes

const selectedSavedObjectStampSource = signal<SavedObjectStampPayload | null>(null)
const activeSavedObjectStampDragSource = signal<SavedObjectStampPayload | null>(null)

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

export function writeSavedObjectStampDragData(
  dataTransfer: WritableDragData | null | undefined,
  stamp: SavedObjectStamp,
): SavedObjectStampPayload | null {
  if (!dataTransfer) return null
  const payload = parseSavedObjectStampPayload(stamp.payload_json)
  if (!payload) return null
  const serialized = JSON.stringify(payload)
  dataTransfer.setData(SAVED_OBJECT_STAMP_MIME, serialized)
  dataTransfer.setData(LEGACY_TEXT_MIME, serialized)
  dataTransfer.effectAllowed = 'copy'
  activeSavedObjectStampDragSource.value = payload
  return payload
}

export function readSavedObjectStampDragData(
  dataTransfer: ReadableDragData | null | undefined,
): SavedObjectStampPayload | null {
  if (!dataTransfer) return null

  for (const mimeType of [SAVED_OBJECT_STAMP_MIME, LEGACY_TEXT_MIME]) {
    let raw = ''
    try {
      raw = dataTransfer.getData(mimeType)
    } catch {
      return null
    }
    const payload = parseSavedObjectStampPayload(raw)
    if (payload) return payload
  }

  return null
}

export function hasSavedObjectStampDragData(
  dataTransfer: ReadableDragData | null | undefined,
): boolean {
  if (!dataTransfer) return false
  if (hasDragDataType(dataTransfer, SAVED_OBJECT_STAMP_MIME)) return true
  return readSavedObjectStampDragData(dataTransfer) !== null
}

export function readSavedObjectStampDragPreviewSource(
  dataTransfer: ReadableDragData | null | undefined,
): SavedObjectStampPayload | null {
  return readSavedObjectStampDragData(dataTransfer)
    ?? (hasDragDataType(dataTransfer ?? {}, SAVED_OBJECT_STAMP_MIME)
      ? activeSavedObjectStampDragSource.value
      : null)
}

export function readSavedObjectStampDropSource(event: DragEvent): SavedObjectStampPayload | null {
  return readSavedObjectStampDragData(event.dataTransfer)
}

export function clearSavedObjectStampDragSource(): void {
  activeSavedObjectStampDragSource.value = null
}

function hasDragDataType(dataTransfer: DragDataTypes, type: string): boolean {
  const types = dataTransfer.types
  if (!types) return false

  if (typeof types.includes === 'function') return types.includes(type)

  if (typeof types.contains === 'function') return types.contains(type)

  for (let i = 0; i < types.length; i += 1) {
    const item = typeof types.item === 'function' ? types.item(i) : types[i]
    if (item === type) return true
  }
  return false
}
