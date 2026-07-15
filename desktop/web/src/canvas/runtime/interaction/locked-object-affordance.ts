import { t } from '../../../i18n'
import type { SceneDesignObjectTarget } from '../scene'

interface LockedObjectAffordanceOptions {
  readonly container: HTMLElement
  readonly onUnlock: (target: SceneDesignObjectTarget) => void
}

interface LockedObjectAffordanceView {
  readonly target: SceneDesignObjectTarget
  readonly screenX: number
  readonly screenY: number
}

export interface LockedObjectAffordanceController {
  show(view: LockedObjectAffordanceView): void
  hide(): void
  contains(target: EventTarget | null): boolean
  dispose(): void
}

const OFFSET_PX = 12
const SVG_NS = 'http://www.w3.org/2000/svg'

export function createLockedObjectAffordance(
  options: LockedObjectAffordanceOptions,
): LockedObjectAffordanceController {
  let activeTarget: SceneDesignObjectTarget | null = null
  const root = document.createElement('div')
  root.dataset.lockedObjectAffordance = 'true'
  root.style.cssText = [
    'position: absolute',
    'z-index: 27',
    'display: none',
    'align-items: center',
    'gap: var(--space-1)',
    'padding: var(--space-1)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-md)',
    'box-shadow: 0 2px 6px rgba(44, 36, 24, 0.10)',
    'font-family: Inter, sans-serif',
    'color: var(--color-text)',
    'pointer-events: auto',
  ].join(';')
  root.addEventListener('pointerdown', stopCanvasEvent)
  root.addEventListener('pointermove', stopCanvasEvent)
  root.addEventListener('pointerup', stopCanvasEvent)
  root.addEventListener('click', stopCanvasEvent)

  const status = document.createElement('span')
  status.dataset.lockedObjectStatus = 'true'
  status.style.cssText = [
    'display: inline-flex',
    'align-items: center',
    'gap: var(--space-1)',
    'font-size: var(--text-xs)',
    'font-weight: 600',
    'line-height: 1.2',
    'white-space: nowrap',
  ].join(';')
  status.appendChild(createLockIcon())
  const statusText = document.createElement('span')
  status.appendChild(statusText)

  const unlockButton = document.createElement('button')
  unlockButton.type = 'button'
  unlockButton.dataset.lockedObjectUnlock = 'true'
  unlockButton.style.cssText = [
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'width: var(--control-size-md)',
    'height: var(--control-size-md)',
    'padding: 0',
    'border: 1px solid transparent',
    'border-radius: var(--radius-sm)',
    'background: transparent',
    'color: var(--color-primary)',
    'cursor: pointer',
    'outline: none',
  ].join(';')
  unlockButton.appendChild(createUnlockIcon())
  unlockButton.addEventListener('pointerenter', () => {
    unlockButton.style.background = 'var(--color-primary-bg)'
  })
  unlockButton.addEventListener('pointerleave', () => {
    if (document.activeElement !== unlockButton) unlockButton.style.background = 'transparent'
  })
  unlockButton.addEventListener('focus', () => {
    unlockButton.style.borderColor = 'var(--color-primary)'
    unlockButton.style.background = 'var(--color-primary-bg)'
  })
  unlockButton.addEventListener('blur', () => {
    unlockButton.style.borderColor = 'transparent'
    unlockButton.style.background = 'transparent'
  })
  unlockButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (activeTarget) options.onUnlock(activeTarget)
  })
  unlockButton.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    if (activeTarget) options.onUnlock(activeTarget)
  })

  root.replaceChildren(status, unlockButton)

  function refreshLabels(): void {
    statusText.textContent = t('canvas.selectionActions.locked')
    unlockButton.setAttribute('aria-label', t('canvas.selectionActions.unlock'))
  }

  try {
    options.container.appendChild(root)
    refreshLabels()
  } catch (error) {
    root.remove()
    throw error
  }

  return {
    show(view) {
      refreshLabels()
      activeTarget = { ...view.target }
      root.dataset.lockedObjectId = view.target.id
      root.dataset.lockedObjectKind = view.target.kind
      root.style.display = 'inline-flex'
      const x = clamp(view.screenX + OFFSET_PX, 0, Math.max(0, options.container.clientWidth - root.offsetWidth))
      const y = clamp(view.screenY + OFFSET_PX, 0, Math.max(0, options.container.clientHeight - root.offsetHeight))
      root.style.left = `${x}px`
      root.style.top = `${y}px`
    },
    hide() {
      activeTarget = null
      root.style.display = 'none'
      delete root.dataset.lockedObjectId
      delete root.dataset.lockedObjectKind
    },
    contains(target) {
      return target instanceof Node && root.contains(target)
    },
    dispose() {
      root.remove()
    },
  }
}

function createLockIcon(): SVGSVGElement {
  const svg = iconShell()
  const shackle = document.createElementNS(SVG_NS, 'path')
  shackle.setAttribute('d', 'M7 9V7a3 3 0 016 0v2')
  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute('d', 'M5 9h10v7H5z')
  for (const path of [shackle, body]) styleIconPath(path)
  svg.append(shackle, body)
  return svg
}

function createUnlockIcon(): SVGSVGElement {
  const svg = iconShell()
  const shackle = document.createElementNS(SVG_NS, 'path')
  shackle.setAttribute('d', 'M8 9V7a3 3 0 015.2-2')
  const body = document.createElementNS(SVG_NS, 'path')
  body.setAttribute('d', 'M5 9h10v7H5z')
  const key = document.createElementNS(SVG_NS, 'path')
  key.setAttribute('d', 'M10 12v2')
  for (const path of [shackle, body, key]) styleIconPath(path)
  svg.append(shackle, body, key)
  return svg
}

function iconShell(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  return svg
}

function styleIconPath(path: SVGPathElement): void {
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.7')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function stopCanvasEvent(event: Event): void {
  event.stopPropagation()
}
