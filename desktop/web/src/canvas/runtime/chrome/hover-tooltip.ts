// canvas/runtime/chrome/hover-tooltip.ts
//
// Owns the plant tooltip of the ToolHost's passive hover (ToolHostDeps.chrome.setTooltip, spec §1.4): the plant's common and
// scientific names beside the pointer, kept inside the map, with the look it had before v2 (at a4c86d39). The element
// joins the map at its first show, so a map whose tools never show it carries none.

import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'

export interface HoverTooltipController {
  show(screenX: number, screenY: number, commonName: string | null, scientificName: string): void
  hide(): void
  dispose(): void
}

const OFFSET_PX = 12
const MAX_WIDTH_PX = 260

export function createHoverTooltip(container: HTMLElement): HoverTooltipController {
  const el = document.createElement('div')
  el.dataset.hoverTooltip = 'true'
  el.dataset.canvasChrome = 'hover-tooltip'
  el.style.cssText = [
    'position: absolute',
    'pointer-events: none',
    'z-index: 20',
    'display: none',
    'padding: var(--space-1) var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border)',
    'border-radius: var(--radius-md)',
    'white-space: nowrap',
    `max-width: ${MAX_WIDTH_PX}px`,
    `font-family: ${CANVAS_CHROME_FONT_FAMILY}`,
  ].join(';')

  const commonEl = document.createElement('div')
  commonEl.style.cssText = [
    'font-weight: 600',
    'font-size: var(--text-sm)',
    'color: var(--color-text)',
    'overflow: hidden',
    'text-overflow: ellipsis',
  ].join(';')

  const scientificEl = document.createElement('div')
  scientificEl.style.cssText = [
    'font-style: italic',
    'font-size: var(--text-xs)',
    'color: var(--color-text-muted)',
  ].join(';')

  el.appendChild(commonEl)
  el.appendChild(scientificEl)

  return {
    show(screenX, screenY, commonName, scientificName) {
      if (el.parentNode !== container) container.appendChild(el)
      commonEl.textContent = commonName || ''
      commonEl.style.display = commonName ? '' : 'none'
      scientificEl.textContent = scientificName

      // Show first so offsetWidth/offsetHeight are accurate for clamping
      el.style.display = 'block'

      let x = screenX + OFFSET_PX
      let y = screenY + OFFSET_PX

      // Clamp to container bounds
      const cw = container.clientWidth
      const ch = container.clientHeight
      const ew = el.offsetWidth
      const eh = el.offsetHeight
      if (x + ew > cw) x = screenX - ew - OFFSET_PX
      if (y + eh > ch) y = screenY - eh - OFFSET_PX

      el.style.left = `${x}px`
      el.style.top = `${y}px`
    },
    hide() {
      el.style.display = 'none'
    },
    dispose() {
      el.remove()
    },
  }
}
