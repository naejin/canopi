import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { locale } from '../../app/settings/state'
import { phoneLayout } from '../../app/shell/phone-layout'
import { registerMapArea, registerMapOccluder } from '../../app/shell/visible-map-area'
import { setCurrentCanvasSession } from '../../canvas/session'
import { createTestCanvasRuntimeSurfaces } from '../../__tests__/support/canvas-runtime-surfaces'
import { MapNotice } from './MapNotice'

const failed: MapNoticeReadModel = {
  visible: true,
  mapSurfaceVisible: true,
  tone: 'error',
  statusText: 'The map stopped drawing. Your Design is safe.',
  retry: true,
}
const loading: MapNoticeReadModel = { ...failed, tone: 'loading', statusText: 'Loading basemap', retry: false }
const hidden: MapNoticeReadModel = { ...loading, visible: false, tone: 'ready', statusText: '' }

describe('MapNotice', () => {
  let container: HTMLDivElement
  let canvas: HTMLDivElement
  const canvasRef = { current: null as HTMLDivElement | null }

  beforeEach(() => {
    locale.value = 'en'
    container = document.createElement('div')
    canvas = document.createElement('div')
    canvas.tabIndex = 0
    canvasRef.current = canvas
    document.body.append(canvas, container)
  })

  afterEach(async () => {
    await act(async () => { render(null, container) })
    container.remove()
    canvas.remove()
  })

  it('keeps keyboard focus on the chip when Retry goes away after a press', async () => {
    const onRetry = vi.fn()
    await act(async () => { render(<MapNotice notice={failed} onRetry={onRetry} canvasRef={canvasRef} />, container) })
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    retry.focus()

    await act(async () => { retry.click() })
    await act(async () => { render(<MapNotice notice={loading} onRetry={onRetry} canvasRef={canvasRef} />, container) })

    expect(onRetry).toHaveBeenCalledOnce()
    expect(container.querySelector('button')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(container.querySelector('[data-map-notice]'))
  })

  it('hands keyboard focus to the map when the chip goes away after a successful Retry', async () => {
    const onRetry = vi.fn()
    await act(async () => { render(<MapNotice notice={failed} onRetry={onRetry} canvasRef={canvasRef} />, container) })
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry')!
    retry.focus()
    await act(async () => { retry.click() })
    await act(async () => { render(<MapNotice notice={loading} onRetry={onRetry} canvasRef={canvasRef} />, container) })
    const focus = vi.spyOn(canvas, 'focus')

    await act(async () => { render(<MapNotice notice={hidden} onRetry={onRetry} canvasRef={canvasRef} />, container) })

    expect(container.querySelector('[data-map-notice]')).toBeNull()
    expect(document.activeElement).toBe(canvas)
    // The map takes focus the way its own session does, without scrolling the page.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('leaves focus alone when the chip goes away without holding it', async () => {
    const elsewhere = document.createElement('button')
    canvas.appendChild(elsewhere)
    await act(async () => { render(<MapNotice notice={loading} onRetry={() => {}} canvasRef={canvasRef} />, container) })
    elsewhere.focus()

    await act(async () => { render(<MapNotice notice={hidden} onRetry={() => {}} canvasRef={canvasRef} />, container) })

    expect(document.activeElement).toBe(elsewhere)
  })

  it('announces only the status sentence, not the Retry label', async () => {
    await act(async () => { render(<MapNotice notice={failed} onRetry={() => {}} canvasRef={canvasRef} />, container) })

    const status = container.querySelector('[role="status"]')!
    expect(status.textContent).toBe('The map stopped drawing. Your Design is safe.')
    expect(status.querySelector('button')).toBeNull()
  })
})

describe('MapNotice on the visible-map-area seam', () => {
  it.each([
    ['in a window', null],
    ['on a phone held upright', 'portrait'],
  ] as const)('raises the chips\' bottom inset above itself, but never moves the camera\'s framing, %s', async (_name, phone) => {
    // Standing above the bottom row, the notice is under the selection chip's inset; it comes and goes with load state,
    // so a Design opened while it shows is framed as one opened after it goes, and it stands in that framing frame. On a
    // phone it stands where the selection chip would, so it registers there too.
    phoneLayout.value = phone
    const surfaces = createTestCanvasRuntimeSurfaces()
    const setFramingInsets = vi.spyOn(surfaces.commands.viewport, 'setFramingInsets')
    setCurrentCanvasSession(surfaces)
    const container = document.createElement('div')
    const area = document.createElement('div')
    const zoom = document.createElement('div')
    document.body.append(area, zoom, container)
    const boxes = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [area, { left: 0, top: 0, width: 900, height: 700 }],
      [zoom, { left: 498, top: 644, width: 390, height: 44 }],
    ])
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = boxes.get(this) ?? (this.hasAttribute('data-map-notice') ? { left: 210, top: 586, width: 480, height: 50 } : { left: 0, top: 0, width: 0, height: 0 })
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const releases = [registerMapArea(area), registerMapOccluder(zoom, 'bottom')]
    const canvasRef = { current: area }
    try {
      expect(setFramingInsets).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 56, left: 0 })
      const calls = setFramingInsets.mock.calls.length
      await act(async () => { render(<MapNotice notice={failed} onRetry={() => {}} canvasRef={canvasRef} />, container) })
      expect(area.style.getPropertyValue('--map-inset-bottom')).toBe('114px')
      expect(area.style.getPropertyValue('--map-framing-inset-bottom')).toBe('56px')
      await act(async () => { render(<MapNotice notice={hidden} onRetry={() => {}} canvasRef={canvasRef} />, container) })
      expect(area.style.getPropertyValue('--map-inset-bottom')).toBe('56px')
      expect(setFramingInsets, 'the notice coming and going never reframes').toHaveBeenCalledTimes(calls)
    } finally {
      await act(async () => { render(null, container) })
      for (const release of releases.reverse()) release()
      setCurrentCanvasSession(null)
      phoneLayout.value = null
      vi.restoreAllMocks()
      document.body.innerHTML = ''
    }
  })
})
