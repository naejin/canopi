// canopi-23p2: the top-centre chips share one slot, which registers with the visible-map-area seam, so they stack
// instead of covering each other. Their rects are checked in Playwright (design-reveal.spec.ts, map-container.spec.ts);
// jsdom has no layout, so this checks the structure.
import { render } from 'preact'
import { createRef } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const onboarding = vi.hoisted(() => ({
  cardOpen: null as unknown as { value: boolean },
}))

vi.mock('../../app/site-onboarding/state', async () => {
  const { signal } = await import('@preact/signals')
  onboarding.cardOpen = signal(false)
  return {
    siteLocateOpen: signal(false),
    startDesignCardOpen: onboarding.cardOpen,
    foundSiteLabel: signal(null),
    finishSiteLocate: () => {},
    closeStartDesignCard: () => {},
    searchSiteAgain: () => {},
  }
})

import { registerMapArea, visibleMapFrame } from '../../app/shell/visible-map-area'
import { workspaceCanvasCommandProjection } from '../../app/workspace-commands/canvas-actions'
import { setCurrentCanvasSession } from '../../canvas/session'
import { createTestCanvasQuerySurface } from '../../__tests__/support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from '../../__tests__/support/canvas-runtime-surfaces'
import { CanvasChrome } from './CanvasChrome'

describe('the top-centre chip slot', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    // Below 0.1 px/m the map is in overview.
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({ placement: { x: 0, y: 0, scale: 0.01 } }),
    }))
  })

  afterEach(async () => {
    await act(async () => { render(null, container) })
    setCurrentCanvasSession(null)
    onboarding.cardOpen.value = false
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('the overview notice and the found-site chip render in one top-centre slot', async () => {
    onboarding.cardOpen.value = true
    const canvasRef = createRef<HTMLDivElement>()
    await act(async () => {
      render(<div ref={canvasRef}><CanvasChrome projection={workspaceCanvasCommandProjection.value} canvasRef={canvasRef} /></div>, container)
    })

    const slot = container.querySelector<HTMLElement>('[data-top-chip-slot]')!
    expect(slot).not.toBeNull()
    expect(slot.querySelector('[data-overview-notice]')?.parentElement).toBe(slot)
    expect(slot.querySelector('[data-found-site]')?.parentElement).toBe(slot)
    // The Start card keeps its own place beside the tool rail; only its found-place chip moved into the slot.
    expect(container.querySelector('[data-start-design]')!.closest('[data-top-chip-slot]')).toBeNull()
    // The overview pin is not a chip: it stays where the Design is.
    expect(container.querySelector('[data-overview-pin]')?.closest('[data-top-chip-slot]') ?? null).toBeNull()
  })

  it('registers the slot as chrome over the top edge of the map', async () => {
    const area = document.createElement('div')
    document.body.append(area)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this === area ? { left: 0, top: 0, width: 1280, height: 800 }
        : this.hasAttribute('data-top-chip-slot') ? { left: 460, top: 72, width: 360, height: 92 }
          : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const release = registerMapArea(area)
    try {
      const canvasRef = createRef<HTMLDivElement>()
      await act(async () => {
        render(<div ref={canvasRef}><CanvasChrome projection={workspaceCanvasCommandProjection.value} canvasRef={canvasRef} /></div>, container)
      })
      expect(visibleMapFrame.value.top).toBe(164)
    } finally {
      release()
    }
  })
})
