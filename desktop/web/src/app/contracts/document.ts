import {
  DEFAULT_BUDGET_CURRENCY,
  DOCUMENT_FILE_FIELD_OWNERS as GENERATED_DOCUMENT_FILE_FIELD_OWNERS,
  KNOWN_CANOPI_KEYS,
} from '../../generated/known-canopi-keys'
import type {
  DocumentFileFieldOwner,
  KnownCanopiKey,
} from '../../generated/known-canopi-keys'
import type { CanopiFile } from '../../types/design'
import { resolvePersistedNorthBearingDeg } from '../../canvas/runtime/document-metadata'

export { DEFAULT_BUDGET_CURRENCY, KNOWN_CANOPI_KEYS }

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

export const DOCUMENT_FILE_FIELD_OWNERS = GENERATED_DOCUMENT_FILE_FIELD_OWNERS

export const DOCUMENT_FILE_KNOWN_KEYS = KNOWN_CANOPI_KEYS

const KNOWN_CANOPI_KEY_SET = new Set<string>(DOCUMENT_FILE_KNOWN_KEYS)
const SHARED_EXTRA_FIELD_OWNERS = {
  guides: 'scene',
} as const satisfies Record<string, DocumentFileFieldOwner>

function normalizePersistedExtra(extra: CanopiFile['extra']): Record<string, unknown> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {}
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (KNOWN_CANOPI_KEY_SET.has(key)) continue
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }
  return normalized
}

export function extractDocumentExtra(raw: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!KNOWN_CANOPI_KEY_SET.has(key)) {
      Object.defineProperty(extra, key, {
        configurable: true,
        enumerable: true,
        value: raw[key],
        writable: true,
      })
    }
  }
  return extra
}

export function normalizeLoadedDocument(file: CanopiFile): CanopiFile {
  return {
    ...normalizeDocumentKnownFields(file),
    extra: {
      ...normalizePersistedExtra(file.extra),
      ...extractDocumentExtra(file as unknown as Record<string, unknown>),
    },
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
  const normalizedDocument = normalizeDocumentKnownFields(document)
  const normalizedCanvas = normalizeDocumentKnownFields(canvas)
  const composed = composeKnownDocumentFields(normalizedDocument, normalizedCanvas)

  return {
    ...composed,
    name: metadata.name,
    description: metadata.description ?? composed.description ?? null,
    location: normalizeMetadataLocation(metadata.location, composed.location),
    north_bearing_deg: resolvePersistedNorthBearingDeg(
      metadata.northBearingDeg,
      document.north_bearing_deg,
    ),
  }
}

function composeKnownDocumentFields(
  document: CanopiFile,
  canvas: CanopiFile,
): CanopiFile {
  const output: Partial<Record<KnownCanopiKey, unknown>> = {}

  for (const key of DOCUMENT_FILE_KNOWN_KEYS) {
    if (key === 'extra') continue
    output[key] = ownedFieldSource(key, document, canvas)[key]
  }

  output.extra = composeDocumentExtra(document.extra, canvas.extra)
  return output as CanopiFile
}

function ownedFieldSource(
  key: KnownCanopiKey,
  document: CanopiFile,
  canvas: CanopiFile,
): CanopiFile {
  return DOCUMENT_FILE_FIELD_OWNERS[key] === 'scene' ? canvas : document
}

function normalizeDocumentKnownFields(file: CanopiFile): CanopiFile {
  return {
    version: file.version,
    name: file.name,
    description: file.description ?? null,
    location: file.location ?? null,
    north_bearing_deg: file.north_bearing_deg ?? null,
    plant_species_colors: file.plant_species_colors,
    plant_species_symbols: file.plant_species_symbols ?? {},
    layers: file.layers,
    plants: file.plants,
    zones: file.zones,
    annotations: file.annotations ?? [],
    measurement_guides: file.measurement_guides ?? [],
    consortiums: file.consortiums ?? [],
    groups: file.groups ?? [],
    timeline: file.timeline ?? [],
    budget: file.budget ?? [],
    budget_currency: file.budget_currency ?? DEFAULT_BUDGET_CURRENCY,
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

  for (const [key, owner] of Object.entries(SHARED_EXTRA_FIELD_OWNERS)) {
    const source = sharedExtraSource(owner, nextExtra, sceneExtra)
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      nextExtra[key] = source[key]
    } else {
      delete nextExtra[key]
    }
  }

  return nextExtra
}

function sharedExtraSource(
  owner: DocumentFileFieldOwner,
  documentExtra: Record<string, unknown>,
  sceneExtra: Record<string, unknown>,
): Record<string, unknown> {
  switch (owner) {
    case 'document':
    case 'shared':
      return documentExtra
    case 'scene':
      return sceneExtra
  }
}
