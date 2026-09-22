import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createLayer = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const startImport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../app/lidar/actions', () => ({
  createLidarLayer: createLayer,
  deleteLidarLayer: vi.fn(),
  fetchLidarLayerDeleteImpact: vi.fn(),
  presentEntity: vi.fn(),
  renameLidarLayer: vi.fn(),
  startImportForLayer: startImport,
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
    refreshLidarLibrary: vi.fn().mockResolvedValue(undefined),
  }
})

import { DataPanel } from '../components/panels/lidar/DataPanel'
import { locale } from '../app/settings/state'

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    (button.textContent ?? '').includes(text),
  )
}

describe('Data panel import affordance', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    locale.value = 'en'
    createLayer.mockClear()
    startImport.mockClear()
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('offers importing sources as an action even when the library is empty', () => {
    act(() => {
      render(<DataPanel />, container)
    })
    // The empty library is exactly when the primary action matters most; the
    // panel previously showed only its empty-state message.
    expect(buttonByText(container, 'Import sources')).toBeDefined()
  })

  it('requires an explicit interpretation before creating the dataset', async () => {
    act(() => {
      render(<DataPanel />, container)
    })
    act(() => {
      buttonByText(container, 'Import sources')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    const create = buttonByText(container, 'Create dataset')
    // The form defaults interpretation to unselected, so a filename can never
    // decide the measurement type.
    expect(create?.disabled).toBe(true)

    const nameField = container.querySelector<HTMLInputElement>('input[type="text"]')
    expect(nameField).not.toBeNull()
    act(() => {
      if (nameField) {
        nameField.value = 'Ground survey'
        nameField.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    // Still refused: a name alone is not an interpretation.
    expect(buttonByText(container, 'Create dataset')?.disabled).toBe(true)

    act(() => {
      const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      expect(radios).toHaveLength(4)
      radios[0]?.click()
    })
    expect(buttonByText(container, 'Create dataset')?.disabled).toBe(false)
    expect(createLayer).not.toHaveBeenCalled()
  })

  it('refuses to create an other continuous dataset before its unit is declared', async () => {
    act(() => {
      render(<DataPanel />, container)
    })
    act(() => {
      buttonByText(container, 'Import sources')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
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

    // The unit controls appear, and Create stays refused until one is used.
    expect(buttonByText(container, 'Create dataset')?.disabled).toBe(true)
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()

    act(() => {
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    })
    // Stating the unit is unknown is a declaration, so it admits the dataset.
    expect(buttonByText(container, 'Create dataset')?.disabled).toBe(false)
    expect(createLayer).not.toHaveBeenCalled()
  })

  it('creates the dataset with the chosen name and interpretation', async () => {
    act(() => {
      render(<DataPanel />, container)
    })
    act(() => {
      buttonByText(container, 'Import sources')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
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
      buttonByText(container, 'Create dataset')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })

    // Elevation and height have an inherent unit, so no declaration is sent.
    expect(createLayer).toHaveBeenCalledWith('Height survey', 'AboveGroundHeight', {
      label: null,
      unknown: false,
    })
  })
})
