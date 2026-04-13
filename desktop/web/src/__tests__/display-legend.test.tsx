import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { plantColorByAttr } from '../canvas/plant-display-state'
import { DisplayLegend } from '../components/canvas/DisplayLegend'

describe('DisplayLegend', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    plantColorByAttr.value = null
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    plantColorByAttr.value = null
  })

  it('reacts to color-by signal changes while mounted', async () => {
    await act(async () => {
      render(<DisplayLegend />, container)
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Legend')

    await act(async () => {
      plantColorByAttr.value = 'flower'
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Legend')
  })
})
