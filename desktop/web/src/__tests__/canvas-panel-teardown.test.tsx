import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPanel } from '../components/panels/CanvasPanel'
import { currentDesign } from '../state/document'

const mocks = vi.hoisted(() => ({
  initMock: vi.fn(async () => {}),
  initializeViewportMock: vi.fn(),
  attachRulersToMock: vi.fn(),
  showCanvasChromeMock: vi.fn(),
  hideCanvasChromeMock: vi.fn(),
  resizeMock: vi.fn(),
  destroyMock: vi.fn(),
  snapshotCanvasIntoCurrentDocumentMock: vi.fn(),
  disposeDocumentWorkflowsMock: vi.fn(),
  installConsortiumSyncMock: vi.fn(),
  consumeQueuedDocumentLoadMock: vi.fn(() => () => {}),
  writeCanvasIntoDocumentMock: vi.fn(() => ''),
  setCurrentCanvasSessionMock: vi.fn(),
  getCurrentCanvasSessionMock: vi.fn(() => null),
}))

vi.mock('../components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div />,
}))

vi.mock('../components/canvas/DisplayLegend', () => ({
  DisplayLegend: () => <div />,
}))

vi.mock('../components/canvas/DisplayModeControls', () => ({
  DisplayModeControls: () => <div />,
}))

vi.mock('../components/canvas/ZoomControls', () => ({
  ZoomControls: () => <div />,
}))

vi.mock('../components/canvas/BottomPanelLauncher', () => ({
  BottomPanelLauncher: () => <div />,
}))

vi.mock('../components/canvas/BottomPanel', () => ({
  BottomPanel: () => <div />,
}))

vi.mock('../components/canvas/LayerPanel', () => ({
  LayerPanel: () => <div />,
}))

vi.mock('../components/shared/WelcomeScreen', () => ({
  WelcomeScreen: () => <div />,
}))

vi.mock('../components/canvas/MapLibreCanvasSurface', () => ({
  MapLibreCanvasSurface: () => <div />,
}))

vi.mock('../canvas/session', () => ({
  getCurrentCanvasSession: mocks.getCurrentCanvasSessionMock,
  setCurrentCanvasSession: mocks.setCurrentCanvasSessionMock,
}))

vi.mock('../canvas/runtime/scene-runtime', () => ({
  SceneCanvasRuntime: class {
    init = mocks.initMock
    initializeViewport = mocks.initializeViewportMock
    attachRulersTo = mocks.attachRulersToMock
    showCanvasChrome = mocks.showCanvasChromeMock
    hideCanvasChrome = mocks.hideCanvasChromeMock
    resize = mocks.resizeMock
    destroy = mocks.destroyMock
  },
}))

vi.mock('../state/document', async () => {
  const actual = await vi.importActual<typeof import('../state/document')>('../state/document')
  return {
    ...actual,
    consumeQueuedDocumentLoad: mocks.consumeQueuedDocumentLoadMock,
    disposeDocumentWorkflows: mocks.disposeDocumentWorkflowsMock,
    installConsortiumSync: mocks.installConsortiumSyncMock,
    snapshotCanvasIntoCurrentDocument: mocks.snapshotCanvasIntoCurrentDocumentMock,
    writeCanvasIntoDocument: mocks.writeCanvasIntoDocumentMock,
  }
})

vi.mock('../ipc/design', () => ({
  autosaveDesign: vi.fn(async () => undefined),
}))

describe('CanvasPanel teardown', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    currentDesign.value = {
      version: 2,
      name: 'Demo',
      description: null,
      location: null,
      north_bearing_deg: 0,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    mocks.initMock.mockClear()
    mocks.initializeViewportMock.mockClear()
    mocks.attachRulersToMock.mockClear()
    mocks.showCanvasChromeMock.mockClear()
    mocks.hideCanvasChromeMock.mockClear()
    mocks.resizeMock.mockClear()
    mocks.destroyMock.mockClear()
    mocks.snapshotCanvasIntoCurrentDocumentMock.mockClear()
    mocks.disposeDocumentWorkflowsMock.mockClear()
    mocks.installConsortiumSyncMock.mockClear()
    mocks.consumeQueuedDocumentLoadMock.mockClear()
    mocks.setCurrentCanvasSessionMock.mockClear()
    mocks.getCurrentCanvasSessionMock.mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('snapshots the document before clearing the active session on teardown', async () => {
    await act(async () => {
      render(<CanvasPanel />, container)
    })

    await act(async () => {
      render(null, container)
    })

    expect(mocks.snapshotCanvasIntoCurrentDocumentMock).toHaveBeenCalledTimes(1)
    expect(mocks.destroyMock).toHaveBeenCalledTimes(1)
    expect(mocks.setCurrentCanvasSessionMock).toHaveBeenLastCalledWith(null)

    const snapshotOrder = mocks.snapshotCanvasIntoCurrentDocumentMock.mock.invocationCallOrder[0]
    const sessionCalls = mocks.setCurrentCanvasSessionMock.mock.invocationCallOrder
    const clearSessionOrder = sessionCalls[sessionCalls.length - 1]
    expect(snapshotOrder).toBeLessThan(clearSessionOrder ?? Number.POSITIVE_INFINITY)
  })
})
