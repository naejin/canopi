import { beforeEach, describe, expect, it } from 'vitest'
import { beginDocumentArrayEdit } from '../app/document/edit-transaction'
import { consortiumTarget } from '../panel-targets'
import { currentDesign, nonCanvasRevision } from '../state/design'
import type { CanopiFile, Consortium, TimelineAction } from '../types/design'

function timelineAction(id: string, overrides: Partial<TimelineAction> = {}): TimelineAction {
  return {
    id,
    start_date: '2026-04-01',
    end_date: '2026-04-02',
    action_type: 'plant',
    description: 'initial',
    order: 0,
    completed: false,
    recurrence: null,
    targets: [],
    depends_on: null,
    ...overrides,
  }
}

function consortium(canonicalName: string, overrides: Partial<Omit<Consortium, 'target'>> = {}): Consortium {
  return {
    target: consortiumTarget(canonicalName),
    stratum: 'high',
    start_phase: 0,
    end_phase: 3,
    ...overrides,
  }
}

function design(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'test',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [consortium('Quercus robur')],
    groups: [],
    timeline: [timelineAction('a')],
    budget: [],
    created_at: '',
    updated_at: '',
    extra: {},
    ...overrides,
  }
}

beforeEach(() => {
  nonCanvasRevision.value = 0
  currentDesign.value = design()
})

describe('document array edit transactions', () => {
  it('previews document array updates without advancing the non-canvas revision', () => {
    const edit = beginDocumentArrayEdit('timeline')

    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'preview' } : action
    )))

    expect(currentDesign.value?.timeline[0]?.description).toBe('preview')
    expect(edit.hasMutated).toBe(true)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('commits one dirty revision after one or many preview mutations', () => {
    const edit = beginDocumentArrayEdit('timeline')

    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'preview 1' } : action
    )))
    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'preview 2' } : action
    )))
    edit.commit()
    edit.commit()

    expect(currentDesign.value?.timeline[0]?.description).toBe('preview 2')
    expect(nonCanvasRevision.value).toBe(1)
  })

  it('does not dirty when a committed transaction never mutates', () => {
    const edit = beginDocumentArrayEdit('timeline')

    edit.preview((timeline) => timeline)
    edit.commit()

    expect(edit.hasMutated).toBe(false)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('aborts by restoring the original document slice without dirtying the document', () => {
    const original = currentDesign.value!.consortiums
    const edit = beginDocumentArrayEdit('consortiums')

    edit.preview((consortiums) => [...consortiums, consortium('Acer campestre')])
    edit.abort()
    edit.abort()

    expect(currentDesign.value?.consortiums).toBe(original)
    expect(currentDesign.value?.consortiums.map((entry) => entry.target)).toEqual([consortiumTarget('Quercus robur')])
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('keeps commit and abort cleanup idempotent after a transaction closes', () => {
    const edit = beginDocumentArrayEdit('consortiums')

    edit.preview((consortiums) => [...consortiums, consortium('Acer campestre')])
    edit.commit()
    edit.abort()

    expect(currentDesign.value?.consortiums.map((entry) => entry.target)).toEqual([
      consortiumTarget('Quercus robur'),
      consortiumTarget('Acer campestre'),
    ])
    expect(nonCanvasRevision.value).toBe(1)
  })
})
