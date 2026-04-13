import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  downloadTemplate: vi.fn(),
  getTemplatePreview: vi.fn(),
  openDesignAsTemplate: vi.fn(),
}))

vi.mock('../ipc/community', () => ({
  downloadTemplate: mocks.downloadTemplate,
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

beforeEach(() => {
  mocks.downloadTemplate.mockReset()
  mocks.getTemplatePreview.mockReset()
  mocks.openDesignAsTemplate.mockReset()
  selectedTemplate.value = TEMPLATE
  templateImportError.value = null
  templateImporting.value = false
})

describe('template import workflow', () => {
  it('downloads and opens the selected template through document actions', async () => {
    mocks.downloadTemplate.mockResolvedValue('/tmp/template.canopi')
    mocks.openDesignAsTemplate.mockResolvedValue('opened')

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(mocks.downloadTemplate).toHaveBeenCalledWith(TEMPLATE.download_url)
    expect(mocks.openDesignAsTemplate).toHaveBeenCalledWith('/tmp/template.canopi', TEMPLATE.title)
    expect(selectedTemplate.value).toBe(null)
    expect(templateImportError.value).toBe(null)
    expect(templateImporting.value).toBe(false)
  })

  it('captures workflow failures without clearing the current selection', async () => {
    mocks.downloadTemplate.mockRejectedValue(new Error('Network failed'))

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(mocks.openDesignAsTemplate).not.toHaveBeenCalled()
    expect(selectedTemplate.value).toEqual(TEMPLATE)
    expect(templateImportError.value).toContain('Network failed')
    expect(templateImporting.value).toBe(false)
  })

  it('keeps the selected template open when the replacement prompt is cancelled', async () => {
    mocks.downloadTemplate.mockResolvedValue('/tmp/template.canopi')
    mocks.openDesignAsTemplate.mockResolvedValue('cancelled')

    await importTemplateIntoCurrentSession(TEMPLATE)

    expect(selectedTemplate.value).toEqual(TEMPLATE)
    expect(templateImportError.value).toBe(null)
    expect(templateImporting.value).toBe(false)
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
