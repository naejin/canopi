import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapNoticeReadModel } from '../../app/canvas-map-surface/map-notice'
import { locale } from '../../app/settings/state'
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

    await act(async () => { render(<MapNotice notice={hidden} onRetry={onRetry} canvasRef={canvasRef} />, container) })

    expect(container.querySelector('[data-map-notice]')).toBeNull()
    expect(document.activeElement).toBe(canvas)
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
