import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { currentDesign, nonCanvasRevision } from './support/design-session-state'
import { setCurrentCanvasSession } from '../canvas/session'
import { consortiumSyncWorkflow } from '../app/consortium/workflow'
import { createDesignSessionWorkflowRunner } from '../app/document-session/workflow-runner'
import type { CanopiFile, PlacedPlant } from '../types/design'
import { consortiumTarget, getConsortiumCanonicalName } from '../target'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'test',
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
    created_at: '',
    updated_at: '',
    extra: {},
    ...overrides,
  }
}

function makePlant(canonical_name: string): PlacedPlant {
  return {
    id: `plant-${canonical_name}`,
    canonical_name,
    common_name: null,
    color: null,
    position: { x: 0, y: 0 },
    rotation: null,
    scale: null,
    notes: null,
    planted_date: null,
    quantity: null,
    locked: false,
  }
}

function mockSession(plants: PlacedPlant[]) {
  return createTestCanvasQuerySurface({ plants })
}

function mountQuerySurface(session: ReturnType<typeof mockSession>): void {
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: session }))
}

describe('consortium-sync-workflow', () => {
  let workflowRunner: ReturnType<typeof createDesignSessionWorkflowRunner>

  beforeEach(() => {
    nonCanvasRevision.value = 0
    currentDesign.value = null
    setCurrentCanvasSession(null)
    workflowRunner = createDesignSessionWorkflowRunner([consortiumSyncWorkflow])
  })

  afterEach(() => {
    workflowRunner.dispose()
  })

  it('adds consortium entries for new plant species', () => {
    const plants = [makePlant('Quercus robur'), makePlant('Acer campestre')]
    const session = mockSession(plants)
    currentDesign.value = makeDesign()
    mountQuerySurface(session)

    workflowRunner.install()
    session.bumpSceneRevision()

    const consortiums = currentDesign.value!.consortiums
    expect(consortiums).toHaveLength(2)
    expect(consortiums.map(getConsortiumCanonicalName).sort()).toEqual(['Acer campestre', 'Quercus robur'])
    expect(consortiums[0]!.stratum).toBe('unassigned')
  })

  it('preserves inactive consortium entries when species are deleted', () => {
    currentDesign.value = makeDesign({
      consortiums: [
        { target: consortiumTarget('Quercus robur'), stratum: 'high', start_phase: 0, end_phase: 3 },
        { target: consortiumTarget('Acer campestre'), stratum: 'medium', start_phase: 0, end_phase: 2 },
      ],
    })
    // Only Quercus remains on canvas
    const session = mockSession([makePlant('Quercus robur')])
    mountQuerySurface(session)

    workflowRunner.install()
    session.bumpSceneRevision()

    const consortiums = currentDesign.value!.consortiums
    expect(consortiums).toHaveLength(2)
    expect(consortiums).toContainEqual({ target: consortiumTarget('Acer campestre'), stratum: 'medium', start_phase: 0, end_phase: 2 })
  })

  it('does not increment nonCanvasRevision (markDirty: false)', () => {
    const session = mockSession([makePlant('Quercus robur')])
    currentDesign.value = makeDesign()
    mountQuerySurface(session)

    workflowRunner.install()
    session.bumpSceneRevision()

    expect(nonCanvasRevision.value).toBe(0)
  })

  it('is a no-op when plant set has not changed', () => {
    const plants = [makePlant('Quercus robur')]
    currentDesign.value = makeDesign({
      consortiums: [{ target: consortiumTarget('Quercus robur'), stratum: 'high', start_phase: 0, end_phase: 3 }],
    })
    const session = mockSession(plants)
    mountQuerySurface(session)

    workflowRunner.install()
    // First tick — names match existing consortiums
    session.bumpSceneRevision()
    const snapshotAfterFirst = currentDesign.value

    // Second tick — no change
    session.bumpSceneRevision()
    expect(currentDesign.value).toBe(snapshotAfterFirst)
  })

  it('disposes cleanly without errors', () => {
    workflowRunner.install()
    expect(() => workflowRunner.dispose()).not.toThrow()
    // Double dispose is safe
    expect(() => workflowRunner.dispose()).not.toThrow()
  })
})
