import { effect } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { planeViewportCornerBounds } from '../../../__tests__/support/plane-viewport-corners'
import { createTestView } from '../../../__tests__/support/test-view'
import { createSessionPlane } from '../../session-plane'
import { createViewFrameSource, createViewReadSurface, SETTLE_MS } from './frame-source'
import type { ViewFrame } from './types'

describe('view frame source', () => {
  it('runs the tools listeners before the overlays listeners, inside publish', () => {
    const view = createTestView()
    const initial = view.frames.viewFrame.peek()
    let now = 0
    const timers: Array<{ atMs: number; run: () => void }> = []
    const frames = createViewFrameSource(initial, {
      clock: () => now,
      timers: { set: (atMs, run) => timers.push({ atMs, run }), clear: () => {} },
    })
    const calls: string[] = []
    frames.onViewFrame('overlays', () => calls.push('overlays'))
    const stopTools = frames.onViewFrame('tools', () => calls.push(`tools, dispatching ${frames.dispatching}`))
    const next = { ...initial, revision: 1 } as ViewFrame

    frames.publish(next)
    expect(calls).toEqual(['tools, dispatching true', 'overlays'])
    expect(frames.dispatching).toBe(false)
    expect(frames.viewFrame.peek()).toBe(next)

    stopTools()
    frames.publish({ ...initial, revision: 2 } as ViewFrame)
    expect(calls).toEqual(['tools, dispatching true', 'overlays', 'overlays'])
    // Each publish restarts the settle: the timer asked for last is 150 ms after the last frame.
    expect(timers.at(-1)!.atMs).toBe(now + SETTLE_MS)
    view.dispose()
  })

  it('a frame published while listeners run reaches every listener after the frame being dispatched', () => {
    const view = createTestView()
    const initial = view.frames.viewFrame.peek()
    const frames = createViewFrameSource(initial, { clock: () => 0, timers: { set: () => 0, clear: () => {} } })
    const first = { ...initial, revision: 1 } as ViewFrame
    const second = { ...initial, revision: 2 } as ViewFrame
    const seen: Array<readonly [string, number]> = []
    frames.onViewFrame('tools', (frame) => {
      seen.push(['tools', frame.revision])
      if (frame !== first) return
      frames.publish(second)
      seen.push(['viewFrame after the publish', frames.viewFrame.peek().revision])
    })
    frames.onViewFrame('overlays', (frame) => seen.push([`overlays, dispatching ${frames.dispatching}`, frame.revision]))

    frames.publish(first)

    expect(seen).toEqual([
      ['tools', 1],
      ['viewFrame after the publish', 1],
      ['overlays, dispatching true', 1],
      ['tools', 2],
      ['overlays, dispatching true', 2],
    ])
    expect(frames.viewFrame.peek()).toBe(second)
    expect(frames.dispatching).toBe(false)
    view.dispose()
  })

  it('the read surface signals change only with their own values', () => {
    const view = createTestView({ screen: { width: 400, height: 300 }, viewport: { x: 0, y: 0, scale: 2 } })
    const surface = createViewReadSurface(view.frames, () => createSessionPlane({ lon: 0, lat: 0 }))
    const runs = { mode: 0, zoomBand: 0, bearingDeg: 0, northUp: 0, groundMetresPerPixel: 0, zoomLimit: 0, designPin: 0 }
    const disposers = (Object.keys(runs) as Array<keyof typeof runs>).map((name) => effect(() => {
      void surface[name].value
      runs[name] += 1
    }))

    view.navigation.panByPx({ x: 25, y: -10 })
    view.navigation.panByPx({ x: -3, y: 4 })
    expect(runs).toEqual({ mode: 1, zoomBand: 1, bearingDeg: 1, northUp: 1, groundMetresPerPixel: 1, zoomLimit: 1, designPin: 1 })

    expect(surface.zoomBand.value).toBe(Math.floor(Math.log(2) / Math.log(1.25)))
    expect(surface.groundMetresPerPixel.value).toBe(0.5)
    expect(surface.zoomLimit.value).toBeNull()
    view.setViewport({ x: 0, y: 0, scale: 1e9 })
    expect(surface.zoomLimit.value).toBe('max')
    view.setViewport({ x: 0, y: 0, scale: 1e-9 })
    expect(surface.zoomLimit.value).toBe('min')
    expect(surface.mode.value).toBe('overview')

    // The needle reads a tenth of a degree; north-up allows 0.05°.
    view.host.current().apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 359.96, animation: 'none' })
    expect(surface.bearingDeg.value).toBe(0)
    expect(surface.northUp.value).toBe(true)
    view.host.current().apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 12.345, animation: 'none' })
    expect(surface.bearingDeg.value).toBe(12.3)
    expect(surface.northUp.value).toBe(false)
    for (const dispose of disposers) dispose()
    view.dispose()
  })

  it('the Design pin shows in overview only, rounded, 24 px or more inside every edge', () => {
    const view = createTestView({ screen: { width: 400, height: 300 } })
    const surface = createViewReadSurface(view.frames, () => createSessionPlane({ lon: 0, lat: 0 }))

    view.setViewport({ x: 120.4, y: 80.6, scale: 2 })
    expect(surface.designPin.value).toBeNull()
    view.setViewport({ x: 120.4, y: 80.6, scale: 0.05 })
    expect(surface.designPin.value).toEqual({ x: 120, y: 81 })
    view.setViewport({ x: 24, y: 276, scale: 0.05 })
    expect(surface.designPin.value).toEqual({ x: 24, y: 276 })
    view.setViewport({ x: 23.9, y: 150, scale: 0.05 })
    expect(surface.designPin.value).toBeNull()
    view.dispose()
  })

  it('settledRevision changes once per settle, a resize included', () => {
    const view = createTestView()
    const surface = createViewReadSurface(view.frames, () => createSessionPlane({ lon: 0, lat: 0 }))
    const seen: number[] = []
    const stop = effect(() => { seen.push(surface.settledRevision.value) })

    view.navigation.panByPx({ x: 25, y: -10 })
    view.clock.advance(SETTLE_MS - 1)
    view.navigation.panByPx({ x: -3, y: 4 })
    view.clock.advance(SETTLE_MS - 1)
    expect(seen).toHaveLength(1)
    view.clock.advance(1)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(view.frames.viewFrame.peek().revision)

    view.host.current().setScreen({ width: 640, height: 480, devicePixelRatio: 1 })
    view.clock.advance(SETTLE_MS)
    expect(seen).toHaveLength(3)
    expect(seen[2]).toBe(view.frames.viewFrame.peek().revision)
    expect(view.frames.settledViewFrame.peek().view.screen.width).toBe(640)

    // Nothing new published: no further settle.
    view.clock.advance(SETTLE_MS * 4)
    expect(seen).toHaveLength(3)
    stop()
    view.dispose()
  })

  it('captureView returns the live camera and the four-corner extent', () => {
    const plane = createSessionPlane({ lon: 2.3522, lat: 48.8566 })
    const view = createTestView({ plane, viewport: { x: -130.5, y: 42.25, scale: 1.75 } })
    const surface = createViewReadSurface(view.frames, () => plane)

    // At bearing 0 the extent is today's north-west and south-east corners, bit for bit.
    const captured = surface.captureView()
    expect(captured.camera).toBe(view.view().camera)
    expect(captured.screen).toEqual({ width: 400, height: 300, devicePixelRatio: 1 })
    expect(captured.extent).toEqual(planeViewportCornerBounds({
      viewport: { x: -130.5, y: 42.25, scale: 1.75 },
      screenSize: { width: 400, height: 300 },
    }, plane))

    // Turned, it is the lon/lat box around the ground under all four corners, raw.
    view.host.current().apply({ kind: 'rotate-around', anchorPx: 'centre', bearingDeg: 30, animation: 'none' })
    const turned = surface.captureView()
    const corners = view.view().visibleWorldQuad().map((corner) => plane.toGeo(corner))
    expect(turned.extent).toEqual({
      west: Math.min(...corners.map((corner) => corner.lon)),
      south: Math.min(...corners.map((corner) => corner.lat)),
      east: Math.max(...corners.map((corner) => corner.lon)),
      north: Math.max(...corners.map((corner) => corner.lat)),
    })
    expect(turned.camera.bearingDeg).toBe(30)
    view.dispose()
  })
})
