import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chooseFiles = vi.hoisted(() => vi.fn())
const importIntoNew = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const importIntoLayer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../app/lidar/actions', () => ({
  chooseImportFiles: chooseFiles,
  importSourcesIntoNewLayer: importIntoNew,
  importSourcesIntoLayer: importIntoLayer,
  deleteLidarLayer: vi.fn(),
  fetchLidarLayerDeleteImpact: vi.fn(),
  presentEntity: vi.fn(),
  renameLidarLayer: vi.fn(),
  cancelOpenImport: vi.fn(),
}))

vi.mock('../app/lidar/library-store', async () => {
  const { signal } = await import('@preact/signals')
  return {
    installLidarLibraryObserver: () => () => {},
    lidarLibrary: signal({
      layers: [],
      analyses: [],
      engine: { available: true, version: null, detail: null },
    }),
    lidarStatusMessage: signal<string | null>(null),
    openImportJob: signal<unknown>(null),
    refreshLidarLibrary: vi.fn().mockResolvedValue(undefined),
  }
})

import { DataPanel } from '../components/panels/lidar/DataPanel'
import { lidarLibrary, openImportJob } from '../app/lidar/library-store'
import { locale } from '../app/settings/state'

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(text),
  )
}

/** The commit button, matched exactly: "Import" is a prefix of "Import sources". */
function importButton(container: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => (button.textContent ?? '').trim() === 'Import',
  )
}

describe('Data panel import affordance', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    lidarLibrary.value = { layers: [], analyses: [], engine: { available: true, version: null, detail: null } }
    openImportJob.value = null
    chooseFiles.mockReset()
    importIntoNew.mockClear()
    importIntoLayer.mockClear()
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  /** Choose files through the real control, with the chooser scripted. */
  async function choose(paths: string[] | null): Promise<void> {
    chooseFiles.mockResolvedValue(paths)
    act(() => {
      render(<DataPanel />, container)
    })
    await act(async () => {
      buttonByText(container, 'Import sources')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
  }

  it('offers importing sources as an action even when the library is empty', () => {
    act(() => {
      render(<DataPanel />, container)
    })
    // The empty library is exactly when the primary action matters most; the
    // panel previously showed only its empty-state message.
    expect(buttonByText(container, 'Import sources')).toBeDefined()
  })

  /**
   * The chooser comes first, so cancelling it creates nothing.
   *
   * The previous interaction asked for a name and an interpretation before the
   * user had chosen anything, which left a dataset behind when they then
   * cancelled the chooser.
   */
  it('creates nothing when the chooser is cancelled', async () => {
    await choose(null)
    expect(chooseFiles).toHaveBeenCalledTimes(1)
    expect(importIntoNew).not.toHaveBeenCalled()
    expect(importIntoLayer).not.toHaveBeenCalled()
    // No form, because there is nothing to import.
    expect(importButton(container)).toBeUndefined()
  })

  it('requires an explicit interpretation before importing the chosen files', async () => {
    await choose(['/data/ground.tif', '/data/ground-2.tif'])

    // The chosen files are shown, and the name is suggested from the first one.
    expect(container.textContent).toContain('2 file(s) selected')
    expect(container.textContent).toContain('ground.tif')
    const nameField = container.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(nameField.value).toBe('ground')

    // The form defaults interpretation to unselected, so a filename can never
    // decide the measurement type.
    expect(importButton(container)?.disabled).toBe(true)

    act(() => {
      const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      expect(radios).toHaveLength(4)
      radios[0]?.click()
    })
    expect(importButton(container)?.disabled).toBe(false)
    expect(importIntoNew).not.toHaveBeenCalled()
  })

  it('refuses to import an other continuous dataset before its unit is declared', async () => {
    await choose(['/data/soil.tif'])
    const nameField = container.querySelector<HTMLInputElement>('input[type="text"]')!
    act(() => {
      nameField.value = 'Soil chemistry'
      nameField.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      // Other continuous, the only interpretation with no inherent unit. A real
      // click is required: a dispatched `input` event does not move the control.
      const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      radios[3]?.click()
    })

    // The unit controls appear, and Import stays refused until one is used.
    expect(importButton(container)?.disabled).toBe(true)
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()

    act(() => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    })
    // Stating the unit is unknown is a declaration, so it admits the batch.
    expect(importButton(container)?.disabled).toBe(false)
    expect(importIntoNew).not.toHaveBeenCalled()
  })

  it('imports the chosen files with the name and interpretation the user gave', async () => {
    await choose(['/data/height.tif'])
    const nameField = container.querySelector<HTMLInputElement>('input[type="text"]')!
    act(() => {
      nameField.value = 'Height survey'
      nameField.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      // Above-ground height, so the test proves the choice is forwarded rather
      // than a hard-coded ground elevation.
      radios[2]?.click()
    })

    await act(async () => {
      importButton(container)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    // The selected paths, the edited name and the chosen interpretation all
    // reach the one-step import. Elevation and height have an inherent unit, so
    // no declaration is sent.
    expect(importIntoNew).toHaveBeenCalledWith(
      ['/data/height.tif'],
      'Height survey',
      'AboveGroundHeight',
      { label: null, unknown: false },
    )
  })
  it.each([['Complete', 'Import complete'], ['Cancelled', 'Import cancelled']] as const)(
    'renders the translated %s import outcome', (state, label) => {
      lidarLibrary.value = {
        layers: [{ id: 'layer', name: 'Ground', measurement_kind: 'GroundElevation', units: 'm',
          state: 'Ready', coverage_cells: '256', resolution_m: 1, bounds: null,
          value_range: null, analysis_count: 0, display_range: null, tilesets: [] }],
        analyses: [], engine: { available: true, version: null, detail: null },
      }
      openImportJob.value = { job_id: 'job', layer_id: 'layer', state, message: null, progress: null }
      act(() => { render(<DataPanel />, container) })
      expect(container.querySelector('[role="status"]')?.textContent).toContain(label)
      expect(container.textContent).not.toContain('canvas.lidar.')
    },
  )

})
