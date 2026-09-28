import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const inspection = vi.hoisted(() => ({ target: null as unknown, endInspection: vi.fn() }))
vi.mock('../app/lidar/inspection', async () => {
  const { signal } = await import('@preact/signals')
  const target = signal<{ name: string } | null>({ name: 'Slope' })
  inspection.target = target
  return {
    inspectionTarget: target,
    inspectionSample: signal({ kind: 'idle' }),
    inspectionLocation: signal(null),
    endInspection: inspection.endInspection,
    sampleInspectionCentre: vi.fn(),
  }
})

import { InspectionStatus } from '../components/canvas/InspectionStatus'

describe('InspectionStatus Escape', () => {
  afterEach(() => {
    render(null, document.body)
    document.body.innerHTML = ''
    inspection.endInspection.mockClear()
  })

  async function mount(): Promise<void> {
    await act(async () => { render(<InspectionStatus />, document.body) })
  }

  function pressEscape(defaultPrevented: boolean): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    if (defaultPrevented) event.preventDefault()
    document.dispatchEvent(event)
    return event
  }

  it('ends inspection on an Escape nobody has consumed', async () => {
    await mount()
    const event = pressEscape(false)
    expect(inspection.endInspection).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  // The map's Esc chain (leave the tool, clear the selection) runs first in
  // window capture and prevents the default; one Esc does one thing.
  it('leaves an Escape the map Esc chain already consumed alone', async () => {
    await mount()
    pressEscape(true)
    expect(inspection.endInspection).not.toHaveBeenCalled()
  })
})
