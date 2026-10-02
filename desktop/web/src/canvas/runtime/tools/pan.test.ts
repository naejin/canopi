import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopKeys } from '../../../__tests__/support/desktop-key-router'
import { pressKey } from '../../../__tests__/support/key-router'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from '../../../__tests__/support/canvas-runtime-surfaces'
import {
  createToolHarness,
  plantEntity,
  useStubTools,
  type ToolHarness,
} from '../../../__tests__/support/tool-harness'
import { setCurrentCanvasSession } from '../../session'
import { activeTool } from '../../session-state'
import { LEGACY_BINDINGS } from '../input/bindings'
import type { Gesture } from '../input/gestures'
import { createInputRouter } from '../input/input-router'
import { LINUX_CHROMIUM, down, move, runSequence, seq, up } from '../input/__fixtures__/sequences'
import type { ToolId } from '../interaction-types'
import type { ScreenPoint } from '../view/types'
import { createPanTool } from './pan'
import type { ToolGesture } from './tool'

vi.mock('./registry', () => ({ TOOL_REGISTRY: {} }))

const harnesses: ToolHarness[] = []

function panHarness(): { readonly h: ToolHarness; readonly gestures: ToolGesture['kind'][] } {
  const tool = createPanTool()
  const gestures: ToolGesture['kind'][] = []
  const gesture = tool.gesture.bind(tool)
  tool.gesture = (g) => {
    gestures.push(g.kind)
    return gesture(g)
  }
  useStubTools(tool)
  const h = createToolHarness({ scene: { plants: [plantEntity('apple', 'Malus domestica', { x: 100, y: 100 })] } })
  harnesses.push(h)
  return { h, gestures }
}

afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose()
  setCurrentCanvasSession(null)
  activeTool.value = 'select'
})

describe('Pan tool', () => {
  it('H arms Pan; a primary drag pans', () => {
    const { h, gestures } = panHarness()
    // The key path: the Desktop key router's H row arms the tool through the canvas command surface.
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ tools: { setTool: (id: string) => h.arm(id as ToolId) } }),
    }))

    const keys = installDesktopKeys()
    expect(pressKey({ key: 'h' }).defaultPrevented).toBe(true)
    keys.dispose()

    expect(h.host.activeTool.peek()).toBe('hand')
    expect(h.chrome.cursor).toBe('grab')

    // The recogniser as the session configures it for the armed tool, and the router in front of the host.
    const panByPx = vi.fn<(delta: ScreenPoint) => void>()
    const router = createInputRouter({
      navigation: { panByPx, zoomAroundPx: vi.fn(), beginRotation: vi.fn() },
      toolHost: h.host,
    })
    const run = runSequence(seq('Pan tool drag', LINUX_CHROMIUM, [
      down(100, 100),
      move(110, 104, { buttons: 1 }),
      move(130, 120, { buttons: 1 }),
      up(130, 120),
    ], { tool: h.host.activeTool.peek() }), LEGACY_BINDINGS)
    h.host.rawPress('primary', { kind: 'surface' }, 1)
    for (const gesture of run.gestures as readonly Gesture[]) router.route(gesture)

    const panned = panByPx.mock.calls.reduce((sum, [delta]) => ({ x: sum.x + delta.x, y: sum.y + delta.y }), { x: 0, y: 0 })
    expect(panned).toEqual({ x: 30, y: 20 })
    // The press reaches the tool and ends once, after its pan; no drag ever does.
    expect(gestures).toEqual(['press', 'cancel'])
    expect(h.host.hasLiveGesture()).toBe(false)
    expect(h.store.persisted.plants[0]!.position).toEqual({ x: 100, y: 100 })
    expect(h.store.session.selectedTargets).toEqual([])
  })

  it('shows the grab cursor and no guidance, and leaves presses, taps and hovers to the host', () => {
    const { h, gestures } = panHarness()
    h.arm('hand')
    h.renderer.clear()

    h.hover({ x: 100, y: 100 })
    h.click({ x: 100, y: 100 })

    expect(h.chrome.cursor).toBe('grab')
    expect(h.record.guidance.at(-1)).toEqual({ gesture: false, stamp: null, stampRotationDeg: null, promptSpecies: false, plantRow: null })
    expect(gestures).toEqual(['hover', 'press', 'tap'])
    // A hover passes: the plant's hover restyle and tooltip run as under Select.
    expect(h.record.hovers).toContainEqual({ kind: 'plant', id: 'apple' })
    expect(h.store.session.selectedTargets).toEqual([])
    expect(h.renderer.lastDraft()).toBeNull()
    expect(h.host.activeToolHasTransient()).toBe(false)
    expect(h.host.escapeHint()).toBe('leave-tool')
  })
})
