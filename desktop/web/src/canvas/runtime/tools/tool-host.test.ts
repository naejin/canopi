import { effect, signal } from '@preact/signals'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createToolHarness,
  createToolSceneSource,
  plantEntity,
  rectZone,
  sceneStoreWith,
  stubTool,
  useStubTools,
  type StubTool,
  type ToolHarness,
  type ToolHarnessOptions,
} from '../../../__tests__/support/tool-harness'
import { createTestView } from '../../../__tests__/support/test-view'
import { closeCanvasContextMenu, openCanvasContextMenu } from '../../../app/canvas-context-menu/state'
import { CanvasContextMenu } from '../../../components/canvas/CanvasContextMenu'
import { gridInterval, snapToGrid } from '../../grid'
import type { CanvasContextMenuCommands, CanvasContextMenuRequest } from '../app-adapter'
import type { ToolHandleId } from '../interaction-types'
import type { SceneDesignObjectTarget } from '../scene/design-object-targets'
import type { SceneEditCoordinator, SceneEditTransaction } from '../scene-runtime/transactions'
import type { WorldPoint } from '../view/types'
import { constrainPointTo45Degrees } from './constraints'
import type { DraftPresentation, DraftShape, ToolHandle } from './draft'
import { measureLabelShapes, selectedZoneMeasurementLabels } from './measure-labels'
import type { ToolReply } from './tool'
import { createContextMenuPort, createToolScene } from './tool-host'

vi.mock('./registry', () => ({ TOOL_REGISTRY: {} }))

const harnesses: ToolHarness[] = []

function harness(options: ToolHarnessOptions = {}): ToolHarness {
  const created = createToolHarness(options)
  harnesses.push(created)
  return created
}

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose()
  useStubTools()
})

const P1: SceneDesignObjectTarget = { kind: 'plant', id: 'p1' }
const Z1: SceneDesignObjectTarget = { kind: 'zone', id: 'z1' }
const OVERVIEW = { x: 200, y: 150, scale: 0.05 }

function appleAt(position: WorldPoint, overrides: Parameters<typeof plantEntity>[3] = {}) {
  return plantEntity('p1', 'Malus domestica', position, { commonName: 'Apple', ...overrides })
}

function bed() {
  return rectZone('z1', [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }])
}

function selectedZoneChips(h: ToolHarness): DraftShape[] {
  return measureLabelShapes(
    selectedZoneMeasurementLabels(h.store.persisted, [Z1]),
    (a, b) => h.view.view().screenDistance(a, b),
  )
}

