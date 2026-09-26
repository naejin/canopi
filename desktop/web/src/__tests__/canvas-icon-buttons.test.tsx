import { signal } from '@preact/signals'
import { render, type ComponentChildren } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#geocoding-transport', () => ({ geocodingTransport: vi.fn(async () => []) }))

const inspection = vi.hoisted(() => ({ target: null as unknown }))
vi.mock('../app/lidar/inspection', async () => {
  const { signal: makeSignal } = await import('@preact/signals')
  const target = makeSignal<{ name: string } | null>(null)
  inspection.target = target
  return {
    inspectionTarget: target,
    inspectionSample: makeSignal({ kind: 'idle' }),
    inspectionLocation: makeSignal(null),
    endInspection: vi.fn(),
    sampleInspectionCentre: vi.fn(),
  }
})

import type { CanvasInspectionHandle } from '../canvas/inspection'
import type { CameraViewportSnapshot } from '../canvas/runtime/camera'
import { setCurrentCanvasSession } from '../canvas/session'
import type { CanvasLayerPresentationRow } from '../app/canvas-layer-presentation/presentation'
import { ToolRail } from '../components/canvas/ToolRail'
import { workspaceCanvasCommandProjection } from '../app/workspace-commands/canvas-actions'
import { WorkspaceTitleBar } from '../components/shared/WorkspaceTitleBar'
import { PanelRail } from '../components/shared/PanelRail'
import { ZoomControls } from '../components/canvas/ZoomControls'
import { InspectionLens } from '../components/canvas/InspectionLens'
import { InspectionStatus } from '../components/canvas/InspectionStatus'
import { SpeciesFocusChip } from '../components/canvas/SpeciesFocusChip'
import { CanvasOverview } from '../components/canvas/CanvasOverview'
import { LayerPanel, type LayerPanelActions } from '../components/canvas/LayerPanel'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasDocumentSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

/** A button is icon-only when, ignoring its tooltip, it shows no letters or digits. */
function isIconOnly(button: HTMLButtonElement): boolean {
  const clone = button.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[role="tooltip"]').forEach((node) => node.remove())
  return !/[\p{L}\p{N}]/u.test(clone.textContent ?? '')
}

function expectIconButtonsFollowRules(root: ParentNode, minimum: number): void {
  // Listbox options (colour swatches) are choices, not commands; they are exempt.
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not([role="option"])'))
    .filter(isIconOnly)
  expect(buttons.length).toBeGreaterThanOrEqual(minimum)
  for (const button of buttons) {
    const label = button.getAttribute('aria-label')?.trim() ?? ''
    expect(label, button.outerHTML).not.toBe('')
    const tooltip = button.querySelector('[role="tooltip"]')
    expect(tooltip, `missing ButtonTooltip: ${label}`).not.toBeNull()
    const name = tooltip!.firstElementChild?.textContent?.trim() ?? ''
    expect(name, `empty tooltip: ${label}`).not.toBe('')
    expect(label).toContain(name)
    if (button.hasAttribute('aria-keyshortcuts')) {
      expect(tooltip!.children.length, `missing shortcut hint: ${label}`).toBeGreaterThan(1)
    }
  }
}

const viewport = signal<CameraViewportSnapshot>({
  viewport: { x: 200, y: 150, scale: 0.01 },
  screenSize: { width: 400, height: 300 },
  devicePixelRatio: 1,
  referenceScale: 20,
  scaleBounds: { minimum: 0.00001, maximum: 2000 },
  overviewScaleThreshold: 0.1,
  mode: 'overview',
  groundMetersPerCssPixel: 100,
  revision: 1,
})

function row(id: string, overrides: Partial<CanvasLayerPresentationRow>): CanvasLayerPresentationRow {
  return {
    id, label: id, authority: 'scene', active: false, visible: true, opacity: 1, locked: false,
    canLock: true, detail: { type: 'scene' }, ...overrides,
  }
}

