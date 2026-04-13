import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../app/canvas-settings/controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/canvas-settings/controller')>()
  return {
    ...actual,
    commitBottomPanelHeight: vi.fn(),
  }
})

import { BottomPanel } from '../components/canvas/BottomPanel'
import { commitBottomPanelHeight } from '../app/canvas-settings/controller'
import { bottomPanelHeight, bottomPanelOpen, bottomPanelTab } from '../app/canvas-settings/bottom-panel-state'

describe('BottomPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    bottomPanelOpen.value = true
    bottomPanelTab.value = 'budget'
    bottomPanelHeight.value = 200
    vi.mocked(commitBottomPanelHeight).mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('commits resized height through the canvas-settings controller', async () => {
    await act(async () => {
      render(<BottomPanel />, container)
    })

    const resizeHandle = Array.from(container.querySelectorAll('div')).find((node) =>
      typeof node.className === 'string' && node.className.includes('resizeHandle'),
    ) as HTMLDivElement | undefined
    expect(resizeHandle).toBeTruthy()
    if (!resizeHandle) return

    Object.assign(resizeHandle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    await act(async () => {
      resizeHandle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientY: 300,
      }))
      resizeHandle.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientY: 240,
      }))
      resizeHandle.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        clientY: 240,
      }))
    })

    expect(vi.mocked(commitBottomPanelHeight)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(commitBottomPanelHeight)).toHaveBeenCalledWith(260)
  })
})