describe('ToolHost', () => {
  describe('points', () => {
    it('re-projects the start on a plane change and calls planeChanged', () => {
      let reproject: ((point: WorldPoint) => WorldPoint) | null = null
      const rectangle = stubTool('rectangle', { planeChanged: (next) => { reproject = next } })
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })

      h.press({ x: 100, y: 100 })
      h.move({ x: 150, y: 120 })
      const before = rectangle.last('drag-start')!.start.world
      h.reorigin({ lon: 0.01, lat: 0.005 })
      h.move({ x: 160, y: 130 })

      expect(rectangle.calls).toContain('planeChanged')
      const expected = reproject!(before)
      expect(Math.hypot(expected.x - before.x, expected.y - before.y)).toBeGreaterThan(100)
      const after = rectangle.last('drag-move')!.start.world
      expect(after.x).toBeCloseTo(expected.x, 3)
      expect(after.y).toBeCloseTo(expected.y, 3)
    })

    it('under LEGACY a Polygon Shift point snaps, then constrains', () => {
      const origin = { x: 0, y: 0 }
      const polygon = stubTool('polygon', { constraint: () => ({ kind: 'direction', origin, stepDeg: 45 }) })
      useStubTools(polygon)
      const h = harness({
        tool: 'polygon',
        viewport: { x: 0, y: 0, scale: 10 },
        snapping: { grid: true, guides: false },
      })
      const interval = gridInterval(10).interval
      const at = { x: 473, y: 191 }
      const raw = h.world(at)
      const free = snapToGrid(raw.x, raw.y, interval)

      h.hover(at, { shift: true })
      const point = polygon.last('hover')!.point
      expect(point.world).toEqual(raw)
      expect(point.free).toEqual(free)
      expect(point.constrained).toEqual(constrainPointTo45Degrees(origin, raw))
      expect(point.snapped).toEqual(constrainPointTo45Degrees(origin, free))
      expect(point.modifiers).toMatchObject({ constrain: true, noSnap: false, additive: true })
      // The Shift corner is off the grid: today's order snaps first.
      expect(snapToGrid(point.snapped.x, point.snapped.y, interval)).not.toEqual(point.snapped)

      h.hover(at)
      expect(polygon.last('hover')!.point).toMatchObject({ free, constrained: raw, snapped: free })
    })

    it('under LEGACY a Plant a row Shift constrains the raw point and does not snap', () => {
      const origin = { x: 0, y: 0 }
      const row = stubTool('plant-spacing', { constraint: () => ({ kind: 'direction', origin, stepDeg: 45 }) })
      useStubTools(row)
      const h = harness({ tool: 'plant-spacing', viewport: { x: 0, y: 0, scale: 10 }, snapping: { grid: true, guides: true } })
      const at = { x: 473, y: 191 }
      const raw = h.world(at)

      h.hover(at, { shift: true })
      expect(row.last('hover')!.point).toMatchObject({
        world: raw,
        free: raw,
        constrained: constrainPointTo45Degrees(origin, raw),
        snapped: constrainPointTo45Degrees(origin, raw),
        modifiers: { constrain: true, noSnap: true },
      })

      h.hover(at)
      const interval = gridInterval(10).interval
      expect(row.last('hover')!.point).toMatchObject({ constrained: raw, snapped: snapToGrid(raw.x, raw.y, interval) })
    })

    it('snapping follows the settings at each point', () => {
      const rectangle = stubTool('rectangle')
      useStubTools(rectangle)
      const h = harness({
        tool: 'rectangle',
        scene: { guides: [{ id: 'g1', axis: 'v', position: 125 }] },
        snapping: { grid: true, guides: false },
      })
      const at = { x: 123, y: 77 }

      h.hover(at)
      expect(rectangle.last('hover')!.point.snapped).toEqual(snapToGrid(123, 77, gridInterval(1).interval))

      h.snapping = { grid: false, guides: false }
      h.hover(at)
      expect(rectangle.last('hover')!.point.snapped).toEqual(h.world(at))

      h.snapping = { grid: false, guides: true }
      h.hover(at)
      expect(rectangle.last('hover')!.point.snapped).toEqual({ x: 125, y: 77 })
      expect(rectangle.ctx().snap({ x: 124, y: 3 })).toEqual({ x: 125, y: 3 })
    })

    it('place-at is snapped and ignored in overview', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ snapping: { grid: true, guides: false } })

      h.host.command({ kind: 'place-at', world: { x: 13.2, y: 27.9 } })
      expect(h.host.activeTool.peek()).toBe('plant-stamp')
      expect(stamp.commands).toEqual([
        { kind: 'place-at', world: snapToGrid(13.2, 27.9, gridInterval(1).interval) },
      ])

      const overview = harness({ viewport: OVERVIEW })
      expect(overview.host.command({ kind: 'place-at', world: { x: 13.2, y: 27.9 } })).toBe('pass')
      expect(overview.host.activeTool.peek()).toBe('select')
      expect(stamp.commands).toHaveLength(1)
    })
  })

  describe('the view moving under a still pointer (plan §1, exception 1)', () => {
    it('a drag start stays on the ground through a wheel zoom', () => {
      const rectangle = stubTool('rectangle')
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })
      const press = { x: 100, y: 100 }
      const ground = h.world(press)

      h.press(press)
      h.move({ x: 160, y: 140 })
      h.wheelZoom({ x: 300, y: 200 }, 2)
      expect(h.world(press)).not.toEqual(ground)
      h.move({ x: 170, y: 150 })
      expect(rectangle.last('drag-move')!.start.world).toEqual(ground)
      h.release({ x: 170, y: 150 })
      expect(rectangle.last('drag-end')!.start.world).toEqual(ground)
    })

    it('re-emits the drag on a camera frame', () => {
      const rectangle = stubTool('rectangle')
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })
      const ground = h.world({ x: 100, y: 100 })

      h.press({ x: 100, y: 100 })
      h.move({ x: 160, y: 140 })
      expect(rectangle.count('drag-move')).toBe(0)
      h.wheelZoom({ x: 300, y: 200 }, 2)

      expect(rectangle.count('drag-move')).toBe(1)
      const reemitted = rectangle.last('drag-move')!
      expect(reemitted.point.world).toEqual(h.world({ x: 160, y: 140 }))
      expect(reemitted.start.world).toEqual(ground)
      expect(rectangle.calls).not.toContain('viewChanged')
    })

    it('a hover is re-emitted on a camera frame, so a placement preview stays under a still pointer', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp', scene: { plants: [appleAt({ x: 50, y: 50 })] } })
      const pointer = { x: 100, y: 100 }

      h.hover(pointer)
      expect(h.record.hovers.at(-1)).toBeNull()
      // Zooming in about the corner brings the apple under the still pointer.
      h.wheelZoom({ x: 0, y: 0 }, 2)

      expect(stamp.count('hover')).toBe(2)
      expect(stamp.last('hover')!.point.world).toEqual(h.world(pointer))
      expect(h.record.hovers.at(-1)).toEqual(P1)
      expect(h.chrome.tooltip).toEqual({ target: P1, at: pointer })
      // A re-emit is not a pointer move: the inspection lens keeps its point.
      expect(h.record.pointerWorld).toHaveLength(1)
      expect(stamp.calls).not.toContain('viewChanged')
    })

    it('a click or a drag leaves a still pointer that the next camera frame re-emits; a touch tap does not', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp' })

      h.click({ x: 120, y: 90 })
      h.view.navigation.zoomIn()
      expect(stamp.count('hover')).toBe(1)
      expect(stamp.last('hover')!.point.world).toEqual(h.world({ x: 120, y: 90 }))

      h.drag({ x: 50, y: 50 }, { x: 80, y: 60 })
      h.view.navigation.zoomOut()
      expect(stamp.count('hover')).toBe(2)
      expect(stamp.last('hover')!.point.world).toEqual(h.world({ x: 80, y: 60 }))
      expect(stamp.calls).not.toContain('viewChanged')

      // A finger that lifted leaves nothing under it.
      h.click({ x: 30, y: 30 }, { pointer: 'touch' })
      h.view.navigation.zoomIn()
      expect(stamp.count('hover')).toBe(2)
      expect(stamp.calls).toContain('viewChanged')
    })

    it('interrupted and a document replacement forget the still pointer', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp', scene: { plants: [appleAt({ x: 100, y: 100 })] } })

      h.hover({ x: 100, y: 100 })
      expect(h.chrome.tooltip?.target).toEqual(P1)
      h.blur()
      const hovers = h.record.hovers.length
      // The view moves while the pointer may be elsewhere (a resize, a focus fit): the hover stays cleared.
      h.view.navigation.zoomIn()
      expect(stamp.count('hover')).toBe(1)
      expect(h.record.hovers).toHaveLength(hovers)
      expect(h.chrome.tooltip).toBeNull()
      expect(stamp.calls.filter((call) => call === 'viewChanged')).toHaveLength(1)

      h.hover({ x: 100, y: 100 })
      h.host.prepareForDocumentReplacement()
      h.view.navigation.zoomOut()
      expect(stamp.count('hover')).toBe(2)
      expect(stamp.calls.filter((call) => call === 'viewChanged')).toHaveLength(2)
    })

    it('a pointer pan moves the resting pointer without emitting', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp' })
      const ghost = h.world({ x: 100, y: 100 })

      h.hover({ x: 100, y: 100 })
      // A middle drag: the router notes where the pointer is, then the ground follows it.
      h.host.notePointer({ x: 150, y: 120 })
      expect(stamp.count('hover')).toBe(1)
      expect(h.record.hovers).toHaveLength(1)
      expect(h.record.pointerWorld).toHaveLength(1)
      h.view.navigation.panByPx({ x: 50, y: 20 })

      // The camera frame re-emits under the moved pointer, so the ghost keeps its world point, as today.
      expect(stamp.count('hover')).toBe(2)
      const reemitted = stamp.last('hover')!.point.world
      expect(reemitted.x).toBeCloseTo(ghost.x, 6)
      expect(reemitted.y).toBeCloseTo(ghost.y, 6)
      expect(h.record.pointerWorld).toHaveLength(1)
      expect(stamp.calls).not.toContain('viewChanged')

      // Past the map's edge nothing is re-emitted; back on the map it is again.
      h.host.notePointer({ x: 450, y: 120 })
      h.view.navigation.panByPx({ x: 300, y: 0 })
      expect(stamp.count('hover')).toBe(2)
      expect(stamp.calls).toEqual(['activate', 'viewChanged'])
      h.host.notePointer({ x: 150, y: 120 })
      h.view.navigation.panByPx({ x: -300, y: 0 })
      expect(stamp.count('hover')).toBe(3)

      // null: no pointer rests on the map.
      h.host.notePointer(null)
      h.view.navigation.panByPx({ x: 10, y: 0 })
      expect(stamp.count('hover')).toBe(3)
      expect(stamp.calls.filter((call) => call === 'viewChanged')).toHaveLength(2)
    })

    it('a camera frame with the pointer off the map calls viewChanged', () => {
      const polygon = stubTool('polygon')
      useStubTools(polygon)
      const h = harness({ tool: 'polygon' })

      h.hover({ x: 50, y: 50 })
      h.leave()
      // A key or button zoom: nothing is under the pointer to re-emit.
      h.view.navigation.zoomIn()
      h.view.navigation.zoomOut()

      expect(polygon.calls.filter((call) => call === 'viewChanged')).toHaveLength(2)
      expect(polygon.count('hover')).toBe(1)
    })
  })

  describe('interceptors', () => {
    it('an active inspection claims the plain left press after handles and pan, before the tool', () => {
      const select = stubTool('select')
      const polygon = stubTool('polygon')
      useStubTools(select, polygon)
      const inspect = vi.fn(() => true)
      const h = harness({ inspect })

      // A press on a handle drags the handle.
      h.press({ x: 50, y: 50 }, { target: { kind: 'handle', id: 'rotate' as ToolHandleId } })
      expect(select.last('handle-drag')).toMatchObject({ phase: 'start', handle: 'rotate' })
      h.move({ x: 60, y: 40 })
      h.release()
      expect(select.last('handle-drag')).toMatchObject({ phase: 'end', handle: 'rotate' })
      expect(inspect).not.toHaveBeenCalled()

      // Polygon, a Shift press on empty ground: the probe samples it and the tool sees nothing of the press.
      h.arm('polygon')
      expect(h.press({ x: 120, y: 80 }, { mods: { shift: true } })).toEqual({ rejectSession: true })
      expect(inspect).toHaveBeenCalledWith(h.world({ x: 120, y: 80 }))
      expect(polygon.count('press')).toBe(0)
      expect(h.host.hasLiveGesture()).toBe(false)

      // Overview: the press pans in the recogniser; the host neither samples nor edits.
      const overview = harness({ tool: 'polygon', viewport: OVERVIEW, inspect })
      inspect.mockClear()
      overview.press({ x: 120, y: 80 })
      expect(inspect).not.toHaveBeenCalled()
      expect(polygon.count('press')).toBe(0)
    })

    it('a Pan-tool click does not sample', () => {
      const hand = stubTool('hand')
      useStubTools(hand)
      const inspect = vi.fn(() => true)
      const h = harness({ tool: 'hand', inspect })

      h.click({ x: 60, y: 60 })
      expect(inspect).not.toHaveBeenCalled()
      expect(hand.count('press')).toBe(1)
      expect(hand.count('tap')).toBe(1)
    })

    it('a press the scene does not admit is quarantined and rejected', () => {
      const rectangle = stubTool('rectangle')
      useStubTools(rectangle)
      const h = harness({
        tool: 'rectangle',
        admission: { revision: signal(0), runWhenSettled: <T,>(_operation: () => T, busy: T) => busy },
      })

      expect(h.press({ x: 10, y: 10 })).toEqual({ quarantine: true, rejectSession: true })
      expect(rectangle.count('press')).toBe(0)
      expect(h.record.focus).toEqual([])
      expect(h.host.hasLiveGesture()).toBe(false)
    })

    it('a settled release runs inside the admission; a refused one cancels the tool and is quarantined', () => {
      let busy = false
      const admitted: string[] = []
      let settled = true
      const select = stubTool('select', { settledRelease: () => settled })
      useStubTools(select)
      const h = harness({
        admission: {
          revision: signal(0),
          runWhenSettled: <T,>(operation: () => T, busyResult: T, options?: { resumePending?: boolean }) => {
            admitted.push(`${busy ? 'refused' : 'admitted'}:${options?.resumePending ?? false}`)
            return busy ? busyResult : operation()
          },
        },
      })

      // Select's band (today's requiresSettledPointerUp): its release waits for the scene, as the press did.
      h.press({ x: 10, y: 10 })
      h.move({ x: 60, y: 40 })
      admitted.length = 0
      expect(h.release({ x: 80, y: 60 })).toEqual({})
      expect(admitted).toEqual(['admitted:true'])
      expect(select.count('drag-end')).toBe(1)

      // The scene is busy at the release: the tool is cancelled, as today's refused pointerup cancelled the transient.
      h.press({ x: 10, y: 10 })
      h.move({ x: 60, y: 40 })
      busy = true
      admitted.length = 0
      expect(h.release({ x: 80, y: 60 })).toEqual({ quarantine: true })
      expect(admitted).toEqual(['refused:true'])
      expect(select.count('drag-end')).toBe(1)
      expect(select.last('cancel')).toEqual({ kind: 'cancel', reason: 'tool-change' })
      expect(select.calls.at(-1)).toBe('cancelTransient:tool-change')
      expect(h.host.hasLiveGesture()).toBe(false)

      // A settled tap too.
      busy = false
      h.press({ x: 10, y: 10 })
      busy = true
      expect(h.release()).toEqual({ quarantine: true })
      expect(select.count('tap')).toBe(0)

      // Any other release runs at once, busy or not (today's pointerup outside a band).
      settled = false
      busy = false
      h.press({ x: 10, y: 10 })
      h.move({ x: 60, y: 40 })
      busy = true
      admitted.length = 0
      expect(h.release({ x: 80, y: 60 })).toEqual({})
      expect(admitted).toEqual([])
      expect(select.count('drag-end')).toBe(2)
    })

    it('a press moves focus to the map, which commits the text entry on its blur', () => {
      const submitted: string[] = []
      const text: StubTool = stubTool('text', {
        gesture: (g) => {
          if (g.kind === 'tap') {
            text.ctx().effects.requestTextEntry(
              { anchor: g.point.snapped, rotationDeg: 0, initialText: 'Compost', placeholderKey: 'canvas.note', mode: 'create' },
              (value) => {
                submitted.push(value)
                return 'close'
              },
            )
          }
          return 'pass'
        },
      })
      useStubTools(text)
      const h = harness({ tool: 'text' })

      h.click({ x: 40, y: 40 })
      expect(h.chrome.textEntry?.request.initialText).toBe('Compost')
      h.press({ x: 90, y: 90 })
      expect(h.record.focus.at(-1)).toBe('map:text-entry-closed')
      expect(submitted).toEqual(['Compost'])
      expect(h.chrome.textEntry).toBeNull()
    })

    it('a press or a menu submits a text entry whose blur commit was refused, once; a focused one commits on its blur', () => {
      let busy = true
      const submitted: string[] = []
      const select: StubTool = stubTool('select', {
        command: (c) => {
          if (c.kind !== 'edit-text') return 'pass'
          select.ctx().effects.requestTextEntry(
            { anchor: { x: 20, y: 20 }, rotationDeg: 0, initialText: 'Old', placeholderKey: 'canvas.note', mode: 'edit' },
            (text) => {
              submitted.push(text)
              return busy ? 'keep' : 'close'
            },
          )
          return 'handled'
        },
      })
      useStubTools(select)
      const h = harness()

      // Focus leaves the entry while the scene refuses the edit: the entry stays open, without focus.
      h.host.command({ kind: 'edit-text' })
      h.typeText('New')
      expect(h.blurTextEntry()).toBe('keep')
      busy = false
      // The map taking focus cannot blur it again: the press submits it, as today's press committed the editor.
      h.click({ x: 300, y: 250 })
      expect(submitted).toEqual(['New', 'New'])
      expect(h.chrome.textEntry).toBeNull()
      expect(select.count('press')).toBe(1)

      // A menu, a keyboard one included, does the same.
      for (const source of ['mouse', 'keyboard'] as const) {
        busy = true
        h.host.command({ kind: 'edit-text' })
        h.blurTextEntry()
        busy = false
        h.menu(source === 'mouse' ? { x: 300, y: 250 } : 'selection', source)
        expect(h.chrome.textEntry).toBeNull()
      }
      expect(submitted).toHaveLength(6)

      // An entry that holds focus commits once, on the blur the map's focus causes.
      h.host.command({ kind: 'edit-text' })
      h.click({ x: 300, y: 250 })
      expect(submitted).toHaveLength(7)
      expect(h.chrome.textEntry).toBeNull()
    })

    it('the host reads the text entry\'s state live', () => {
      const handle: ToolHandle = { id: 'rotate' as ToolHandleId, anchor: { x: 10, y: 10 }, hitRadiusPx: 10, glyph: 'rotate', label: 'Rotate' }
      const select = stubTool('select', { activate: (ctx) => ctx.effects.setHandles([handle]) })
      const text: StubTool = stubTool('text', {
        gesture: (g) => {
          if (g.kind === 'tap') {
            text.ctx().effects.requestTextEntry(
              { anchor: g.point.snapped, rotationDeg: 0, initialText: '', placeholderKey: 'canvas.note', mode: 'create' },
              () => 'close',
            )
          }
          return 'pass'
        },
      })
      useStubTools(select, text)
      const h = harness()
      expect(h.chrome.handles).toEqual([handle])

      // An entry the host did not open (until 0B-3, the bridge's note editor): Select's handles hide while it is open,
      h.openTextEntry()
      h.host.sceneChanged()
      expect(h.chrome.handles).toEqual([])
      // a menu takes focus first, so the entry commits on its blur and the handles return,
      h.menu({ x: 300, y: 250 })
      expect(h.record.focus).toEqual(['map:text-entry-closed'])
      expect(h.chrome.textEntry).toBeNull()
      expect(h.chrome.handles).toEqual([handle])
      // and so does the next press, a middle one too.
      h.openTextEntry()
      h.host.sceneChanged()
      h.host.rawPress('middle', { kind: 'surface' })
      expect(h.record.focus).toEqual(['map:text-entry-closed', 'map:text-entry-closed'])
      expect(h.chrome.textEntry).toBeNull()
      expect(h.chrome.handles).toEqual([handle])

      // An entry the tool opened and Esc closed in its own element handler: the next press finds it closed.
      h.arm('text')
      h.click({ x: 40, y: 40 })
      expect(h.chrome.textEntry).not.toBeNull()
      h.escapeTextEntry()
      h.click({ x: 90, y: 90 })
      expect(h.record.focus.at(-1)).toBe('map:tool-requested')
    })

    it('under Text, the click whose raw press finds the note entry open commits it and reaches no tool', () => {
      const text: StubTool = stubTool('text', {
        gesture: (g) => {
          if (g.kind === 'press') {
            text.ctx().effects.requestTextEntry(
              { anchor: g.point.world, rotationDeg: 0, initialText: 'Compost', placeholderKey: 'canvas.note', mode: 'create' },
              () => 'close',
            )
          }
          return 'pass'
        },
      })
      const select: StubTool = stubTool('select', {
        command: (c) => {
          if (c.kind !== 'edit-text') return 'pass'
          select.ctx().effects.requestTextEntry(
            { anchor: { x: 20, y: 20 }, rotationDeg: 0, initialText: 'Old', placeholderKey: 'canvas.note', mode: 'edit' },
            () => 'close',
          )
          return 'handled'
        },
      })
      useStubTools(text, select)
      const h = harness({ tool: 'text' })

      h.click({ x: 40, y: 40 })
      const heard = text.gestures.length
      // The press's focus move commits the entry on its blur, and the click places nothing (spec §3.2, as today).
      expect(h.click({ x: 90, y: 90 })).toEqual({})
      expect(h.record.focus.at(-1)).toBe('map:text-entry-closed')
      expect(h.chrome.textEntry).toBeNull()
      expect(text.gestures).toHaveLength(heard)
      // The next click is the tool's again, and so is one after a middle press committed the entry.
      h.click({ x: 120, y: 120 })
      expect(text.count('press')).toBe(2)
      h.host.rawPress('middle', { kind: 'surface' })
      expect(h.chrome.textEntry).toBeNull()
      h.click({ x: 150, y: 150 })
      expect(text.count('press')).toBe(3)

      // Select's in-place editor commits on the press too, and the press goes on to Select, as today.
      h.arm('select')
      h.host.command({ kind: 'edit-text' })
      expect(h.chrome.textEntry?.request.mode).toBe('edit')
      h.click({ x: 200, y: 200 })
      expect(h.chrome.textEntry).toBeNull()
      expect(select.count('press')).toBe(1)
    })

    it('a new note\'s entry, whichever tool opened it, keeps its committing press from the tool and survives overview; an in-place editor does neither', () => {
      /** A stand-in whose edit-text command opens an entry of `mode`, so the mode and the tool that opened it disagree. */
      function opener(id: 'select' | 'text', mode: 'create' | 'edit'): StubTool {
        const tool: StubTool = stubTool(id, {
          command: (c) => {
            if (c.kind !== 'edit-text') return 'pass'
            tool.ctx().effects.requestTextEntry(
              { anchor: { x: 20, y: 20 }, rotationDeg: 0, initialText: 'Compost', placeholderKey: 'canvas.note', mode },
              () => 'close',
            )
            return 'handled'
          },
        })
        return tool
      }
      const select = opener('select', 'create')
      const text = opener('text', 'edit')
      useStubTools(select, text)
      const h = harness()

      // The press that commits a new note's entry reaches no tool (today's Text field took it), even under Select;
      h.host.command({ kind: 'edit-text' })
      h.click({ x: 300, y: 250 })
      expect(h.chrome.textEntry).toBeNull()
      expect(select.count('press')).toBe(0)
      // and entering overview keeps the entry, as today's setOverviewMode kept Text's field.
      h.host.command({ kind: 'edit-text' })
      h.view.setViewport(OVERVIEW)
      h.advance(0)
      expect(h.chrome.textEntry?.request.mode).toBe('create')
      h.view.setViewport({ x: 0, y: 0, scale: 1 })
      h.advance(0)

      // An in-place editor's committing press goes on to the tool, even under Text, and overview closes the editor, as
      // today's setOverviewMode cancelled the annotation editor.
      h.arm('text')
      h.host.command({ kind: 'edit-text' })
      h.click({ x: 300, y: 250 })
      expect(h.chrome.textEntry).toBeNull()
      expect(text.count('press')).toBe(1)
      h.host.command({ kind: 'edit-text' })
      h.view.setViewport(OVERVIEW)
      h.advance(0)
      expect(h.chrome.textEntry).toBeNull()
    })

    it('the text entry\'s own Esc reaches the tool through onCancel, and what the tool publishes follows at once', () => {
      const cancels: number[] = []
      const text: StubTool = stubTool('text', {
        gesture: (g) => {
          if (g.kind !== 'press') return 'pass'
          const effects = text.ctx().effects
          effects.requestTextEntry(
            { anchor: g.point.world, rotationDeg: 0, initialText: '', placeholderKey: 'canvas.note', mode: 'create' },
            () => 'close',
            () => {
              cancels.push(h.record.guidance.length)
              effects.setGuidance({ gesture: false })
            },
          )
          effects.setGuidance({ gesture: true })
          return 'pass'
        },
      })
      useStubTools(text)
      const h = harness({ tool: 'text' })

      h.click({ x: 40, y: 40 })
      expect(h.record.guidance.at(-1)?.gesture).toBe(true)
      h.escapeTextEntry()
      expect(cancels).toHaveLength(1)
      expect(h.record.guidance.at(-1)?.gesture).toBe(false)

      // An entry the host closes (here on a tool change) was not cancelled by its own Esc: no onCancel.
      h.click({ x: 90, y: 90 })
      expect(h.chrome.textEntry).not.toBeNull()
      h.arm('select')
      expect(h.chrome.textEntry).toBeNull()
      expect(cancels).toHaveLength(1)
    })

    it('a ruler drag reaches no tool, leaves the map\'s cursor alone and is never fenced by a pending cancellation', () => {
      let failing = true
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          return 'pass'
        },
        cancelTransient: () => {
          if (failing) throw new Error('cancel failed')
          edit?.abort()
          edit = null
        },
      })
      useStubTools(rectangle)
      const h = harness()
      h.arm('rectangle')
      h.press({ x: 10, y: 10 })
      expect(() => h.blur()).toThrow('cancel failed')
      failing = false
      const pressesBefore = rectangle.count('press')
      const retries = (): number => rectangle.calls.filter((call) => call === 'cancelTransient:tool-change').length
      const cursor = h.chrome.cursor

      // The session runs the drag and lands its guide (today's ruler listened beside the map).
      expect(h.press({ x: 5, y: 0 }, { target: { kind: 'ruler', axis: 'h' } })).toEqual({})
      expect(h.host.hasLiveGesture()).toBe(true)
      h.move({ x: 5, y: 40 })
      h.move({ x: 5, y: 60 })
      expect(retries()).toBe(0)
      // Today's drag cursor was the rulers' own: the map keeps the tool's.
      expect(h.chrome.cursor).toBe(cursor)
      // Its release is a pointerup, which today's handler retried and swallowed.
      expect(h.release({ x: 5, y: 90 })).toEqual({ quarantine: true })
      expect(retries()).toBe(1)
      expect(h.host.hasLiveGesture()).toBe(false)
      expect(rectangle.count('press')).toBe(pressesBefore)
      expect(rectangle.count('drag-start')).toBe(0)
      expect(h.chrome.cursor).toBe(cursor)
    })

    it('a blur or a lost capture that retries a pending cancellation goes on to the app; a pointercancel is swallowed', () => {
      let failing = true
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          return 'pass'
        },
        cancelTransient: () => {
          if (failing) throw new Error('cancel failed')
          edit?.abort()
          edit = null
        },
      })
      useStubTools(rectangle)
      const h = harness()
      h.arm('rectangle')
      const pendingWith = (reason: 'blur' | 'lost-capture' | 'pointercancel') => {
        failing = true
        h.press({ x: 10, y: 10 })
        expect(() => h.blur()).toThrow('cancel failed')
        failing = false
        return h.host.gesture({ kind: 'cancel', reason })
      }

      expect(pendingWith('blur')).toEqual({})
      expect(pendingWith('lost-capture')).toEqual({})
      expect(pendingWith('pointercancel')).toEqual({ quarantine: true })
      expect(h.host.retryPendingCancellation()).toBe(false)
    })
  })

  describe('raw presses', () => {
    const SURFACE = { kind: 'surface' } as const

    it('every raw press commits the nudge series; primary and middle close the menu and focus the map', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 10, y: 10 })] } })
      h.select(P1)
      h.menu({ x: 300, y: 250 })

      // A right press commits the series and leaves the menu and the focus alone.
      h.arrow('ArrowRight')
      h.host.rawPress('secondary', SURFACE)
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.record.nudges).toEqual(['nudge:0.1,0', 'end'])
      expect(h.menuOpen).toBe(true)
      expect(h.record.focus).toEqual([])

      // A press inside the text entry or on the Unlock affordance commits the series and keeps the entry open.
      h.openTextEntry()
      h.arrow('ArrowRight')
      h.host.rawPress('primary', { kind: 'owned-text' })
      h.arrow('ArrowRight')
      h.host.rawPress('middle', { kind: 'owned-chrome', lockedAffordance: true })
      expect(h.record.nudges).toEqual(['nudge:0.1,0', 'end', 'nudge:0.1,0', 'end', 'nudge:0.1,0', 'end'])
      expect(h.menuOpen).toBe(true)
      expect(h.record.focus).toEqual([])
      expect(h.chrome.textEntry).not.toBeNull()

      // A middle press anywhere else, a map button included: the menu closes and the map takes focus, so the entry commits.
      h.arrow('ArrowRight')
      h.host.rawPress('middle', { kind: 'owned-chrome' })
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.menuOpen).toBe(false)
      expect(h.record.focus).toEqual(['map:text-entry-closed'])
      expect(h.chrome.textEntry).toBeNull()

      // A primary press: the same, once; the press it becomes moves focus no further.
      h.menu({ x: 300, y: 250 })
      h.arrow('ArrowRight')
      h.click({ x: 200, y: 150 })
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.menuOpen).toBe(false)
      expect(h.record.focus).toEqual(['map:text-entry-closed', 'map:tool-requested'])
      expect(h.history.canUndo.value).toBe(true)
    })

    it('a raw press moves nothing during another live press, a busy scene or a pending cancellation', () => {
      let busy = false
      let failures = 1
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          return 'pass'
        },
        cancelTransient: () => {
          if (failures > 0) {
            failures -= 1
            throw new Error('cancel failed')
          }
          edit?.abort()
          edit = null
        },
      })
      useStubTools(stubTool('select'), rectangle)
      const h = harness({
        admission: { revision: signal(0), runWhenSettled: <T,>(operation: () => T, busyResult: T) => (busy ? busyResult : operation()) },
      })

      // Another pointer's press is live: today's one pointer gesture at a time.
      h.press({ x: 100, y: 100 }, { pointerId: 3 })
      h.menu('selection', 'keyboard')
      h.host.rawPress('primary', SURFACE, 4)
      expect(h.menuOpen).toBe(true)
      expect(h.record.focus).toEqual(['map:tool-requested'])
      // The live pointer pressed again, its up lost: today's _onPointerDown skipped only another pointer's press.
      h.host.rawPress('primary', SURFACE, 3)
      expect(h.menuOpen).toBe(false)
      expect(h.record.focus).toEqual(['map:tool-requested', 'map:tool-requested'])
      h.release()
      h.menu('selection', 'keyboard')

      // The scene is not settled.
      busy = true
      h.host.rawPress('middle', SURFACE)
      expect(h.menuOpen).toBe(true)
      expect(h.record.focus).toEqual(['map:tool-requested', 'map:tool-requested'])
      busy = false

      // A failed cancellation waits for its retry.
      h.arm('rectangle')
      h.press({ x: 10, y: 10 })
      expect(() => h.blur()).toThrow('cancel failed')
      const focus = h.record.focus.length
      h.host.rawPress('primary', SURFACE)
      expect(h.record.focus).toHaveLength(focus)
      expect(h.host.retryPendingCancellation()).toBe(true)
      h.host.rawPress('primary', SURFACE)
      expect(h.record.focus).toHaveLength(focus + 1)
    })
  })

  describe('hover', () => {
    it('the pointer world point is published in overview and while a tool handles the hover', () => {
      const stamp = stubTool('plant-stamp', { gesture: (g) => (g.kind === 'hover' ? 'handled' : 'pass') })
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp', scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      h.hover({ x: 50, y: 50 })
      expect(h.record.pointerWorld).toEqual([h.world({ x: 50, y: 50 })])
      expect(h.record.hovers).toEqual([null])

      const overview = harness({ tool: 'plant-stamp', viewport: OVERVIEW })
      overview.hover({ x: 10, y: 20 })
      expect(overview.record.pointerWorld).toEqual([overview.world({ x: 10, y: 20 })])
      expect(stamp.count('hover')).toBe(1)

      overview.leave()
      expect(overview.record.pointerWorld.at(-1)).toBeNull()
    })

    it('the lens is fed only over the map', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp' })

      h.hover({ x: 50, y: 50 })
      // Over a map button, a ruler or off the map, the lens keeps its point, as today's skips buttons, inputs, textareas,
      // contenteditable and [data-preserve-overlays] and hears no move off the host.
      h.hover({ x: 60, y: 60 }, {}, { kind: 'owned-chrome' })
      h.hover({ x: 70, y: 0 }, {}, { kind: 'ruler', axis: 'h' })
      h.hover({ x: 80, y: 80 }, {}, { kind: 'foreign' })
      expect(h.record.pointerWorld).toEqual([h.world({ x: 50, y: 50 })])
      // Only the lens is fed by target: the tool hears every hover, as today.
      expect(stamp.count('hover')).toBe(4)

      h.hover({ x: 90, y: 90 })
      h.leave()
      expect(h.record.pointerWorld).toEqual([h.world({ x: 50, y: 50 }), h.world({ x: 90, y: 90 }), null])

      // A bridged tool's moves reach the lens by the same rule.
      h.arm('select')
      h.hover({ x: 60, y: 60 }, {}, { kind: 'owned-chrome' })
      h.hover({ x: 20, y: 30 })
      expect(h.record.pointerWorld.slice(3)).toEqual([h.world({ x: 20, y: 30 })])
    })

    it('a handled hover skips the host\'s hover', () => {
      let reply: ToolReply = 'pass'
      const stamp = stubTool('plant-stamp', { gesture: (g) => (g.kind === 'hover' ? reply : 'pass') })
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp', scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      h.hover({ x: 50, y: 50 })
      expect(h.record.hovers.at(-1)).toEqual(P1)
      expect(h.chrome.tooltip).toEqual({ target: P1, at: { x: 50, y: 50 } })

      reply = 'handled'
      h.hover({ x: 50, y: 50 })
      expect(h.record.hovers.at(-1)).toBeNull()
      expect(h.chrome.tooltip).toBeNull()
      expect(h.chrome.lockedAffordance).toBeNull()
    })

    it('a directly locked object under a passing hover shows the Unlock affordance', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 50, y: 50 }, { locked: true })] } })

      h.hover({ x: 50, y: 50 })
      expect(h.chrome.lockedAffordance).toEqual({ target: P1, at: { x: 50, y: 50 } })
      h.hover({ x: 300, y: 250 })
      expect(h.chrome.lockedAffordance).toBeNull()
    })

    it('hover-end clears the passive hover and leaves the preview to the tool', () => {
      const ghost: DraftPresentation = {
        shapes: [{ kind: 'circle-px', center: { x: 50, y: 50 }, radiusPx: 4, style: { token: 'draft', widthPx: 1 } }],
      }
      const stamp: StubTool = stubTool('plant-stamp', {
        gesture: (g) => {
          if (g.kind === 'hover') stamp.ctx().effects.setDraft(ghost)
          return 'pass'
        },
      })
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp', scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      h.hover({ x: 50, y: 50 })
      expect(h.record.hovers.at(-1)).toEqual(P1)
      h.leave()
      expect(h.record.hovers.at(-1)).toBeNull()
      expect(h.chrome.tooltip).toBeNull()
      expect(stamp.last('hover-end')).toEqual({ kind: 'hover-end' })
      expect(h.renderer.lastDraft()).toEqual(ghost)
      expect(h.record.pointerWorld.at(-1)).toBeNull()
    })
  })

  describe('translations', () => {
    it('a language change rebuilds the tool\'s translated draft: sceneChanged, then the still pointer or viewChanged', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp' })

      h.hover({ x: 100, y: 100 })
      h.host.refreshTranslations()
      expect(stamp.calls).toEqual(['activate', 'sceneChanged'])
      expect(stamp.count('hover')).toBe(2)
      expect(stamp.last('hover')!.point.world).toEqual(h.world({ x: 100, y: 100 }))

      h.leave()
      h.host.refreshTranslations()
      expect(stamp.calls).toEqual(['activate', 'sceneChanged', 'sceneChanged', 'viewChanged'])
      expect(stamp.count('hover')).toBe(2)
    })
  })

  describe('the legacy bridge', () => {
    it('a bridged tool gets no hover, interceptor or re-emit from the host', () => {
      useStubTools(stubTool('polygon'))
      const inspect = vi.fn(() => true)
      // Select is not registered: the session's legacy bridge runs it.
      const h = harness({ scene: { plants: [appleAt({ x: 50, y: 50 })] }, inspect })
      expect(h.host.isRegistered('select')).toBe(false)
      expect(h.host.isRegistered('polygon')).toBe(true)

      h.hover({ x: 50, y: 50 })
      expect(h.record.pointerWorld).toEqual([h.world({ x: 50, y: 50 })])
      expect(h.press({ x: 50, y: 50 })).toEqual({})
      h.release()
      h.wheelZoom({ x: 50, y: 50 }, 2)

      expect(h.record.hovers).toEqual([])
      expect(h.chrome.tooltip).toBeNull()
      expect(inspect).not.toHaveBeenCalled()
      expect(h.record.focus).toEqual([])
      expect(h.record.guidance).toEqual([])
      expect(h.host.hasLiveGesture()).toBe(false)
    })

    it('a registered tool armed after a bridged one gets no stale hover on a camera frame', () => {
      const stamp = stubTool('plant-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'plant-stamp' })

      h.hover({ x: 100, y: 100 })
      // Select is bridged: the host publishes its moves but no longer follows the pointer.
      h.arm('select')
      h.hover({ x: 300, y: 200 })
      h.arm('plant-stamp')
      h.view.navigation.zoomIn()
      expect(stamp.count('hover')).toBe(1)
      expect(stamp.calls).toContain('viewChanged')
    })

    it('a tool that switches to a bridged one on its release leaves no still pointer behind', () => {
      // A saved stamp places on its release, then returns to Select, which the bridge runs.
      const savedStamp: StubTool = stubTool('saved-object-stamp', {
        gesture(g) {
          if (g.kind !== 'tap' && g.kind !== 'drag-end') return 'pass'
          savedStamp.ctx().effects.requestTool('select')
          return 'handled'
        },
      })
      const stamp = stubTool('plant-stamp')
      useStubTools(savedStamp, stamp)
      const h = harness({ tool: 'saved-object-stamp' })

      h.click({ x: 100, y: 100 })
      expect(h.host.activeTool.peek()).toBe('select')
      // Under the bridged Select the host no longer follows the pointer.
      h.hover({ x: 300, y: 250 })
      h.arm('plant-stamp')
      h.wheelZoom({ x: 300, y: 250 }, 2)
      expect(stamp.count('hover')).toBe(0)
      expect(stamp.calls).toContain('viewChanged')

      h.arm('saved-object-stamp')
      h.drag({ x: 50, y: 50 }, { x: 80, y: 60 })
      expect(h.host.activeTool.peek()).toBe('select')
      h.hover({ x: 300, y: 250 })
      h.arm('plant-stamp')
      h.view.navigation.zoomOut()
      expect(stamp.count('hover')).toBe(0)
    })

    it('the selected-zone chips wait until the zone tools are registered', () => {
      useStubTools(stubTool('rectangle'))
      const h = harness({ scene: { zones: [bed()] } })

      h.select(Z1)
      h.wheelZoom({ x: 50, y: 50 }, 1.5)
      expect(h.renderer.calls).toEqual([])
    })
  })

  describe('decorations', () => {
    it('a selected zone shows its chips under every tool', () => {
      useStubTools(stubTool('polygon'), stubTool('plant-stamp'))
      const h = harness({ scene: { zones: [bed()] } })

      h.select(Z1)
      const chips = selectedZoneChips(h)
      expect(chips.length).toBeGreaterThan(1)
      expect(h.renderer.lastDraft()).toEqual({ shapes: chips })

      h.arm('plant-stamp')
      expect(h.renderer.lastDraft()).toEqual({ shapes: chips })
      h.arm('polygon')
      expect(h.renderer.lastDraft()).toEqual({ shapes: chips })

      h.select()
      expect(h.renderer.lastDraft()).toBeNull()
    })

    it('a zone draft with measure labels hides the selected-zone chips', () => {
      const rectangle = stubTool('rectangle')
      const measure = stubTool('measurement-guide')
      useStubTools(stubTool('polygon'), rectangle, measure)
      const h = harness({ tool: 'rectangle', scene: { zones: [bed()] } })
      h.select(Z1)
      const chips = selectedZoneChips(h)
      const outline: DraftShape = {
        kind: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
        style: { token: 'draft', widthPx: 2 },
      }
      const edgeChip: DraftShape = { kind: 'label', anchor: { x: 2.5, y: 0 }, offsetPx: { x: 0, y: 0 }, text: '5 m', tone: 'measure-quiet' }

      rectangle.ctx().effects.setDraft({ shapes: [outline, edgeChip] })
      expect(h.renderer.lastDraft()).toEqual({ shapes: [outline, edgeChip] })
      rectangle.ctx().effects.setDraft({ shapes: [outline] })
      expect(h.renderer.lastDraft()).toEqual({ shapes: [outline, ...chips] })

      // The Measure tool's chips show beside the zone's, as today.
      h.arm('measurement-guide')
      measure.ctx().effects.setDraft({ shapes: [edgeChip] })
      expect(h.renderer.lastDraft()).toEqual({ shapes: [edgeChip, ...chips] })
    })

    it('a tool call that mutates the open transaction invalidates', () => {
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'drag-start') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          if (g.kind === 'drag-move') {
            edit!.mutate((draft) => {
              draft.zones = [rectZone('z2', [g.start.snapped, g.point.snapped, g.point.snapped, g.start.snapped])]
            })
          }
          if (g.kind === 'drag-end') {
            edit!.commit()
            edit = null
          }
          return 'pass'
        },
      })
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })

      h.hover({ x: 5, y: 5 })
      h.press({ x: 10, y: 10 })
      h.move({ x: 40, y: 30 })
      expect(h.record.invalidations).toBe(0)
      expect(h.record.guidance.at(-1)).toMatchObject({ gesture: true })
      h.move({ x: 60, y: 50 })
      expect(h.record.invalidations).toBe(1)
      h.release()
      expect(h.store.persisted.zones.map((zone) => zone.id)).toEqual(['z2'])
      expect(h.record.guidance.at(-1)).toMatchObject({ gesture: false })
    })
  })

  describe('Select\'s handles and edits', () => {
    const ROTATE: ToolHandle = { id: 'rotate' as ToolHandleId, anchor: { x: 10, y: 10 }, hitRadiusPx: 14, glyph: 'rotate', label: 'Rotate' }

    /** A Select stand-in that shows the rotate handle and opens a Scene Edit at a press, as a move or a handle drag does. */
    function editingSelect(): StubTool {
      let edit: SceneEditTransaction | null = null
      const select: StubTool = stubTool('select', {
        activate: (ctx) => ctx.effects.setHandles([ROTATE]),
        gesture: (g) => {
          const phase = g.kind === 'handle-drag' ? g.phase : null
          if (g.kind === 'press' || phase === 'start') edit = select.ctx().effects.edits.begin('interaction-test')
          if (g.kind === 'drag-move' || phase === 'move') {
            const world = 'point' in g ? g.point.world : { x: 0, y: 0 }
            edit?.mutate((draft) => {
              draft.plants = [appleAt(world)]
            })
          }
          if (g.kind === 'tap' || g.kind === 'drag-end' || g.kind === 'cancel' || phase === 'end') {
            edit?.abort()
            edit = null
          }
          return 'pass'
        },
      })
      return select
    }

    it('Select\'s handles hide while a Scene Edit is open; a handle\'s own press keeps them until it changes the scene', () => {
      useStubTools(editingSelect())
      const h = harness()
      expect(h.chrome.handles).toEqual([ROTATE])

      // A press that opens an edit (a move): the handles hide at once and come back when it ends.
      h.press({ x: 100, y: 100 })
      expect(h.chrome.handles).toEqual([])
      h.release()
      expect(h.chrome.handles).toEqual([ROTATE])

      // The handle's own press marks it active and keeps the handles until its edit first changes the scene, as today.
      h.press({ x: 10, y: 10 }, { target: { kind: 'handle', id: ROTATE.id } })
      expect(h.chrome.handles).toEqual([ROTATE])
      expect(h.chrome.activeHandle).toBe(ROTATE.id)
      h.move({ x: 30, y: 30 })
      expect(h.chrome.handles).toEqual([])
      h.release()
      expect(h.chrome.handles).toEqual([ROTATE])
      expect(h.chrome.activeHandle).toBeNull()
    })

    it('a press that opens a Scene Edit clears the passive hover', () => {
      useStubTools(editingSelect())
      const h = harness({ scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      h.hover({ x: 50, y: 50 })
      expect(h.chrome.tooltip).toEqual({ target: P1, at: { x: 50, y: 50 } })
      h.press({ x: 50, y: 50 })
      expect(h.chrome.tooltip).toBeNull()
      expect(h.record.hovers.at(-1)).toBeNull()
      h.release()
    })

    it('an aborted Scene Edit redraws the scene it restored', () => {
      useStubTools(editingSelect())
      const h = harness()

      h.press({ x: 100, y: 100 })
      h.move({ x: 120, y: 120 })
      h.move({ x: 140, y: 140 })
      const before = h.record.invalidations
      h.cancel('pointercancel')

      expect(h.store.persisted.plants).toEqual([])
      expect(h.record.invalidations).toBe(before + 1)
    })

    it('a text entry the tool\'s submit closes shows Select\'s handles again', () => {
      const submitted: string[] = []
      const select: StubTool = stubTool('select', {
        activate: (ctx) => ctx.effects.setHandles([ROTATE]),
        command: (c) => {
          if (c.kind !== 'edit-text') return 'pass'
          select.ctx().effects.requestTextEntry(
            { anchor: { x: 20, y: 20 }, rotationDeg: 0, initialText: 'Old', placeholderKey: 'canvas.note', mode: 'edit' },
            (text) => {
              submitted.push(text)
              return text.length > 0 ? 'close' : 'keep'
            },
          )
          return 'handled'
        },
      })
      useStubTools(select)
      const h = harness()

      expect(h.host.command({ kind: 'edit-text' })).toBe('handled')
      expect(h.chrome.handles).toEqual([])
      // A refused commit keeps the entry, and the handles stay hidden.
      expect(h.chrome.textEntry!.submit('')).toBe('keep')
      expect(h.chrome.textEntry).not.toBeNull()
      expect(h.chrome.handles).toEqual([])

      expect(h.chrome.textEntry!.submit('New')).toBe('close')
      expect(submitted).toEqual(['', 'New'])
      expect(h.chrome.textEntry).toBeNull()
      expect(h.chrome.handles).toEqual([ROTATE])
    })

    it('the same handles again change nothing and redraw nothing', () => {
      const select: StubTool = stubTool('select', {
        activate: (ctx) => ctx.effects.setHandles([ROTATE]),
        viewChanged: () => select.ctx().effects.setHandles([{ ...ROTATE }]),
      })
      useStubTools(select)
      const h = harness()
      const before = h.record.invalidations

      // A camera frame with the pointer off the map: the tool refreshes its handles, which have not changed.
      h.view.navigation.zoomIn()
      h.advance(1000)

      expect(select.calls).toContain('viewChanged')
      expect(h.record.invalidations).toBe(before)
      expect(h.chrome.handles).toEqual([ROTATE])
    })

    it('a tool call made from inside an effect leaves the effect independent of what the tool reads and bumps', () => {
      const selectionRevision = signal(0)
      const select = stubTool('select', { sceneChanged: () => void selectionRevision.value })
      useStubTools(select)
      const h = harness()
      let runs = 0

      // The runtime refreshes the session from inside its camera-frame effect.
      const stop = effect(() => {
        runs += 1
        h.host.sceneChanged()
      })
      selectionRevision.value += 1
      stop()

      expect(runs).toBe(1)
      expect(h.host.transientHistory.revision.peek()).toBeGreaterThan(0)
    })
  })

  describe('transient history', () => {
    it('transient history undoes a polygon corner and reports canUndo', () => {
      const corners: WorldPoint[] = []
      const redo: WorldPoint[] = []
      const polygon = stubTool('polygon', {
        gesture: (g) => {
          if (g.kind === 'tap') {
            corners.push(g.point.snapped)
            redo.length = 0
          }
          return 'pass'
        },
        command: (c) => {
          const from = c.kind === 'undo-transient' ? corners : c.kind === 'redo-transient' ? redo : null
          const moved = from?.pop()
          if (!moved) return 'pass'
          ;(from === corners ? redo : corners).push(moved)
          return 'handled'
        },
        canUndoTransient: () => corners.length > 0,
        canRedoTransient: () => redo.length > 0,
      })
      useStubTools(polygon)
      const h = harness({ tool: 'polygon' })
      const history = h.host.transientHistory

      expect(history.canUndo()).toBe(false)
      h.click({ x: 10, y: 10 })
      h.click({ x: 60, y: 10 })
      const revision = history.revision.peek()
      const changes = h.record.transientHistoryChanges

      expect(history.canUndo()).toBe(true)
      expect(history.undo()).toBe(true)
      expect(corners).toEqual([{ x: 10, y: 10 }])
      expect(history.canRedo()).toBe(true)
      expect(history.revision.peek()).toBeGreaterThan(revision)
      expect(h.record.transientHistoryChanges).toBeGreaterThan(changes)

      expect(history.undo()).toBe(true)
      expect(history.canUndo()).toBe(false)
      expect(history.undo()).toBe(false)
      expect(history.redo()).toBe(true)
      expect(corners).toEqual([{ x: 10, y: 10 }])
    })

    it('the transient-history revision bumps after a deferred onCommitted', () => {
      let deferred: (() => void) | null = null
      const edits: SceneEditCoordinator = {
        run(_type, _edit, options) {
          deferred = options?.onCommitted ?? null
          return true
        },
        begin() {
          throw new Error('not used')
        },
      }
      const corners = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]
      const polygon: StubTool = stubTool('polygon', {
        command: (c) => {
          if (c.kind !== 'confirm') return 'pass'
          polygon.ctx().effects.edits.run('interaction-polygon', () => {}, {
            onCommitted: () => {
              corners.length = 0
            },
          })
          return 'handled'
        },
        canUndoTransient: () => corners.length > 0,
      })
      useStubTools(polygon)
      const h = harness({ tool: 'polygon', edits })

      expect(h.host.command({ kind: 'confirm' })).toBe('handled')
      const revision = h.host.transientHistory.revision.peek()
      const changes = h.record.transientHistoryChanges
      expect(h.host.transientHistory.canUndo()).toBe(true)

      deferred!()
      expect(h.host.transientHistory.revision.peek()).toBe(revision + 1)
      expect(h.record.transientHistoryChanges).toBe(changes + 1)
      expect(h.host.transientHistory.canUndo()).toBe(false)
    })
  })

  describe('nudges', () => {
    it('an arrow with a selection nudges and one series is one undo', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 10, y: 10 })] } })
      h.select(P1)

      expect(h.arrow('ArrowRight')).toBe('handled')
      expect(h.arrow('ArrowRight')).toBe('handled')
      expect(h.arrow('ArrowDown', true)).toBe('handled')
      expect(h.record.nudges).toEqual(['nudge:0.1,0', 'nudge:0.1,0', 'nudge:0,1'])
      expect(h.host.hasNudgeSeries()).toBe(true)

      h.advance(799)
      expect(h.host.hasNudgeSeries()).toBe(true)
      expect(h.history.canUndo.value).toBe(false)
      h.advance(1)
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.record.nudges.at(-1)).toBe('end')
      const moved = h.store.persisted.plants[0]!.position
      expect(moved.x).toBeCloseTo(10.2, 9)
      expect(moved.y).toBeCloseTo(11, 9)

      expect(h.undo()).toBe(true)
      expect(h.store.persisted.plants[0]!.position).toEqual({ x: 10, y: 10 })
      expect(h.history.canUndo.value).toBe(false)
    })

    it('a refused nudge answers refused, and without Select or a selection nudge answers pass', () => {
      useStubTools(stubTool('select'), stubTool('plant-stamp'))
      const nudgeSelected = vi.fn(() => false)
      const endNudge = vi.fn()
      const h = harness({ scene: { plants: [appleAt({ x: 10, y: 10 })] }, nudge: { nudgeSelected, endNudge } })

      expect(h.arrow('ArrowLeft')).toBe('pass')
      expect(nudgeSelected).not.toHaveBeenCalled()
      h.select(P1)
      expect(h.arrow('ArrowLeft')).toBe('refused')
      expect(nudgeSelected).toHaveBeenCalledWith({ x: -0.1, y: 0 })
      expect(h.host.hasNudgeSeries()).toBe(false)
      h.arm('plant-stamp')
      expect(h.arrow('ArrowLeft')).toBe('pass')

      const overview = harness({ viewport: OVERVIEW, scene: { plants: [appleAt({ x: 10, y: 10 })] }, nudge: { nudgeSelected, endNudge } })
      overview.select(P1)
      expect(overview.arrow('ArrowLeft')).toBe('pass')
      expect(nudgeSelected).toHaveBeenCalledTimes(1)
      expect(endNudge).not.toHaveBeenCalled()
    })

    it('focus-out commits the nudge series', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 10, y: 10 })] } })
      h.select(P1)

      h.arrow('ArrowUp')
      h.focusOut()
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.record.nudges).toEqual(['nudge:0,-0.1', 'end'])
      expect(h.history.canUndo.value).toBe(true)
      h.advance(1_000)
      expect(h.record.nudges).toHaveLength(2)
    })

    it('interrupted commits the nudge series, clears the passive hover and keeps a draft that survives pans', () => {
      const draft: DraftPresentation = {
        shapes: [{ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], style: { token: 'draft', widthPx: 2 } }],
      }
      const polygon: StubTool = stubTool('polygon', {
        preservesTransientOnNavigate: true,
        cancelTransient: (reason) => {
          if (reason !== 'navigate') polygon.ctx().effects.setDraft(null)
        },
      })
      useStubTools(stubTool('select'), polygon)
      const h = harness({ scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      h.select(P1)
      h.arrow('ArrowUp')
      h.hover({ x: 50, y: 50 })
      expect(h.chrome.tooltip?.target).toEqual(P1)
      h.blur()
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.record.nudges.at(-1)).toBe('end')
      expect(h.record.hovers.at(-1)).toBeNull()
      expect(h.chrome.tooltip).toBeNull()

      h.arm('polygon')
      polygon.ctx().effects.setDraft(draft)
      h.blur()
      expect(polygon.calls).toContain('cancelTransient:navigate')
      expect(h.renderer.lastDraft()).toEqual(draft)
      expect(h.chrome.cursor).toBe('crosshair')
    })
  })

  describe('cancellation', () => {
    it('a failed cancellation is retried before the next event', () => {
      let failures = 1
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          return 'pass'
        },
        cancelTransient: () => {
          if (failures > 0) {
            failures -= 1
            throw new Error('cancel failed')
          }
          edit?.abort()
          edit = null
        },
      })
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })

      h.press({ x: 10, y: 10 })
      expect(() => h.blur()).toThrow('cancel failed')
      expect(h.press({ x: 20, y: 20 })).toEqual({ quarantine: true, rejectSession: true })
      expect(rectangle.count('press')).toBe(1)
      expect(rectangle.calls.filter((call) => call.startsWith('cancelTransient'))).toEqual([
        'cancelTransient:navigate',
        'cancelTransient:tool-change',
      ])

      expect(h.press({ x: 30, y: 30 })).toEqual({})
      expect(rectangle.count('press')).toBe(2)
    })

    it('arming another tool cancels the live press and switches the tools', () => {
      const rectangle = stubTool('rectangle')
      const ellipse = stubTool('ellipse')
      useStubTools(rectangle, ellipse)
      const h = harness({ tool: 'rectangle' })

      h.press({ x: 10, y: 10 })
      h.move({ x: 30, y: 30 })
      h.arm('ellipse')
      expect(rectangle.last('cancel')).toEqual({ kind: 'cancel', reason: 'tool-change' })
      expect(rectangle.calls).toEqual(['activate', 'cancelTransient:tool-change', 'deactivate:switch'])
      expect(ellipse.calls).toEqual(['activate'])
      expect(h.host.hasLiveGesture()).toBe(false)
      expect(h.host.activeToolDragSlopPx()).toBeNull()
    })

    it('entering overview cancels the tool\'s transient with the overview reason', () => {
      const stamp = stubTool('object-stamp')
      useStubTools(stamp)
      const h = harness({ tool: 'object-stamp' })

      h.view.setViewport(OVERVIEW)
      h.advance(0)
      expect(stamp.calls).toContain('cancelTransient:overview')
      expect(stamp.calls).not.toContain('cancelTransient:tool-change')
    })
  })

  describe('registered tools against today\'s session (0B-3 host rulings)', () => {
    /** A drag tool whose press opens a Scene Edit that its cancelTransient aborts. */
    function editingTool(
      id: 'rectangle' | 'select',
      behaviour: { readonly settledRelease?: () => boolean, readonly release?: () => void } = {},
    ): { readonly tool: StubTool, readonly open: () => boolean } {
      let edit: SceneEditTransaction | null = null
      const tool: StubTool = stubTool(id, {
        ...(behaviour.settledRelease ? { settledRelease: behaviour.settledRelease } : {}),
        gesture: (g) => {
          if (g.kind === 'press') edit = tool.ctx().effects.edits.begin(`interaction-${id}`)
          if (g.kind === 'drag-end' || g.kind === 'tap') behaviour.release?.()
          return 'pass'
        },
        cancelTransient: () => {
          edit?.abort()
          edit = null
        },
      })
      return { tool, open: () => edit !== null }
    }

    it.each([
      ['a drag', (h: ToolHarness) => h.drag({ x: 10, y: 10 }, { x: 40, y: 40 })],
      ['a click', (h: ToolHarness) => h.click({ x: 10, y: 10 })],
    ] as const)('%s whose release throws runs the cancellation at once, so the next press is admitted', (_name, gesture) => {
      const { tool, open } = editingTool('rectangle', { release: () => { throw new Error('commit failed') } })
      useStubTools(tool)
      const h = harness({ tool: 'rectangle' })

      expect(() => gesture(h)).toThrow('commit failed')
      // Today's pointerup ran the cancellation in its finally: the edit closes at the release.
      expect(tool.calls).toContain('cancelTransient:tool-change')
      expect(open()).toBe(false)
      expect(h.press({ x: 50, y: 50 })).toEqual({})
      expect(tool.count('press')).toBe(2)
    })

    it('a release whose tool call and cancellation both throw leaves the cancellation pending and reports the release', () => {
      let failCancel = true
      let edit: SceneEditTransaction | null = null
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') edit = rectangle.ctx().effects.edits.begin('interaction-rectangle')
          if (g.kind === 'drag-end') throw new Error('commit failed')
          return 'pass'
        },
        cancelTransient: () => {
          if (failCancel) throw new Error('abort failed')
          edit?.abort()
          edit = null
        },
      })
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle' })

      expect(() => h.drag({ x: 10, y: 10 }, { x: 40, y: 40 })).toThrow('commit failed')
      expect(edit).not.toBeNull()
      failCancel = false
      // The failed cancellation is retried before the next press, which is swallowed, as today.
      expect(h.press({ x: 50, y: 50 })).toEqual({ quarantine: true, rejectSession: true })
      expect(edit).toBeNull()
      expect(h.press({ x: 60, y: 60 })).toEqual({})
    })

    it('a settled release whose tool call throws runs the cancellation at once, so the next press is admitted', () => {
      let edit: SceneEditTransaction | null = null
      const band: StubTool = stubTool('select', {
        settledRelease: () => true,
        gesture: (g) => {
          if (g.kind === 'drag-end') {
            edit = band.ctx().effects.edits.begin('interaction-band')
            throw new Error('band failed')
          }
          return 'pass'
        },
        cancelTransient: () => {
          edit?.abort()
          edit = null
        },
      })
      useStubTools(band)
      const h = harness()

      expect(() => h.drag({ x: 10, y: 10 }, { x: 40, y: 40 })).toThrow('band failed')
      expect(band.calls).toContain('cancelTransient:tool-change')
      expect(edit).toBeNull()
      expect(h.press({ x: 50, y: 50 })).toEqual({})
    })

    it('an admitted press takes its capture before the tool hears it, and a refused press takes none', () => {
      const order: string[] = []
      const rectangle = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press' || g.kind === 'handle-drag') order.push(g.kind)
          return 'pass'
        },
      })
      useStubTools(rectangle)
      let busy = false
      const h = harness({
        tool: 'rectangle',
        admission: { revision: signal(0), runWhenSettled: (operation, busyResult) => busy ? busyResult : operation() },
        capturePress: (pointerId) => {
          order.push(`capture:${pointerId}`)
          return true
        },
      })

      h.click({ x: 10, y: 10 }, { pointerId: 7 })
      h.click({ x: 10, y: 10 }, { pointerId: 8, target: { kind: 'handle', id: 'rotate' as ToolHandleId } })
      expect(order).toEqual(['capture:7', 'press', 'capture:8', 'handle-drag', 'handle-drag'])

      busy = true
      expect(h.press({ x: 20, y: 20 }, { pointerId: 9 })).toEqual({ quarantine: true, rejectSession: true })
      expect(h.record.captures).toEqual([7, 8])
    })

    it('a press whose capture is lost while it is taken stops before the tool', () => {
      const rectangle = stubTool('rectangle')
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle', capturePress: () => false })

      expect(h.press({ x: 10, y: 10 }, { pointerId: 4 })).toEqual({ rejectSession: true })
      expect(h.record.captures).toEqual([4])
      expect(rectangle.count('press')).toBe(0)
      expect(h.host.hasLiveGesture()).toBe(false)
    })

    it('a tool call inside an effect neither loops on the transient-history revision nor leaves the effect reading the tool\'s signals', () => {
      const probe = signal(0)
      const select = stubTool('select', {
        sceneChanged: () => {
          void probe.value
        },
      })
      useStubTools(select)
      const h = harness()
      let runs = 0

      const stop = effect(() => {
        runs += 1
        h.host.sceneChanged()
      })
      try {
        expect(runs).toBe(1)
        probe.value += 1
        expect(runs).toBe(1)
      } finally {
        stop()
      }
    })

    it('a deferred commit that settles inside an effect bumps the transient-history revision without looping', () => {
      let settle: (() => void) | null = null
      // A coordinator that holds the commit's continuation (today's retained publication) until the effect runs it.
      const edits: SceneEditCoordinator = {
        begin: () => {
          throw new Error('unused')
        },
        run(_type, _edit, options) {
          settle = options?.onCommitted ?? null
          return true
        },
      }
      const polygon: StubTool = stubTool('polygon', {
        gesture: (g) => {
          if (g.kind === 'tap') polygon.ctx().effects.edits.run('interaction-polygon', () => {}, { onCommitted: () => {} })
          return 'pass'
        },
      })
      useStubTools(polygon)
      const h = harness({ tool: 'polygon', edits })
      h.click({ x: 10, y: 10 })
      const revision = h.host.transientHistory.revision.peek()

      let runs = 0
      const stop = effect(() => {
        runs += 1
        settle?.()
      })
      try {
        expect(runs).toBe(1)
        expect(h.host.transientHistory.revision.peek()).toBe(revision + 1)
      } finally {
        stop()
      }
    })

    it('a dragover hides the tool\'s draft until the pointer next moves over the map, as today\'s one preview element', () => {
      const ghost: DraftPresentation = {
        shapes: [{ kind: 'circle-px', center: { x: 50, y: 50 }, radiusPx: 4, style: { token: 'draft', widthPx: 1 } }],
      }
      const stamp: StubTool = stubTool('object-stamp', {
        gesture: (g) => {
          if (g.kind === 'hover') stamp.ctx().effects.setDraft(ghost)
          return 'handled'
        },
      })
      useStubTools(stamp)
      const h = harness({ tool: 'object-stamp' })
      h.hover({ x: 50, y: 50 })
      expect(h.renderer.lastDraft()).toEqual(ghost)

      h.drop('over', { x: 60, y: 60 }, { kind: 'species', species: null })
      expect(h.renderer.lastDraft()).toBeNull()
      // A camera frame re-emits the resting pointer: the draft stays hidden while the drop preview may show.
      h.wheelZoom({ x: 60, y: 60 }, 1.5)
      h.advance(16)
      expect(h.renderer.lastDraft()).toBeNull()
      h.drop('leave')
      expect(h.renderer.lastDraft()).toBeNull()

      h.hover({ x: 70, y: 70 })
      expect(h.renderer.lastDraft()).toEqual(ghost)

      h.drop('over', { x: 60, y: 60 }, { kind: 'unknown' })
      h.drop('drop', { x: 60, y: 60 }, { kind: 'unknown' })
      expect(h.renderer.lastDraft()).toBeNull()
      h.hover({ x: 80, y: 80 })
      expect(h.renderer.lastDraft()).toEqual(ghost)
    })
  })

  describe('menus', () => {
    it('a right-click retargets the selection to the object under it and opens the menu there', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 50, y: 50 })] } })

      expect(h.menu({ x: 50, y: 50 })).toEqual({})
      expect(h.record.selections).toEqual([[P1]])
      expect(h.record.menus).toEqual([
        { at: h.world({ x: 50, y: 50 }), source: 'mouse', screen: { x: 50, y: 50 }, hit: { kind: 'object', target: P1 } },
      ])

      h.menu({ x: 300, y: 250 })
      expect(h.record.selections).toHaveLength(1)
      expect(h.record.menus.at(-1)).toMatchObject({ hit: null, screen: { x: 300, y: 250 } })

      h.menu('selection', 'keyboard')
      expect(h.record.menus.at(-1)).toEqual({ at: 'selection', source: 'keyboard', screen: null, hit: null })
    })

    it('a right-click during a nudge series commits the series and opens the menu', () => {
      useStubTools(stubTool('select'))
      const h = harness({ scene: { plants: [appleAt({ x: 10, y: 10 })] } })
      h.select(P1)

      // The right press commits the series before its menu arrives (rawPress); a keyboard menu, with no press, commits it
      // itself, as today's key did.
      expect(h.arrow('ArrowRight')).toBe('handled')
      expect(h.menu({ x: 300, y: 250 })).toEqual({})
      expect(h.host.hasNudgeSeries()).toBe(false)
      expect(h.record.nudges).toEqual(['nudge:0.1,0', 'end'])
      expect(h.history.canUndo.value).toBe(true)
      expect(h.record.menus).toHaveLength(1)

      expect(h.arrow('ArrowLeft')).toBe('handled')
      expect(h.menu('selection', 'keyboard')).toEqual({})
      expect(h.record.nudges).toEqual(['nudge:0.1,0', 'end', 'nudge:-0.1,0', 'end'])
      expect(h.record.menus).toHaveLength(2)
      h.advance(1_000)
      expect(h.record.nudges).toHaveLength(4)
    })

    it('disposing the host closes the canvas menu', () => {
      useStubTools(stubTool('select'))
      const h = harness()

      h.menu({ x: 50, y: 50 })
      expect(h.menuOpen).toBe(true)
      h.host.dispose()
      expect(h.menuOpen).toBe(false)
    })

    it('a menu during a Scene Edit is quarantined', () => {
      const rectangle: StubTool = stubTool('rectangle', {
        gesture: (g) => {
          if (g.kind === 'press') rectangle.ctx().effects.edits.begin('interaction-rectangle')
          return 'pass'
        },
      })
      useStubTools(rectangle)
      const h = harness({ tool: 'rectangle', admission: { revision: signal(0), runWhenSettled: (operation) => operation() } })

      h.press({ x: 10, y: 10 })
      expect(h.menu({ x: 10, y: 10 })).toEqual({ quarantine: true })
      expect(h.record.menus).toEqual([])
    })

    it('the menu port rebuilds today\'s three menu states', () => {
      const store = sceneStoreWith({
        plants: [appleAt({ x: 50, y: 50 }), plantEntity('p2', 'Pyrus communis', { x: 150, y: 50 })],
      })
      store.updateSession((session) => {
        session.selectedTargets = [P1]
      })
      const source = createToolSceneSource(store)
      const opened: CanvasContextMenuRequest[] = []
      const view = createTestView()
      const port = createContextMenuPort({
        container: document.createElement('div'),
        camera: view.legacyCamera,
        adapter: { open: (request) => opened.push(request), close: () => {} },
        commands: {} as never,
        returnFocus: () => {},
        scene: createToolScene(source),
        selectionModel: source.selectionModel,
      })

      port.open({ at: { x: 50, y: 50 }, source: 'mouse', screen: { x: 50, y: 50 }, hit: null })
      expect(opened.at(-1)!.selection?.editableTargets).toEqual([P1])
      expect(port.isOpen()).toBe(true)

      port.open({ at: 'selection', source: 'keyboard', screen: null, hit: null })
      expect(opened.at(-1)!.selection).toEqual(source.selectionModel())
      expect(opened.at(-1)!.world).toEqual({ x: 50, y: 50 })

      port.open({ at: { x: 300, y: 250 }, source: 'mouse', screen: null, hit: null })
      expect(opened.at(-1)!.selection).toBeNull()

      store.updatePersisted((draft) => {
        draft.layers = draft.layers.map((layer) => (layer.name === 'plants' ? { ...layer, locked: true } : layer))
      })
      port.open({ at: { x: 150, y: 50 }, source: 'mouse', screen: { x: 150, y: 50 }, hit: null })
      expect(opened.at(-1)!.selection?.editableTargets).toEqual([])

      port.close()
      expect(port.isOpen()).toBe(false)
      view.dispose()
    })

    it("the menu port follows every close of the app's menu, with or without a focus return", async () => {
      const source = createToolSceneSource(sceneStoreWith({}))
      const returnFocus = vi.fn()
      const view = createTestView()
      // The app's menu over its own state, which app/canvas-runtime/app-adapter.ts lends the runtime as its adapter.
      const app = document.body.appendChild(document.createElement('div'))
      await act(async () => render(h(CanvasContextMenu, null), app))
      const port = createContextMenuPort({
        container: document.createElement('div'),
        camera: view.legacyCamera,
        adapter: { open: openCanvasContextMenu, close: closeCanvasContextMenu },
        // No command runs here: each one does nothing.
        commands: new Proxy({}, { get: () => () => false }) as CanvasContextMenuCommands,
        returnFocus,
        scene: createToolScene(source),
        selectionModel: source.selectionModel,
      })
      const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
      const openMenu = async () => {
        await act(async () => port.open({ at: { x: 10, y: 10 }, source: 'mouse', screen: { x: 10, y: 10 }, hit: null }))
        expect(menu()).not.toBeNull()
        expect(port.isOpen()).toBe(true)
      }

      try {
        // A press or focus elsewhere, a resize, a scroll: the app's menu closes itself and gives no focus back.
        for (const closeElsewhere of [
          () => document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })),
          () => app.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
          () => window.dispatchEvent(new Event('resize')),
          () => document.dispatchEvent(new Event('scroll')),
        ]) {
          await openMenu()
          await act(async () => { closeElsewhere() })
          expect(menu()).toBeNull()
          expect(port.isOpen()).toBe(false)
        }
        expect(returnFocus).not.toHaveBeenCalled()

        // Esc: the menu closes and gives focus back to the map.
        await openMenu()
        await act(async () => {
          menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        })
        expect(menu()).toBeNull()
        expect(returnFocus).toHaveBeenCalledOnce()
        expect(port.isOpen()).toBe(false)

        // A newer menu replaces the open one, whose close leaves the newer one open until the runtime closes it.
        await openMenu()
        await openMenu()
        await act(async () => port.close())
        expect(menu()).toBeNull()
        expect(port.isOpen()).toBe(false)
      } finally {
        await act(async () => {
          closeCanvasContextMenu()
          render(null, app)
        })
        app.remove()
        view.dispose()
      }
    })
  })
})
