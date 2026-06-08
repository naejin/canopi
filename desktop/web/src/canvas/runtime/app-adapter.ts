import type { CanopiFile } from '../../types/design'
import type { CanvasRuntimeDocumentMetadata } from './runtime'

export interface CanvasRuntimeCleanStateAdapter {
  setCanvasClean(clean: boolean): void
}

export interface CanvasRuntimeDocumentCompositionInput {
  readonly metadata: CanvasRuntimeDocumentMetadata
  readonly document: CanopiFile
  readonly canvas: CanopiFile
}

export interface CanvasRuntimeDocumentAdapter {
  composeDocumentForSave(input: CanvasRuntimeDocumentCompositionInput): CanopiFile
}

export interface CanvasRuntimeAppAdapter {
  readonly cleanState: CanvasRuntimeCleanStateAdapter
  readonly document: CanvasRuntimeDocumentAdapter
}

export function createDetachedCanvasRuntimeAppAdapter(): CanvasRuntimeAppAdapter {
  return {
    cleanState: {
      setCanvasClean: () => {},
    },
    document: {
      composeDocumentForSave: composeDetachedCanvasDocument,
    },
  }
}

function composeDetachedCanvasDocument({
  metadata,
  canvas,
}: CanvasRuntimeDocumentCompositionInput): CanopiFile {
  return {
    ...canvas,
    name: metadata.name,
    description: metadata.description ?? canvas.description ?? null,
    location: normalizeMetadataLocation(metadata.location, canvas.location),
    north_bearing_deg: metadata.northBearingDeg ?? canvas.north_bearing_deg ?? 0,
  }
}

function normalizeMetadataLocation(
  location: CanvasRuntimeDocumentMetadata['location'],
  fallback: CanopiFile['location'],
): CanopiFile['location'] {
  if (!location) return fallback ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitude_m: location.altitude_m ?? null,
  }
}
