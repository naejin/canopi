// The rulers hint (spec §4.6, A16): turned with Rulers on in site mode, a pill above the view chip says the rulers show
// when north is up, with a Reset north link; it sits in the chip's wrapper, so the chip's 600 px rule hides both.
import { signal } from '@preact/signals'
import { readFileSync } from 'node:fs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rulersVisible } from '../../app/canvas-settings/signals'
import { registerMapArea, registerRail, toolRailRoom } from '../../app/shell/visible-map-area'
import { workspaceCanvasCommandProjection } from '../../app/workspace-commands/canvas-actions'
import { setCurrentCanvasSession } from '../../canvas/session'
import { createTestCanvasQuerySurface, createTestViewReadSurface } from '../../__tests__/support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from '../../__tests__/support/canvas-runtime-surfaces'
import { CanvasChrome } from './CanvasChrome'
import { ViewChip } from './ViewChip'

const northUp = signal(false)
const mode = signal<'site' | 'overview'>('site')
const resetNorth = vi.fn()
let container: HTMLDivElement

/** The chip as the canvas chrome renders it, from the live projection. */
function Chip() {
  const projection = workspaceCanvasCommandProjection.value
  return <ViewChip toggles={projection.settingsToggles} resetNorth={projection.viewActions.find((action) => action.id === 'reset-north')} />
}

function mount(): void {
  act(() => { render(<Chip />, container) })
}

const hint = () => container.querySelector<HTMLElement>('[data-rulers-north-hint]')
const chip = () => container.querySelector<HTMLElement>('[data-view-chip]')!

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  northUp.value = false
  mode.value = 'site'
  rulersVisible.value = true
  resetNorth.mockClear()
  setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
    queries: { ...createTestCanvasQuerySurface(), view: { ...createTestViewReadSurface(), northUp, mode } },
    commands: createTestCanvasCommandSurface({ viewport: { resetNorth } }),
  }))
})

afterEach(() => {
  act(() => { render(null, container) })
  setCurrentCanvasSession(null)
  rulersVisible.value = false
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('RulersNorthHint', () => {
  it('the hint shows when turned with Rulers on in site mode and registers under the rail', () => {
    const area = document.createElement('div')
    const rail = document.createElement('div')
    document.body.append(area, rail)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this === area ? { left: 0, top: 0, width: 1200, height: 800 }
        : this === rail ? { left: 12, top: 72, width: 48, height: 600 }
          : this.hasAttribute('data-view-chip') ? { left: 12, top: 748, width: 280, height: 40 }
            : this.hasAttribute('data-rulers-north-hint') ? { left: 12, top: 704, width: 300, height: 36 }
              : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) } as DOMRect
    })
    const releaseArea = registerMapArea(area)
    const releaseRail = registerRail('tool', rail)
    mount()

    expect(hint()?.textContent).toContain('Rulers show when north is up')
    // A quiet pill: no live region announces it.
    expect(hint()?.getAttribute('role')).toBeNull()
    expect(hint()?.getAttribute('aria-live')).toBeNull()
    expect(hint()?.querySelector('svg')).not.toBeNull()
    // The tool rail ends above the hint, the highest chrome under its column.
    expect(toolRailRoom.value).toBe(704 - 8 - 72)

    act(() => { northUp.value = true })
    expect(hint()).toBeNull()
    expect(toolRailRoom.value).toBe(748 - 8 - 72)
    act(() => { northUp.value = false; rulersVisible.value = false })
    expect(hint()).toBeNull()
    act(() => { rulersVisible.value = true; mode.value = 'overview' })
    expect(hint()).toBeNull()
    act(() => { mode.value = 'site' })
    expect(hint()).not.toBeNull()
    releaseRail()
    releaseArea()
  })

  it('it hides with the view chip under 600 px', () => {
    mount()
    const wrapper = chip().parentElement!
    expect(wrapper.contains(hint())).toBe(true)
    expect(wrapper).not.toBe(container)
    // The narrow-canvas rule hides the wrapper, the hint with the chip, and no longer the chip alone.
    const css = readFileSync('src/components/canvas/ViewChip.module.css', 'utf8')
    const narrow = /@container \(max-width: 600px\) \{(?<body>[\s\S]*?)\n\}/.exec(css)?.groups?.body ?? ''
    const wrapperClass = [...wrapper.classList][0]!
    expect(wrapperClass).toMatch(/wrapper/)
    expect(narrow).toMatch(/\.wrapper\s*\{\s*display:\s*none;\s*\}/)
    expect(narrow).not.toMatch(/\.chip\s*\{/)
  })

  it('the canvas chrome hands the view chip the Reset north command', () => {
    const canvasRef = { current: document.createElement('div') }
    act(() => { render(<CanvasChrome projection={workspaceCanvasCommandProjection.value} canvasRef={canvasRef} />, container) })
    const link = hint()?.querySelector<HTMLButtonElement>('button')
    expect(link?.dataset.command).toBe('view.resetNorth')
    act(() => { link!.click() })
    expect(resetNorth).toHaveBeenCalledOnce()
  })

  it('its link resets north', () => {
    mount()
    const link = hint()!.querySelector<HTMLButtonElement>('button')!
    expect(link.textContent).toBe('Reset north')
    act(() => { link.click() })
    expect(resetNorth).toHaveBeenCalledOnce()
  })
})
