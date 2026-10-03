// The compass (spec §4.2, ADR 0015): always in the zoom group, a click or Enter/Space resets north, a drag on its face
// turns the view about the screen centre with Shift for 15° steps, and Esc during a drag restores the starting camera
// through the real key router (fixture I9).
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workspaceCanvasCommandProjection } from '../../app/workspace-commands/canvas-actions'
import type { KeyRouterHandle } from '../../app/keyboard/key-router'
import { createCanvasKeyboardPort } from '../../canvas/runtime/keyboard-port'
import type { ToolHost } from '../../canvas/runtime/interaction-ports'
import type { CanvasKeyboardPort } from '../../canvas/runtime/runtime'
import { createViewReadSurface } from '../../canvas/runtime/view/frame-source'
import type { ViewFrameSource } from '../../canvas/runtime/view/types'
import { setCurrentCanvasSession } from '../../canvas/session'
import { createSessionPlane } from '../../canvas/session-plane'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from '../../__tests__/support/canvas-runtime-surfaces'
import { installCanvasKeyRouter } from '../../__tests__/support/key-router'
import { createTestView, type TestView } from '../../__tests__/support/test-view'
import { Compass } from './Compass'

/** A tween and its frame: the 300 ms turn, with room for the last frame. */
const TURN_MS = 320
/** The compass's centre on screen; its box is a 28 px button about it. */
const CENTRE = { x: 100, y: 100 }

let container: HTMLDivElement
let view: TestView
let router: KeyRouterHandle | null

function mount(bearingDeg: number): void {
  const plane = createSessionPlane({ lon: 0, lat: 0 })
  view = createTestView({ plane, screen: { width: 800, height: 600 }, camera: { bearingDeg } })
  const { navigation } = view
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
    queries: { ...createTestCanvasQuerySurface(), view: createViewReadSurface(view.frames, () => plane) },
    commands: createTestCanvasCommandSurface({
      viewport: {
        resetNorth: () => navigation.resetNorth(),
        rotateBy: (direction) => navigation.rotateBy(direction),
        beginRotation: (pivot) => navigation.beginRotation(pivot),
      },
    }),
  }))
  const command = workspaceCanvasCommandProjection.value.viewActions.find((action) => action.id === 'reset-north')!
  act(() => { render(<Compass command={command} className="button" />, container) })
  compass().getBoundingClientRect = () => new DOMRect(CENTRE.x - 14, CENTRE.y - 14, 28, 28)
}

const compass = () => container.querySelector<HTMLButtonElement>('button[data-compass]')!
const bearing = () => view.view().camera.bearingDeg
const description = () => document.getElementById(compass().getAttribute('aria-describedby') ?? '')?.textContent

/** The point at `deg` around the compass centre on screen (0 = right, 90 = down: clockwise as the screen turns). */
function around(deg: number, radius = 12): { x: number; y: number } {
  const rad = deg * Math.PI / 180
  return { x: CENTRE.x + radius * Math.cos(rad), y: CENTRE.y + radius * Math.sin(rad) }
}

function pointer(target: EventTarget, type: string, point: { x: number; y: number }, init: MouseEventInit = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: point.x, clientY: point.y, ...init })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  Object.defineProperty(event, 'isPrimary', { value: true })
  act(() => { target.dispatchEvent(event) })
}

/** The click a browser sends for a pointer press: its detail counts the presses, unlike a screen reader's or a script's. */
function pointerClick(): void {
  act(() => { compass().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })) })
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => { target.dispatchEvent(event) })
  return event
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  router = null
})

