export interface HoverTooltipController {
  show(screenX: number, screenY: number, commonName: string | null, scientificName: string): void
  hide(): void
  dispose(): void
}

const OFFSET_PX = 12
const MAX_WIDTH_PX = 260

export function createHoverTooltip(container: HTMLElement): HoverTooltipController {
  const el = document.createElement('div')
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
    'font-family: Inter, sans-serif',
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
  container.appendChild(el)

  return {
    show(screenX, screenY, commonName, scientificName) {
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
