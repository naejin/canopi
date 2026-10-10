import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { locale } from '../../app/settings/state'
import { mapAttributionFolded, registerMapArea, registerMapOccluder, visibleMapFrame } from '../../app/shell/visible-map-area'
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

describe('MapNotice over the map credits', () => {
  it('folds the credits into (i) while it shows, as bottom chrome on the visible-map-area seam', async () => {
    const container = document.createElement('div')
    const area = document.createElement('div')
    const viewChip = document.createElement('div')
    const zoom = document.createElement('div')
    document.body.append(area, viewChip, zoom, container)
    const boxes = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [area, { left: 0, top: 0, width: 1280, height: 800 }],
      [viewChip, { left: 12, top: 744, width: 280, height: 44 }],
      [zoom, { left: 900, top: 744, width: 368, height: 44 }],
    ])
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = boxes.get(this) ?? (this.hasAttribute('data-map-notice') ? { left: 460, top: 748, width: 360, height: 40 } : { left: 0, top: 0, width: 0, height: 0 })
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const releases = [registerMapArea(area), registerMapOccluder(viewChip, 'bottom'), registerMapOccluder(zoom, 'bottom')]
    const canvasRef = { current: area }
    try {
      // 608 px between the view chip and the zoom group: the credits fit on one line.
      expect(mapAttributionFolded.value).toBe(false)
      await act(async () => { render(<MapNotice notice={failed} onRetry={() => {}} canvasRef={canvasRef} />, container) })
      expect(mapAttributionFolded.value).toBe(true)
      await act(async () => { render(<MapNotice notice={hidden} onRetry={() => {}} canvasRef={canvasRef} />, container) })
      expect(mapAttributionFolded.value).toBe(false)
    } finally {
      await act(async () => { render(null, container) })
      for (const release of releases.reverse()) release()
      vi.restoreAllMocks()
      document.body.innerHTML = ''
    }
  })

  it('is the chip where it shows: risen above the row, it raises the visible map frame, so a selection chip sits above it', async () => {
    const container = document.createElement('div')
    const area = document.createElement('div')
    const zoom = document.createElement('div')
    document.body.append(area, zoom, container)
    const boxes = new Map<Element, { left: number; top: number; width: number; height: number }>([
      [area, { left: 0, top: 0, width: 1024, height: 768 }],
      [zoom, { left: 622, top: 716, width: 390, height: 40 }],
    ])
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // The chip has risen above the row: the zoom group left it too little room there.
      const box = boxes.get(this) ?? (this.hasAttribute('data-map-notice') ? { left: 336, top: 670, width: 352, height: 34 } : { left: 0, top: 0, width: 0, height: 0 })
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const releases = [registerMapArea(area), registerMapOccluder(zoom, 'bottom')]
    try {
      expect(visibleMapFrame.value.bottom).toBe(52)
      await act(async () => { render(<MapNotice notice={failed} onRetry={() => {}} canvasRef={{ current: area }} />, container) })
      expect(visibleMapFrame.value.bottom).toBe(768 - 670)
      expect(area.style.getPropertyValue('--map-inset-bottom')).toBe('98px')
    } finally {
      await act(async () => { render(null, container) })
      for (const release of releases.reverse()) release()
      vi.restoreAllMocks()
      document.body.innerHTML = ''
    }
  })
})
