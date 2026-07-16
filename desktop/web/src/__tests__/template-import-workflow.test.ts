import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireDesignTemplate: vi.fn(),
  getTemplatePreview: vi.fn(),
  openDesignAsTemplate: vi.fn(),
}))

vi.mock('../ipc/community', () => ({
  acquireDesignTemplate: mocks.acquireDesignTemplate,
  getTemplatePreview: mocks.getTemplatePreview,
}))

vi.mock('../app/document-session/actions', () => ({
  openDesignAsTemplate: mocks.openDesignAsTemplate,
}))

import {
  selectedTemplate,
  templateImportError,
  templateImporting,
} from '../app/community/state'
import { importTemplateIntoCurrentSession, selectTemplate } from '../app/community/controller'
import type { TemplateMeta } from '../types/community'
import type { CanopiFile } from '../types/design'

const TEMPLATE: TemplateMeta = {
  id: 'tpl-001',
  title: 'Forest Edge',
  author: 'Canopi',
  description: 'A test template',
  location: { lat: 10, lon: 12, altitude_m: null },
  plant_count: 12,
  climate_zone: 'Temperate',
  tags: ['forest'],
  screenshot_url: null,
  download_url: 'https://templates.canopi.app/tpl-001.canopi',
}

const NEWER_TEMPLATE: TemplateMeta = {
  ...TEMPLATE,
  id: 'tpl-002',
  title: 'Later Forest Edge',
  download_url: 'https://templates.canopi.app/tpl-002.canopi',
}

beforeEach(() => {
  mocks.acquireDesignTemplate.mockReset()
  mocks.getTemplatePreview.mockReset()
  mocks.openDesignAsTemplate.mockReset()
  selectedTemplate.value = TEMPLATE
  templateImportError.value = null
  templateImporting.value = false
})

describe('template import workflow', () => {
  it('acquires and opens the selected template through document actions', async () => {
    const acquired = makeCanopiFile({ name: 'Acquired Template' })
    mocks.acquireDesignTemplate.mockResolvedValue(acquired)
    mocks.openDesignAsTemplate.mockResolvedValue('opened')

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(mocks.acquireDesignTemplate).toHaveBeenCalledWith(TEMPLATE.id)
    expect(mocks.openDesignAsTemplate).toHaveBeenCalledWith(
      acquired,
      TEMPLATE.title,
      { isCancelled: expect.any(Function) },
    )
    expect(selectedTemplate.value).toBe(null)
    expect(templateImportError.value).toBe(null)
    expect(templateImporting.value).toBe(false)
  })

  it('captures workflow failures without clearing the current selection', async () => {
    mocks.acquireDesignTemplate.mockRejectedValue(new Error('Network failed'))

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(mocks.openDesignAsTemplate).not.toHaveBeenCalled()
    expect(selectedTemplate.value).toEqual(TEMPLATE)
    expect(templateImportError.value).toContain('Network failed')
    expect(templateImporting.value).toBe(false)
  })

  it('keeps the selected template open when the replacement prompt is cancelled', async () => {
    mocks.acquireDesignTemplate.mockResolvedValue(makeCanopiFile())
    mocks.openDesignAsTemplate.mockResolvedValue('cancelled')

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(selectedTemplate.value).toEqual(TEMPLATE)
    expect(templateImportError.value).toBe(null)
    expect(templateImporting.value).toBe(false)
  })

  it('does not let an older acquisition open or settle while a newer import is pending', async () => {
    const older = deferred<CanopiFile>()
    const newer = deferred<CanopiFile>()
    mocks.acquireDesignTemplate
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    mocks.openDesignAsTemplate.mockResolvedValue('opened')

    const olderImport = importTemplateIntoCurrentSession(TEMPLATE)
    const newerImport = importTemplateIntoCurrentSession(NEWER_TEMPLATE)

    older.resolve(makeCanopiFile({ name: 'Older Template' }))
    await flushMicrotasks()

    expect(mocks.openDesignAsTemplate).not.toHaveBeenCalled()
    expect(templateImporting.value).toBe(true)
    expect(selectedTemplate.value).toEqual(TEMPLATE)

    const newerFile = makeCanopiFile({ name: 'Newer Template' })
    newer.resolve(newerFile)
    await Promise.all([olderImport, newerImport])

    expect(mocks.openDesignAsTemplate).toHaveBeenCalledOnce()
    expect(mocks.openDesignAsTemplate).toHaveBeenCalledWith(
      newerFile,
      NEWER_TEMPLATE.title,
      { isCancelled: expect.any(Function) },
    )
    expect(templateImporting.value).toBe(false)
    expect(selectedTemplate.value).toBe(null)
  })

  it('does not restore a dismissed preview when an older request resolves late', async () => {
    let resolvePreview: ((value: TemplateMeta) => void) | null = null
    mocks.getTemplatePreview.mockReturnValue(new Promise<TemplateMeta>((resolve) => {
      resolvePreview = resolve
    }))

    const pendingSelection = selectTemplate(TEMPLATE)
    await Promise.resolve()
    await selectTemplate(null)
    resolvePreview!({ ...TEMPLATE, description: 'Loaded preview' })
    await pendingSelection

    expect(selectedTemplate.value).toBe(null)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function makeCanopiFile(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 5,
    name: 'Test Template',
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-07-16T00:00:00.000Z',
    updated_at: '2026-07-16T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
