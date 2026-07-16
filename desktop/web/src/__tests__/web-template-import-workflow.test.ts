import { describe, expect, it, vi } from 'vitest'
import { importDesignTemplateIntoCurrentSession } from '../app/design-template-import/workflow.browser'
import type { TemplateMeta } from '../types/community'
import type { CanopiFile } from '../types/design'

const TEMPLATE: TemplateMeta = {
  id: 'forest-edge',
  title: 'Forest Edge',
  author: 'Canopi',
  description: 'A static bundled template',
  location: { lat: 45.5, lon: -73.6, altitude_m: null },
  plant_count: 18,
  climate_zone: 'Temperate',
  tags: ['forest'],
  screenshot_url: null,
  download_url: '/app/templates/forest-edge.canopi',
}

describe('Web Edition Design Template import workflow', () => {
  it('fetches a configured static .canopi asset and opens it as a browser template', async () => {
    const templateFile = makeCanopiFile({ name: 'Downloaded Template' })
    const templateText = JSON.stringify(templateFile)
    const fetchTemplateAsset = vi.fn(async () => new Response(templateText))
    const openCanopiTemplate = vi.fn(async () => 'opened' as const)

    await expect(importDesignTemplateIntoCurrentSession(TEMPLATE, {
      baseUrl: 'https://web.canopi.test/app/',
      fetchTemplateAsset,
      openCanopiTemplate,
    })).resolves.toBe('opened')

    expect(fetchTemplateAsset).toHaveBeenCalledWith('https://web.canopi.test/app/templates/forest-edge.canopi')
    expect(openCanopiTemplate).toHaveBeenCalledWith({
      name: 'Forest Edge',
      file: templateFile,
    })
  })

  it('rejects malformed static assets at the Web ingestion boundary before opening', async () => {
    const fetchTemplateAsset = vi.fn(async () => new Response(JSON.stringify({
      ...makeCanopiFile(),
      zones: [{ name: 'missing fields' }],
    })))
    const openCanopiTemplate = vi.fn(async () => 'opened' as const)

    await expect(importDesignTemplateIntoCurrentSession(TEMPLATE, {
      baseUrl: 'https://web.canopi.test/app/',
      fetchTemplateAsset,
      openCanopiTemplate,
    })).rejects.toThrow('$.zones[0].points: missing required value')

    expect(openCanopiTemplate).not.toHaveBeenCalled()
  })

  it('rejects arbitrary remote template URLs before fetching', async () => {
    const fetchTemplateAsset = vi.fn(async () => new Response(''))
    const openCanopiTemplate = vi.fn(async () => 'opened' as const)

    await expect(importDesignTemplateIntoCurrentSession({
      ...TEMPLATE,
      download_url: 'https://templates.example.net/forest-edge.canopi',
    }, {
      baseUrl: 'https://web.canopi.test/app/',
      fetchTemplateAsset,
      openCanopiTemplate,
    })).rejects.toThrow('Static Design Template asset origin is not allowed')

    expect(fetchTemplateAsset).not.toHaveBeenCalled()
    expect(openCanopiTemplate).not.toHaveBeenCalled()
  })
})

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
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-02T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
