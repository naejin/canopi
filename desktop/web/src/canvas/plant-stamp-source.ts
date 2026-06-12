import { signal } from '@preact/signals'
import type { CanvasToolCommandSurface } from './runtime/runtime'

const PLANT_STAMP_MIME = 'application/x.canopi.plant-stamp+json'
const LEGACY_TEXT_MIME = 'text/plain'

export interface PlantStampSource {
  readonly canonical_name: string
  readonly common_name: string | null
  readonly stratum: string | null
  readonly width_max_m: number | null
}

export interface PlantStampSourceInput {
  readonly canonical_name: string
  readonly common_name: string | null
  readonly stratum: string | null
  readonly width_max_m: number | null
}

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

const selectedPlantStampSource = signal<PlantStampSource | null>(null)

export function plantStampSourceFromSpecies(source: PlantStampSourceInput): PlantStampSource {
  return {
    canonical_name: source.canonical_name,
    common_name: source.common_name,
    stratum: source.stratum,
    width_max_m: source.width_max_m,
  }
}

export function readPlantStampSource(): PlantStampSource | null {
  return selectedPlantStampSource.value
}

export function selectPlantStampSource(source: PlantStampSourceInput): PlantStampSource {
  const next = plantStampSourceFromSpecies(source)
  selectedPlantStampSource.value = next
  return next
}

export function clearPlantStampSource(): void {
  selectedPlantStampSource.value = null
}

export function beginPlantStampFromSpecies(
  source: PlantStampSourceInput,
  commandSurface: CanvasToolCommandSurface | null | undefined,
): PlantStampSource {
  const next = selectPlantStampSource(source)
  commandSurface?.setTool('plant-stamp')
  return next
}

export function writePlantStampDragData(
  dataTransfer: WritableDragData | null | undefined,
  source: PlantStampSourceInput,
): PlantStampSource | null {
  if (!dataTransfer) return null
  const next = plantStampSourceFromSpecies(source)
  const serialized = JSON.stringify(next)
  dataTransfer.setData(PLANT_STAMP_MIME, serialized)
  dataTransfer.setData(LEGACY_TEXT_MIME, serialized)
  dataTransfer.effectAllowed = 'copy'
  return next
}

export function readPlantStampDragData(
  dataTransfer: ReadableDragData | null | undefined,
): PlantStampSource | null {
  if (!dataTransfer) return null

  for (const mimeType of [PLANT_STAMP_MIME, LEGACY_TEXT_MIME]) {
    let raw = ''
    try {
      raw = dataTransfer.getData(mimeType)
    } catch {
      return null
    }
    const source = parsePlantStampSource(raw)
    if (source) return source
  }

  return null
}

export function hasPlantStampDragData(
  dataTransfer: ReadableDragData | null | undefined,
): boolean {
  if (!dataTransfer) return false
  if (hasDragDataType(dataTransfer, PLANT_STAMP_MIME)) return true
  if (hasDragDataType(dataTransfer, LEGACY_TEXT_MIME)) return true
  return readPlantStampDragData(dataTransfer) !== null
}

export function readPlantStampDropSource(event: DragEvent): PlantStampSource | null {
  return readPlantStampDragData(event.dataTransfer)
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

function parsePlantStampSource(raw: string): PlantStampSource | null {
  if (!raw) return null

  try {
    const data = JSON.parse(raw)
    if (typeof data.canonical_name !== 'string' || data.canonical_name.trim() === '') {
      return null
    }
    return {
      canonical_name: data.canonical_name,
      common_name: typeof data.common_name === 'string' ? data.common_name : null,
      stratum: typeof data.stratum === 'string' ? data.stratum : null,
      width_max_m: typeof data.width_max_m === 'number' && Number.isFinite(data.width_max_m)
        ? data.width_max_m
        : null,
    }
  } catch {
    return null
  }
}