afterEach(() => {
  router?.dispose()
  act(() => { render(null, container) })
  setCurrentCanvasSession(null)
  view.dispose()
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('Compass', () => {
  it('always visible', () => {
    mount(0)
    expect(compass()).not.toBeNull()
    expect(compass().getAttribute('aria-label')).toBe('Reset north')
    expect(compass().getAttribute('aria-disabled')).toBeNull()
    expect(compass().hasAttribute('title')).toBe(false)
    expect(compass().getAttribute('aria-keyshortcuts')?.split(' ')).toEqual(expect.arrayContaining(['N', 'Shift+N']))
    expect(description()).toBe('North is up')
    expect(compass().dataset.turned).toBeUndefined()
    // The tooltip names the command with its key and the hint as its second line.
    const tooltip = compass().querySelector('[role="tooltip"]')!
    expect(tooltip.textContent).toContain('Reset north')
    expect(tooltip.textContent).toContain('Drag the ring to turn the view')

    act(() => { view.navigation.showCamera({ ...view.view().camera, bearingDeg: 30 }) })
    expect(description()).toBe('View turned 30° from north')
    expect(compass().dataset.turned).toBe('true')
    // The needle points to true north: turned by −bearing.
    expect(compass().querySelector('[data-needle]')?.getAttribute('transform')).toBe('rotate(-30 10 10)')
  })

  it('click resets north', () => {
    vi.useFakeTimers()
    mount(30)
    act(() => { compass().click() })
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)
  })

  it('ring drag turns and Shift steps on each move', () => {
    mount(30)
    pointer(compass(), 'pointerdown', around(-90))
    expect(document.activeElement).toBe(compass())
    // 22° counter-clockwise around the face raises the bearing by 22°.
    pointer(compass(), 'pointermove', around(-112))
    expect(bearing()).toBeCloseTo(52, 6)
    expect(compass().dataset.dragging).toBe('true')
    pointer(compass(), 'pointermove', around(-112), { shiftKey: true })
    expect(bearing()).toBeCloseTo(45, 6)
    pointer(compass(), 'pointermove', around(-112))
    expect(bearing()).toBeCloseTo(52, 6)
    pointer(compass(), 'pointerup', around(-112))
    pointerClick()
    // A drag is not a click: the release keeps the turned view.
    expect(bearing()).toBeCloseTo(52, 6)
    expect(compass().dataset.dragging).toBeUndefined()
  })

  it('a clockwise drag around the face lowers the bearing', () => {
    mount(30)
    pointer(compass(), 'pointerdown', around(-90))
    pointer(compass(), 'pointermove', around(-70))
    expect(bearing()).toBeCloseTo(10, 6)
    // On round the face and past its left, where the pointer's angle wraps, without a jump: 290° swept in all.
    for (const deg of [0, 90, 170, 200]) pointer(compass(), 'pointermove', around(deg))
    expect(bearing()).toBeCloseTo(100, 6)
  })

  it('a press on the needle that drifts past 3 px turns nothing and is no click', () => {
    vi.useFakeTimers()
    mount(30)
    // A press lands on the needle beside the centre and rolls 3.6 px across it: past 3 px it is a drag (spec §4.2), and
    // near the centre the pointer's angle means nothing, so the view does not turn.
    pointer(compass(), 'pointerdown', { x: CENTRE.x + 1, y: CENTRE.y })
    pointer(compass(), 'pointermove', { x: CENTRE.x - 2, y: CENTRE.y + 2 })
    expect(bearing()).toBe(30)
    pointer(compass(), 'pointerup', { x: CENTRE.x - 2, y: CENTRE.y + 2 })
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(30)
  })

  it('a drag from the face into the needle is no click', () => {
    vi.useFakeTimers()
    mount(30)
    // 10 px of travel straight in to the centre: a drag, so its release does not reset north.
    pointer(compass(), 'pointerdown', { x: CENTRE.x + 10, y: CENTRE.y })
    pointer(compass(), 'pointermove', { x: CENTRE.x + 5, y: CENTRE.y })
    pointer(compass(), 'pointermove', CENTRE)
    pointer(compass(), 'pointerup', CENTRE)
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(30)
  })

  it('a drag that stays on the needle across the centre is no click', () => {
    vi.useFakeTimers()
    mount(30)
    // From 5 px on one side of the centre to 5 px on the other: 10 px of travel, all of it inside the needle.
    pointer(compass(), 'pointerdown', { x: CENTRE.x - 5, y: CENTRE.y })
    pointer(compass(), 'pointermove', CENTRE)
    pointer(compass(), 'pointermove', { x: CENTRE.x + 5, y: CENTRE.y })
    pointer(compass(), 'pointerup', { x: CENTRE.x + 5, y: CENTRE.y })
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(30)
  })

  it('a drag across the centre takes up the angle again on the far side and never flips the view', () => {
    mount(30)
    // A straight drag from the left of the face to its right, half a pixel below the centre.
    for (const [index, x] of [88, 93, 100, 107, 112].entries()) {
      pointer(compass(), index === 0 ? 'pointerdown' : 'pointermove', { x, y: CENTRE.y + 0.5 })
    }
    expect(compass().dataset.dragging).toBe('true')
    // Only the small sweeps outside the centre count: about 3°, never the 180° the crossing passes through.
    expect(Math.abs(bearing() - 30)).toBeLessThan(5)
  })

  it('a short touch drag keeps its turn when the click of the tap comes in a later task', () => {
    vi.useFakeTimers()
    mount(0)
    // 6 px around the face: past 3 px, so a drag, but inside a touch screen's tap slop, so the browser still sends a click,
    // from its tap gesture, after the release's task.
    pointer(compass(), 'pointerdown', around(-90, 15))
    pointer(compass(), 'pointermove', around(-67, 15))
    pointer(compass(), 'pointerup', around(-67, 15))
    expect(bearing()).toBeCloseTo(337, 6)
    act(() => { vi.advanceTimersByTime(50) })
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBeCloseTo(337, 6)
    // The next press is a click again.
    pointer(compass(), 'pointerdown', around(-90, 15))
    pointer(compass(), 'pointerup', around(-90, 15))
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)
  })

  it('a screen reader activation after a drag that sent no click resets north', () => {
    vi.useFakeTimers()
    mount(30)
    // A touch drag past the tap slop: the browser sends no click after its release.
    pointer(compass(), 'pointerdown', around(-90))
    pointer(compass(), 'pointermove', around(-120))
    pointer(compass(), 'pointerup', around(-120))
    expect(bearing()).toBeCloseTo(60, 6)
    // A screen reader activates the button with a click of detail 0.
    act(() => { compass().click() })
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)
  })

  it('Enter and Space reset', () => {
    vi.useFakeTimers()
    mount(30)
    compass().focus()
    expect(key(compass(), { key: 'Enter', code: 'Enter' }).defaultPrevented).toBe(true)
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)

    act(() => { view.navigation.showCamera({ ...view.view().camera, bearingDeg: 60 }) })
    expect(key(compass(), { key: ' ', code: 'Space' }).defaultPrevented).toBe(true)
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)
  })

  it('an Esc before 3 px ends the press with no reset', () => {
    vi.useFakeTimers()
    mount(30)
    router = installCanvasKeyRouter(() => null)
    pointer(compass(), 'pointerdown', around(-90))
    pointer(compass(), 'pointermove', { x: around(-90).x + 2, y: around(-90).y })
    expect(key(compass(), { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
    pointer(compass(), 'pointerup', around(-90))
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(30)
    // The next press is a click again.
    pointer(compass(), 'pointerdown', around(-90))
    pointer(compass(), 'pointerup', around(-90))
    pointerClick()
    act(() => { vi.advanceTimersByTime(TURN_MS) })
    expect(bearing()).toBe(0)
  })

  it('pointer cancel, lost capture and blur cancel the drag', () => {
    mount(30)
    for (const [target, type] of [[compass(), 'pointercancel'], [compass(), 'lostpointercapture'], [window, 'blur']] as const) {
      pointer(compass(), 'pointerdown', around(-90))
      pointer(compass(), 'pointermove', around(-120))
      expect(bearing()).toBeCloseTo(60, 6)
      if (type === 'blur') act(() => { window.dispatchEvent(new Event('blur')) })
      else pointer(target, type, around(-120))
      expect(bearing()).toBeCloseTo(30, 6)
      pointer(compass(), 'pointermove', around(-150))
      expect(bearing()).toBeCloseTo(30, 6)
      expect(compass().dataset.dragging).toBeUndefined()
    }
  })

  it('Esc with map or body focus restores the starting camera and keeps the selection (I9)', () => {
    mount(30)
    const host = document.createElement('div')
    host.tabIndex = 0
    document.body.append(host)
    const canvas = { selected: true, tool: 'select' }
    const port = selectPort(host, canvas)
    router = installCanvasKeyRouter(() => port)
    const start = view.view().camera

    for (const focus of ['map', 'body'] as const) {
      pointer(compass(), 'pointerdown', around(-90))
      pointer(compass(), 'pointermove', around(-130))
      expect(bearing()).toBeCloseTo(70, 6)
      if (focus === 'map') host.focus()
      else (document.activeElement as HTMLElement | null)?.blur()
      expect(key(focus === 'map' ? host : document.body, { key: 'Escape', code: 'Escape' }).defaultPrevented).toBe(true)
      expect(view.view().camera).toEqual(start)
      expect(canvas.selected).toBe(true)
      // The press is over: a move turns nothing, and the release is no click.
      pointer(compass(), 'pointermove', around(-160))
      pointer(compass(), 'pointerup', around(-160))
      expect(view.view().camera).toEqual(start)
    }
  })
})

/** The live keyboard port over a Select tool with a selection: its selection layer clears the selection from the map. */
function selectPort(host: HTMLElement, canvas: { selected: boolean, tool: string }): CanvasKeyboardPort {
  const toolHost = {
    command: () => 'pass',
    hasNudgeSeries: () => false,
    endNudgeSeries: () => {},
    activeToolIsSelect: () => canvas.tool === 'select',
    activeToolHasTransient: () => false,
    openTextEntryMode: () => null,
    interrupted: () => {},
  } as unknown as ToolHost
  return createCanvasKeyboardPort({
    host,
    toolHost,
    hasSelection: () => canvas.selected,
    navigation: { panByPx: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), resetNorth: vi.fn(), rotateBy: vi.fn() },
    frames: {} as ViewFrameSource,
    session: {
      pointerSessionLive: () => false,
      overview: () => false,
      spaceHeld: () => false,
      keyState: () => {},
      escapeGesture: () => {},
      requestTool: (id) => { canvas.tool = id },
      clearSelection: () => { canvas.selected = false },
    },
  })
}
