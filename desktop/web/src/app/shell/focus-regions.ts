import { modalLayerOpen } from './modal-layer'

/**
 * The workspace's keyboard regions, in F6 order: the title bar, the tool
 * rail, the map and the open dock panel. F6 moves focus to the next region
 * that is showing, Shift F6 to the previous one, returning to the control
 * last focused there (else the region's own tab stop). Each region
 * registers while it is mounted; the platform bootstrap installs the keys.
 */
export type FocusRegionId = 'title-bar' | 'tool-rail' | 'map' | 'dock'

const ORDER: readonly FocusRegionId[] = ['title-bar', 'tool-rail', 'map', 'dock']
const FOCUSABLE = [
  '[tabindex="0"]',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
].join(',')

const regions = new Map<FocusRegionId, HTMLElement>()
const lastFocused = new WeakMap<HTMLElement, HTMLElement>()

/** A mounted region; returns its release. */
export function registerFocusRegion(id: FocusRegionId, element: HTMLElement): () => void {
  regions.set(id, element)
  const remember = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target !== element) lastFocused.set(element, event.target)
  }
  element.addEventListener('focusin', remember)
  return () => {
    element.removeEventListener('focusin', remember)
    if (regions.get(id) === element) regions.delete(id)
  }
}

function showing(element: HTMLElement): boolean {
  return element.isConnected && !element.hidden && element.closest('[inert]') === null
    && getComputedStyle(element).display !== 'none'
}

function focusTarget(region: HTMLElement): HTMLElement | null {
  const last = lastFocused.get(region)
  if (last && region.contains(last) && showing(last) && last.matches(FOCUSABLE)) return last
  if (region.tabIndex >= 0 && region.hasAttribute('tabindex')) return region
  for (const candidate of region.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (showing(candidate)) return candidate
  }
  return null
}

/** Moves focus into a showing region, to the control last focused there; false when it cannot. */
export function focusRegion(id: FocusRegionId): boolean {
  const element = regions.get(id)
  if (!element || !showing(element)) return false
  const target = focusTarget(element)
  if (!target) return false
  target.focus({ preventScroll: true })
  return document.activeElement === target
}

/** Moves focus to the next (1) or previous (-1) showing region; false when there is none. */
export function cycleFocusRegion(step: 1 | -1): boolean {
  const active = document.activeElement
  const current = ORDER.findIndex((id) => {
    const element = regions.get(id)
    return !!element && active instanceof Node && element.contains(active)
  })
  for (let offset = 1; offset <= ORDER.length; offset += 1) {
    const start = current < 0 ? (step === 1 ? -1 : 0) : current
    const index = (start + step * offset + ORDER.length * 2) % ORDER.length
    const element = regions.get(ORDER[index]!)
    if (!element || !showing(element) || index === current) continue
    const target = focusTarget(element)
    if (!target) continue
    target.focus({ preventScroll: true })
    return true
  }
  return false
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'F6' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
  // A modal dialog keeps focus inside it.
  if (modalLayerOpen.peek()) return
  if (cycleFocusRegion(event.shiftKey ? -1 : 1)) event.preventDefault()
}

let disposeInstalled: (() => void) | null = null

/** F6 and Shift F6 on the window; returns the uninstall. */
export function installFocusRegionKeys(): () => void {
  disposeInstalled?.()
  window.addEventListener('keydown', handleKeyDown, true)
  const dispose = (): void => {
    window.removeEventListener('keydown', handleKeyDown, true)
    if (disposeInstalled === dispose) disposeInstalled = null
  }
  disposeInstalled = dispose
  return dispose
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeInstalled?.())
}
