import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanopiFile } from '../types/design'

const windowMocks = vi.hoisted(() => ({
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
  minimize: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowMocks,
}))

vi.mock('../components/shared/MenuBar', () => ({
  MenuBar: () => null,
}))

import { locale, theme } from '../app/settings/state'
import { activePanel } from '../app/shell/state'
import {
  currentDesign,
  designDirty,
  designName,
  replaceCurrentDesignState,
  resetDirtyBaselines,
} from '../app/document-session/store'
import { TitleBar } from '../components/shared/TitleBar'

function makeDesign(name: string): CanopiFile {
  return {
    version: 1,
    name,
    description: null,
    location: null,
    north_bearing_deg: null,
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
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
    extra: {},
  }
}

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('TitleBar', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    theme.value = 'light'
    activePanel.value = 'canvas'
    replaceCurrentDesignState(makeDesign('Untitled'), null, 'Untitled')
    resetDirtyBaselines()
    windowMocks.startDragging.mockClear()
    windowMocks.toggleMaximize.mockClear()
    windowMocks.minimize.mockClear()
    windowMocks.close.mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('edits the Design name from the title bar without persisting unchanged fallback text', async () => {
    await act(async () => {
      render(<TitleBar />, container)
      await flushEffects()
    })

    const nameButton = container.querySelector<HTMLButtonElement>('button[aria-label="Rename design name"]')
    expect(nameButton).toBeTruthy()
    expect(nameButton?.textContent).toContain('Untitled Design')

    await act(async () => {
      nameButton!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
      await flushEffects()
    })

    let input = container.querySelector<HTMLInputElement>('input[aria-label="Design name"]')
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(input?.value).toBe('Untitled Design')
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe('Untitled Design'.length)
    expect(windowMocks.toggleMaximize).not.toHaveBeenCalled()
    expect(windowMocks.startDragging).not.toHaveBeenCalled()

    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flushEffects()
    })

    expect(designName.value).toBe('Untitled')
    expect(currentDesign.value?.name).toBe('Untitled')
    expect(designDirty.value).toBe(false)

    const fallbackButton = container.querySelector<HTMLButtonElement>('button[aria-label="Rename design name"]')
    await act(async () => {
      fallbackButton!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
      await flushEffects()
    })

    input = container.querySelector<HTMLInputElement>('input[aria-label="Design name"]')
    expect(input).toBeTruthy()

    await act(async () => {
      input!.value = 'Forest Edge'
      input!.dispatchEvent(new Event('input', { bubbles: true }))
      await flushEffects()
    })
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flushEffects()
    })

    expect(designName.value).toBe('Forest Edge')
    expect(currentDesign.value?.name).toBe('Forest Edge')
    expect(designDirty.value).toBe(true)
    expect(container.textContent).toContain('Forest Edge')
  })
})
