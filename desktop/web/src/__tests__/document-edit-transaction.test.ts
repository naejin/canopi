import { effect } from '@preact/signals'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginDesignArrayEdit,
  DesignEditBusyError,
  reconcileCurrentDesign,
} from '../app/design-edit'
import { createDesignSessionPersistence } from '../app/document-session/persistence'
import { designSessionStore } from '../app/document-session/store'
import { prepareDesignWriteDestination } from '../app/document-session/write-admission'
import { consortiumTarget } from '../target'
import {
  designSessionFixture,
  currentDesign,
  designDirty,
  nonCanvasRevision,
} from './support/design-session-state'
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
    budget_currency: 'EUR',
    created_at: '',
    updated_at: '',
    extra: {},
    ...overrides,
  }
}

beforeEach(() => {
  designSessionFixture.nonCanvasRevision = 0
  designSessionFixture.nonCanvasSavedRevision = 0
  designSessionFixture.file = design()
  designSessionFixture.path = '/designs/test.canopi'
  designSessionFixture.name = 'test'
})

describe('Design Edit array transactions', () => {
  it('persists committed content while a preview stays visible and later commits dirty', async () => {
    const persistence = createDesignSessionPersistence({ store: designSessionStore })
    const written: CanopiFile[] = []
    const edit = beginDesignArrayEdit('timeline')
    try {
      edit.preview((timeline) => timeline.map((action) => (
        action.id === 'a' ? { ...action, description: 'preview' } : action
      )))

      expect(currentDesign.value?.timeline[0]?.description).toBe('preview')

      const settlement = await persistence.beginSave().execute(
        prepareDesignWriteDestination({
          resource: 'native-design:/designs/test.canopi',
          destinationPath: '/designs/test.canopi',
          write: (content) => {
            written.push(content)
          },
        }),
      )

      expect(settlement.status).toBe('applied')
      expect(written[0]?.timeline[0]?.description).toBe('initial')

      edit.commit()

      expect(currentDesign.value?.timeline[0]?.description).toBe('preview')
      expect(designDirty.value).toBe(true)
    } finally {
      edit.abort()
      persistence.dispose()
    }
  })

  it('stays clean when a visible preview aborts after committed content was saved', async () => {
    const persistence = createDesignSessionPersistence({ store: designSessionStore })
    const written: CanopiFile[] = []
    const edit = beginDesignArrayEdit('timeline')
    try {
      edit.preview((timeline) => timeline.map((action) => (
        action.id === 'a' ? { ...action, description: 'preview' } : action
      )))

      await persistence.beginSave().execute(
        prepareDesignWriteDestination({
          resource: 'native-design:/designs/test.canopi',
          destinationPath: '/designs/test.canopi',
          write: (content) => {
            written.push(content)
          },
        }),
      )
      edit.abort()

      expect(written[0]?.timeline[0]?.description).toBe('initial')
      expect(currentDesign.value?.timeline[0]?.description).toBe('initial')
      expect(designDirty.value).toBe(false)
    } finally {
      edit.abort()
      persistence.dispose()
    }
  })

  it('aborts only the preview while preserving a committed reconciliation', () => {
    const edit = beginDesignArrayEdit('consortiums')
    edit.preview((consortiums) => consortiums.map((entry) => ({
      ...entry,
      start_phase: 1,
    })))

    reconcileCurrentDesign((design) => ({
      ...design,
      consortiums: [...design.consortiums, consortium('Acer campestre')],
    }))

    expect(currentDesign.value?.consortiums).toMatchObject([
      { start_phase: 1 },
      { target: consortiumTarget('Acer campestre') },
    ])

    edit.abort()

    expect(currentDesign.value?.consortiums).toMatchObject([
      { start_phase: 0 },
      { target: consortiumTarget('Acer campestre') },
    ])
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('publishes no committed or visible state when preview replay fails', () => {
    const persistence = createDesignSessionPersistence({ store: designSessionStore })
    const edit = beginDesignArrayEdit('timeline')
    let replayFails = false
    try {
      edit.preview((timeline) => {
        if (replayFails) throw new Error('preview replay failed')
        return timeline.map((action) => (
          action.id === 'a' ? { ...action, description: 'preview' } : action
        ))
      })
      replayFails = true

      expect(() => designSessionStore.replaceCurrentDesignSnapshot(design({
        description: 'new committed snapshot',
      }))).toThrow('preview replay failed')

      expect(currentDesign.value?.description).toBeNull()
      expect(currentDesign.value?.timeline[0]?.description).toBe('preview')
      expect(persistence.captureObservation(null)?.description).toBeNull()
      expect(nonCanvasRevision.value).toBe(0)
    } finally {
      replayFails = false
      edit.abort()
      persistence.dispose()
    }
  })

  it('rejects a competing preview before changing either Design projection', () => {
    const edit = beginDesignArrayEdit('timeline')
    try {
      edit.preview((timeline) => timeline.map((action) => (
        action.id === 'a' ? { ...action, description: 'preview' } : action
      )))

      let failure: unknown
      try {
        beginDesignArrayEdit('consortiums')
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DesignEditBusyError)
      expect(currentDesign.value?.timeline[0]?.description).toBe('preview')
      expect(currentDesign.value?.consortiums).toEqual([
        consortium('Quercus robur'),
      ])
      expect(nonCanvasRevision.value).toBe(0)
    } finally {
      edit.abort()
    }
  })

  it('permanently invalidates a replacement guard after preview activity', () => {
    const persistence = createDesignSessionPersistence({ store: designSessionStore })
    const guard = persistence.beginReplacementGuard().guard
    expect(guard?.isCurrent()).toBe(true)

    const edit = beginDesignArrayEdit('timeline')
    try {
      expect(guard?.isCurrent()).toBe(false)

      edit.preview((timeline) => timeline.map((action) => (
        action.id === 'a' ? { ...action, description: 'preview' } : action
      )))

      expect(guard?.isCurrent()).toBe(false)

      edit.abort()

      expect(guard?.isCurrent()).toBe(false)
    } finally {
      edit.abort()
      persistence.dispose()
    }
  })

  it('keeps late preview callbacks inert after a replacement Design is installed', () => {
    const edit = beginDesignArrayEdit('timeline')
    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'predecessor preview' } : action
    )))
    const successor = design({
      name: 'Successor',
      timeline: [timelineAction('successor', { description: 'successor committed' })],
    })

    designSessionStore.resetDirtyBaselines()
    designSessionStore.replaceCurrentDesignState(
      successor,
      '/designs/successor.canopi',
      successor.name,
    )

    edit.preview(() => [timelineAction('late-preview', { description: 'late preview' })])
    edit.commit()
    edit.abort()

    expect(currentDesign.value).toBe(successor)
    expect(currentDesign.value?.timeline).toEqual([
      timelineAction('successor', { description: 'successor committed' }),
    ])
    expect(designDirty.value).toBe(false)
  })

  it('invalidates the predecessor before reactive successor publication', () => {
    const edit = beginDesignArrayEdit('timeline')
    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'predecessor preview' } : action
    )))
    const successor = design({
      name: 'Successor',
      timeline: [timelineAction('successor', { description: 'successor committed' })],
    })
    let invokeLateCallbacks = false
    let observedName: string | null = null
    const dispose = effect(() => {
      const visible = currentDesign.value
      if (!invokeLateCallbacks || visible?.name !== 'Successor') return
      observedName = visible.name
      edit.preview(() => [timelineAction('late-preview', { description: 'late preview' })])
      edit.commit()
      edit.abort()
    })

    try {
      designSessionStore.resetDirtyBaselines()
      invokeLateCallbacks = true
      designSessionStore.replaceCurrentDesignState(
        successor,
        '/designs/successor.canopi',
        successor.name,
      )

      expect(observedName).toBe('Successor')
      expect(currentDesign.value).toBe(successor)
      expect(currentDesign.value?.timeline[0]?.description).toBe('successor committed')
      expect(designDirty.value).toBe(false)
    } finally {
      dispose()
    }
  })

  it('previews document array updates without advancing the non-canvas revision', () => {
    const edit = beginDesignArrayEdit('timeline')

    edit.preview((timeline) => timeline.map((action) => (
      action.id === 'a' ? { ...action, description: 'preview' } : action
    )))

    expect(currentDesign.value?.timeline[0]?.description).toBe('preview')
    expect(edit.hasMutated).toBe(true)
    expect(nonCanvasRevision.value).toBe(0)

    edit.abort()
  })

  it('commits one dirty revision after one or many preview mutations', () => {
    const edit = beginDesignArrayEdit('timeline')

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
    const edit = beginDesignArrayEdit('timeline')

    edit.preview((timeline) => timeline)
    edit.commit()

    expect(edit.hasMutated).toBe(false)
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('aborts by restoring the original document slice without dirtying the document', () => {
    const original = currentDesign.value!.consortiums
    const edit = beginDesignArrayEdit('consortiums')

    edit.preview((consortiums) => [...consortiums, consortium('Acer campestre')])
    edit.abort()
    edit.abort()

    expect(currentDesign.value?.consortiums).toBe(original)
    expect(currentDesign.value?.consortiums.map((entry) => entry.target)).toEqual([consortiumTarget('Quercus robur')])
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('keeps commit and abort cleanup idempotent after a transaction closes', () => {
    const edit = beginDesignArrayEdit('consortiums')

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
