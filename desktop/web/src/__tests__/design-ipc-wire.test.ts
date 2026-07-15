import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignWriteAdmission } from '../app/document-session/write-admission'
import { prepareDesignWrite, prepareRecoveryWrite } from '../ipc/design'
import { exportSavedObjectStampCanopiFile } from '../ipc/saved-object-stamps'
import type { CanopiFile } from '../types/design'

const invoke = vi.hoisted(() => vi.fn(async (
  _command: string,
  _args?: Record<string, unknown>,
) => '/designs/garden.canopi'))
const selectSavePath = vi.hoisted(() => vi.fn(async () => '/stamps/tree.canopi'))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: selectSavePath,
}))

describe('native Design IPC wire format', () => {
  beforeEach(() => {
    invoke.mockClear()
    selectSavePath.mockClear()
  })

  it('sends canonical root unknown fields to explicit Design saves', async () => {
    const admission = createDesignWriteAdmission()
    const content = testDesign({
      extra: {
        future_top_level: { keep: true },
        name: 'Nested Name',
        version: 6,
      },
    })

    await admission.execute(
      prepareDesignWrite('/designs/garden.canopi'),
      content,
      () => true,
      () => undefined,
    )

    expect(invoke).toHaveBeenCalledWith('save_design', {
      path: '/designs/garden.canopi',
      content: expect.objectContaining({
        name: 'Garden',
        version: 5,
        future_top_level: { keep: true },
      }),
    })
    expect(invokedContent()).not.toHaveProperty('extra')
  })

  it('sends canonical root unknown fields to native autosaves', async () => {
    const admission = createDesignWriteAdmission()
    const content = testDesign({
      extra: {
        future_top_level: { keep: true },
      },
    })

    await admission.execute(
      prepareRecoveryWrite('/designs/garden.canopi'),
      content,
      () => true,
      () => undefined,
    )

    expect(invoke).toHaveBeenCalledWith('autosave_design', {
      path: '/designs/garden.canopi',
      content: expect.objectContaining({
        future_top_level: { keep: true },
      }),
    })
    expect(invokedContent()).not.toHaveProperty('extra')
  })

  it('sends canonical root unknown fields when exporting a Saved Object Stamp', async () => {
    const content = testDesign({
      extra: {
        future_top_level: { keep: true },
      },
    })

    await exportSavedObjectStampCanopiFile(content, 'tree.canopi')

    expect(invoke).toHaveBeenCalledWith('export_saved_object_stamp_canopi_file', {
      path: '/stamps/tree.canopi',
      content: expect.objectContaining({
        future_top_level: { keep: true },
      }),
    })
    expect(invokedContent()).not.toHaveProperty('extra')
  })
})

function invokedContent(): unknown {
  return invoke.mock.calls[0]?.[1]?.content
}

function testDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 5,
    name: 'Garden',
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    extra: {},
    ...overrides,
  }
}