describe('canvas icon-only buttons', () => {
  let container: HTMLDivElement
  const mount = async (node: ComponentChildren) => {
    await act(async () => {
      render(node, container)
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const view: CanvasInspectionHandle = {
      state: signal({ point: { x: 0, y: 0 }, scale: 10, zoomPercent: 700, previewAvailable: true,
        frame: { width: 430, height: 390 }, plants: [] }),
      inspectAtScreenPoint: vi.fn(), centerOnCanvas: vi.fn(), panBy: vi.fn(), zoomBy: vi.fn(),
      highlightPlant: vi.fn(), focusPlant: vi.fn(), dispose: vi.fn(),
    }
    const queries = createTestCanvasQuerySurface()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: {
        ...queries,
        viewport,
        getSpeciesFocus: () => ({ canonicalName: 'Malus domestica' }),
      } as typeof queries,
      documents: createTestCanvasDocumentSurface({ attachInspectionTo: vi.fn(() => view) }),
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    ;(inspection.target as ReturnType<typeof signal>).value = null
    setCurrentCanvasSession(null)
  })

  it('labels every icon-only tool and history button on the rail with a tooltip and shortcut hint', async () => {
    await mount(<ToolRail projection={workspaceCanvasCommandProjection.value} showNames={false} />)
    expectIconButtonsFollowRules(container, 13)
  })

  it('labels the zoom buttons with tooltips and their View shortcuts', async () => {
    await mount(<ZoomControls viewActions={workspaceCanvasCommandProjection.value.viewActions} />)
    expectIconButtonsFollowRules(container, 3)
    for (const button of Array.from(container.querySelectorAll('button')).filter(isIconOnly)) {
      expect(button.getAttribute('aria-keyshortcuts'), button.getAttribute('aria-label') ?? '').toBeTruthy()
    }
  })

  it('labels the lens launcher, title-bar icons and panel rail', async () => {
    const host = { current: document.createElement('div') }
    const command = (label: string, shortcut: string) => ({ label, shortcut, ariaShortcut: shortcut, action: vi.fn() })
    await mount(<>
      <InspectionLens canvasRef={host} />
      <WorkspaceTitleBar menus={[]} help={command('Keyboard shortcuts', 'F1')} settings={command('Settings…', 'Ctrl ,')} />
      <PanelRail label="Panels" groups={[[{ panel: 'layers', label: 'Layers', shortcut: 'Ctrl 1', ariaShortcut: 'Control+1', disabled: false, action: vi.fn() }]]} />
    </>)
    expectIconButtonsFollowRules(container, 4)
  })

  it('labels every control inside the open inspection lens', async () => {
    const host = { current: document.createElement('div') }
    await mount(<InspectionLens canvasRef={host} />)
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())
    // Expand, close, recentre, widen and magnify.
    expectIconButtonsFollowRules(container, 5)
  })

  it('labels the raster inspection dismiss control', async () => {
    ;(inspection.target as ReturnType<typeof signal>).value = { name: 'Slope' }
    await mount(<InspectionStatus />)
    expectIconButtonsFollowRules(container, 1)
  })

  it('labels layer row visibility and lock buttons', async () => {
    const actions: LayerPanelActions = {
      active: vi.fn(), visibility: vi.fn(), locked: vi.fn(), opacity: vi.fn(),
    }
    const rows = [
      row('plants', { active: true, count: 3 }),
      row('zones', { locked: true }),
      row('hillshade', { authority: 'map-layers', canLock: false, detail: { type: 'hillshade' } }),
    ]
    await mount(<LayerPanel rows={rows} actions={actions} />)
    expectIconButtonsFollowRules(container, 5)
  })

  it('keeps text canvas controls free of unlabeled icon buttons', async () => {
    await mount(<><SpeciesFocusChip /><CanvasOverview /></>)
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0)
    expectIconButtonsFollowRules(container, 0)
  })
})
