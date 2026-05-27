import { KNOWN_CANOPI_KEYS } from '../../generated/known-canopi-keys'
import type { CanopiFile } from '../../types/design'

type KnownCanopiKey = (typeof KNOWN_CANOPI_KEYS)[number]
type DocumentFileFieldOwner = 'document' | 'scene' | 'shared'

export interface DocumentFileSaveMetadata {
  name: string
  description?: string | null
  location?: { lat: number; lon: number; altitude_m?: number | null } | null
  northBearingDeg?: number | null
}

export interface ComposeDocumentForSaveOptions {
  metadata: DocumentFileSaveMetadata
  document: CanopiFile
  canvas: CanopiFile
}

export const DOCUMENT_FILE_FIELD_OWNERS = {
  version: 'scene',
  name: 'document',
  description: 'document',
  location: 'document',
  north_bearing_deg: 'document',
  plant_species_colors: 'scene',
  layers: 'scene',
  plants: 'scene',
  zones: 'scene',
  annotations: 'scene',
  consortiums: 'document',
  groups: 'scene',
  timeline: 'document',
  budget: 'document',
  budget_currency: 'document',
  created_at: 'document',
  updated_at: 'scene',
  extra: 'shared',
} as const satisfies Record<KnownCanopiKey, DocumentFileFieldOwner>

export const DOCUMENT_FILE_KNOWN_KEYS = Object.keys(DOCUMENT_FILE_FIELD_OWNERS) as KnownCanopiKey[]

const KNOWN_CANOPI_KEY_SET = new Set<string>(DOCUMENT_FILE_KNOWN_KEYS)

function normalizePersistedExtra(extra: CanopiFile['extra']): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {}
  return { ...extra }
}

export function extractDocumentExtra(raw: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CANOPI_KEY_SET.has(key)) {
      extra[key] = raw[key]
    }
  }
  return extra
}

export function normalizeLoadedDocument(file: CanopiFile): CanopiFile {
  return {
    ...extractDocumentExtra(file as unknown as Record<string, unknown>),
    ...normalizeDocumentKnownFields(file),
  }
}

export function normalizeNewDocument(file: CanopiFile): CanopiFile {
  return {
    ...normalizeDocumentKnownFields(file),
    extra: {},
  }
}

export function composeDocumentForSave({
  metadata,
  document,
  canvas,
}: ComposeDocumentForSaveOptions): CanopiFile {
  const topLevelExtra = extractDocumentExtra(document as unknown as Record<string, unknown>)
  const normalizedDocument = normalizeDocumentKnownFields(document)
  const normalizedCanvas = normalizeDocumentKnownFields(canvas)

  return {
    ...topLevelExtra,
    ...normalizedDocument,
    version: normalizedCanvas.version,
    name: metadata.name,
    description: metadata.description ?? normalizedDocument.description ?? null,
    location: normalizeMetadataLocation(metadata.location, normalizedDocument.location),
    north_bearing_deg: metadata.northBearingDeg ?? normalizedDocument.north_bearing_deg ?? 0,
    plant_species_colors: normalizedCanvas.plant_species_colors,
    layers: normalizedCanvas.layers,
    plants: normalizedCanvas.plants,
    zones: normalizedCanvas.zones,
    annotations: normalizedCanvas.annotations,
    groups: normalizedCanvas.groups,
    budget_currency: normalizedDocument.budget_currency ?? 'EUR',
    updated_at: normalizedCanvas.updated_at,
    extra: composeDocumentExtra(normalizedDocument.extra, normalizedCanvas.extra),
  }
}

function normalizeDocumentKnownFields(file: CanopiFile): CanopiFile {
  return {
    version: file.version,
    name: file.name,
    description: file.description ?? null,
    location: file.location ?? null,
    north_bearing_deg: file.north_bearing_deg ?? null,
    plant_species_colors: file.plant_species_colors,
    layers: file.layers,
    plants: file.plants,
    zones: file.zones,
    annotations: file.annotations ?? [],
    consortiums: file.consortiums ?? [],
    groups: file.groups ?? [],
    timeline: file.timeline ?? [],
    budget: file.budget ?? [],
    budget_currency: file.budget_currency,
    created_at: file.created_at,
    updated_at: file.updated_at,
    extra: normalizePersistedExtra(file.extra),
  }
}

function normalizeMetadataLocation(
  location: DocumentFileSaveMetadata['location'],
  documentLocation: CanopiFile['location'],
): CanopiFile['location'] {
  if (!location) return documentLocation ?? null
  return {
    lat: location.lat,
    lon: location.lon,
    altitude_m: location.altitude_m ?? null,
  }
}

function composeDocumentExtra(
  documentExtra: CanopiFile['extra'],
  canvasExtra: CanopiFile['extra'],
): Record<string, unknown> {
  const nextExtra = normalizePersistedExtra(documentExtra)
  const sceneExtra = normalizePersistedExtra(canvasExtra)
  if (Object.prototype.hasOwnProperty.call(sceneExtra, 'guides')) {
    nextExtra.guides = sceneExtra.guides
  } else {
    delete nextExtra.guides
  }
  return nextExtra
}
