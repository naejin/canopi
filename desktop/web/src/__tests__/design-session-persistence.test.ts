import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasDocumentSurface } from '../canvas/runtime/runtime'
import type { CanopiFile } from '../types/design'

const mocks = vi.hoisted(() => ({
  disposeConsortiumSync: vi.fn(),
}))

vi.mock('../app/document-session/workflows', () => ({
  disposeConsortiumSync: mocks.disposeConsortiumSync,
}))

import {
  buildPersistedDesignSessionContent,
  disposeDesignSessionPersistence,
  snapshotCanvasIntoDesignSession,
} from '../app/document-session/persistence'
import { currentDesign } from '../state/design'

function makeDesign(name = 'Design'): CanopiFile {
  return {
    version: 2,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-04-13T00:00:00.000Z',
    updated_at: '2026-04-13T00:00:00.000Z',
    extra: {},
  }
}

function makeSession(
  serializeDocument: CanvasDocumentSurface['serializeDocument'] = (metadata, doc) => ({
    ...doc,
    name: metadata.name,
    plants: [{ id: 'canvas-plant' } as CanopiFile['plants'][number]],
  }),
): CanvasDocumentSurface {
  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn(),
    replaceDocument: vi.fn(),
    hasLoadedDocument: vi.fn(() => true),
    serializeDocument: vi.fn(serializeDocument),
    markSaved: vi.fn(),
    clearHistory: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('Design Session persistence', () => {
  beforeEach(() => {
    currentDesign.value = null
    mocks.disposeConsortiumSync.mockClear()
  })

  it('builds attached persisted content through the canvas document surface', () => {
    const design = makeDesign('Original')
    const session = makeSession()
    currentDesign.value = design

    const result = buildPersistedDesignSessionContent({
      session,
      name: 'Persisted',
    })

    expect(session.serializeDocument).toHaveBeenCalledWith({ name: 'Persisted' }, design)
    expect(result.name).toBe('Persisted')
    expect(result.plants).toEqual([{ id: 'canvas-plant' }])
  })

  it('builds detached persisted content from canonical Design state', () => {
    const design = makeDesign('Original')
    currentDesign.value = design

    const result = buildPersistedDesignSessionContent({
      session: null,
      name: 'Detached',
    })

    expect(result).toEqual({ ...design, name: 'Detached' })
  })

  it('fails with operation context when no Design is loaded', () => {
    expect(() => buildPersistedDesignSessionContent({
      session: null,
      name: 'Missing',
    })).toThrow('buildPersistedDesignSessionContent: no design loaded')
  })

  it('snapshots attached canvas content into the current Design Session', () => {
    const design = makeDesign('Original')
    const session = makeSession((metadata, doc) => ({
      ...doc,
      name: metadata.name,
      zones: [{ name: 'canvas-zone', zone_type: 'bed', points: [], fill_color: null, notes: null }],
    }))
    currentDesign.value = design

    const result = snapshotCanvasIntoDesignSession({
      session,
      name: 'Snapshot',
    })

    expect(result?.name).toBe('Snapshot')
    expect(result?.zones).toEqual([{ name: 'canvas-zone', zone_type: 'bed', points: [], fill_color: null, notes: null }])
    expect(currentDesign.value).toBe(result)
  })

  it('does not snapshot when no Design is loaded', () => {
    const session = makeSession()

    const result = snapshotCanvasIntoDesignSession({
      session,
      name: 'Missing',
    })

    expect(result).toBeNull()
    expect(session.serializeDocument).not.toHaveBeenCalled()
  })

  it('disposes Design Session persistence workflows', () => {
    disposeDesignSessionPersistence()

    expect(mocks.disposeConsortiumSync).toHaveBeenCalledTimes(1)
  })
})
