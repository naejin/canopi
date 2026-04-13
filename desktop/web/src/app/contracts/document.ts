import { KNOWN_CANOPI_KEYS } from '../../generated/known-canopi-keys'
import type { CanopiFile } from '../../types/design'

const KNOWN_CANOPI_KEY_SET = new Set<string>(KNOWN_CANOPI_KEYS)

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
    ...file,
    extra: {
      ...normalizePersistedExtra(file.extra),
      ...extractDocumentExtra(file as unknown as Record<string, unknown>),
    },
  }
}

export function normalizeNewDocument(file: CanopiFile): CanopiFile {
  return {
    ...file,
    extra: {},
  }
}
