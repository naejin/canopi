import { t } from '../../../i18n'
import type { CameraController } from '../camera'
import type { ScenePoint } from '../scene'
import { resolveCanvasNoticePlacement } from '../../canvas-notice-layout'

interface PlantSpacingSourceView {
  id: string
  label: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

interface PlantSpacingIntervalView {
  value: string
  valid: boolean
}

interface PlantSpacingPreviewView {
  start: ScenePoint
  end: ScenePoint
  lengthLabel: string
  ghostPositions: readonly ScenePoint[]
  ghostColor: string
}

interface PlantSpacingOverlayEvents {
  onCancel: () => void
  onIntervalInput: (value: string) => void
  onIntervalCommit: (value: string) => void
}

export interface PlantSpacingOverlayController {
  showSourcePicking(message?: string): void
  showSourceSelected(source: PlantSpacingSourceView, camera: CameraController, interval: PlantSpacingIntervalView): void
  setIntervalValidity(valid: boolean): void
  setGeneratedCount(count: number | null, options?: { dense?: boolean }): void
  showPreview(preview: PlantSpacingPreviewView, camera: CameraController): void
  hidePreview(): void
  focusIntervalInput(): void
  refreshSourceHighlight(source: PlantSpacingSourceView | null, camera: CameraController): void
  hide(): void
  dispose(): void
}

export function createPlantSpacingOverlay(
  container: HTMLElement,
  events: PlantSpacingOverlayEvents,
): PlantSpacingOverlayController {
  const hudPlacement = resolveCanvasNoticePlacement('tool-hud', {
    canvasWidth: container.clientWidth,
    canvasHeight: container.clientHeight,
    rulersVisible: true,
    scaleBarVisible: true,
  })
  const root = document.createElement('div')
  root.dataset.plantSpacingHud = 'true'
  root.dataset.canvasNoticePlacement = hudPlacement.placement
  root.dataset.compact = hudPlacement.compact ? 'true' : 'false'
  root.style.cssText = [
    'position: absolute',
    `top: ${hudPlacement.topPx}px`,
    `left: ${hudPlacement.leftPx}px`,
    'z-index: 25',
    'display: none',
    `min-width: ${Math.min(240, hudPlacement.maxWidthPx)}px`,
    `max-width: ${Math.min(320, hudPlacement.maxWidthPx)}px`,
    'padding: var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-md)',
    'box-shadow: 0 2px 6px rgba(44, 36, 24, 0.10)',
    'font-family: Inter, sans-serif',
    'color: var(--color-text)',
    'pointer-events: auto',
  ].join(';')
  root.style.top = `${hudPlacement.topPx}px`
  root.style.left = `${hudPlacement.leftPx}px`
  root.style.minWidth = `${Math.min(240, hudPlacement.maxWidthPx)}px`
  root.style.maxWidth = `${Math.min(320, hudPlacement.maxWidthPx)}px`
  root.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
  })

  const status = document.createElement('div')
  status.dataset.plantSpacingPrimary = 'true'
  status.style.cssText = [
    'font-size: var(--text-sm)',
    'font-weight: 600',
    'color: var(--color-text)',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
  ].join(';')

  const count = document.createElement('div')
  count.dataset.plantSpacingGeneratedCount = 'true'
  count.style.cssText = [
    'display: none',
    'margin-top: var(--space-1)',
    'font-size: var(--text-xs)',
    'font-weight: 400',
    'color: var(--color-text)',
    'font-variant-numeric: tabular-nums',
  ].join(';')

  const intervalRow = document.createElement('label')
  intervalRow.style.cssText = [
    'display: none',
    'margin-top: var(--space-2)',
    'gap: var(--space-2)',
    'align-items: center',
    'font-size: var(--text-xs)',
    'font-weight: 600',
    'color: var(--color-text-muted)',
  ].join(';')

  const intervalLabel = document.createElement('span')
  intervalLabel.textContent = t('canvas.plantSpacing.interval')

  const intervalInput = document.createElement('input')
  intervalInput.type = 'text'
  intervalInput.dataset.plantSpacingIntervalInput = 'true'
  intervalInput.inputMode = 'decimal'
  intervalInput.autocomplete = 'off'
  intervalInput.spellcheck = false
  intervalInput.style.cssText = [
    'width: 84px',
    'min-height: var(--control-size-md)',
    'padding: var(--space-1) var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-md)',
    'font-size: var(--text-sm)',
    'font-weight: 600',
    'font-variant-numeric: tabular-nums',
    'color: var(--color-text)',
    'outline: none',
  ].join(';')
  intervalInput.addEventListener('input', () => {
    events.onIntervalInput(intervalInput.value)
  })
  intervalInput.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      events.onIntervalCommit(intervalInput.value)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      events.onCancel()
    }
  })
  intervalInput.addEventListener('blur', () => {
    events.onIntervalCommit(intervalInput.value)
  })

  const hint = document.createElement('div')
  hint.style.cssText = [
    'margin-top: var(--space-1)',
    'font-size: var(--text-xs)',
    'font-weight: 400',
    'color: var(--color-text-muted)',
  ].join(';')

  const highlight = document.createElement('div')
  highlight.style.cssText = [
    'position: absolute',
    'z-index: 4',
    'display: none',
    'pointer-events: none',
    'border: 2px solid var(--color-primary)',
    'border-radius: var(--radius-full)',
    'box-sizing: border-box',
    'background: transparent',
  ].join(';')

  const guide = document.createElement('div')
  guide.style.cssText = [
    'position: absolute',
    'z-index: 3',
    'display: none',
    'height: 0',
    'border-top: 2px dashed var(--color-primary)',
    'transform-origin: 0 0',
    'pointer-events: none',
  ].join(';')

  const lengthLabel = document.createElement('div')
  lengthLabel.dataset.plantSpacingLengthLabel = 'true'
  lengthLabel.style.cssText = [
    'position: absolute',
    'z-index: 5',
    'display: none',
    'padding: var(--space-1) var(--space-2)',
    'background: var(--color-surface)',
    'border: 1px solid var(--color-border-strong, var(--color-border))',
    'border-radius: var(--radius-sm)',
    'font-size: var(--text-xs)',
    'font-weight: 600',
    'font-variant-numeric: tabular-nums',
    'color: var(--color-primary)',
    'pointer-events: none',
  ].join(';')

  const ghosts = document.createElement('div')
  ghosts.style.cssText = [
    'position: absolute',
    'inset: 0',
    'z-index: 3',
    'pointer-events: none',
  ].join(';')

  root.appendChild(status)
  intervalRow.appendChild(intervalLabel)
  intervalRow.appendChild(intervalInput)
  root.appendChild(intervalRow)
  root.appendChild(count)
  root.appendChild(hint)
  container.appendChild(ghosts)
  container.appendChild(guide)
  container.appendChild(lengthLabel)
  container.appendChild(highlight)
  container.appendChild(root)

  function refreshStaticLabels(): void {
    intervalLabel.textContent = t('canvas.plantSpacing.interval')
  }

  function show(): void {
    root.style.display = 'block'
  }

  function hideSourceHighlight(): void {
    highlight.style.display = 'none'
    highlight.removeAttribute('data-plant-spacing-source')
  }

  function setIntervalValidity(valid: boolean): void {
    root.dataset.intervalValidity = valid ? 'valid' : 'invalid'
    intervalInput.setAttribute('aria-invalid', valid ? 'false' : 'true')
    intervalInput.style.borderColor = valid
      ? 'var(--color-border-strong, var(--color-border))'
      : 'var(--color-danger, var(--color-primary))'
  }

  function updateSourceHighlight(sourceView: PlantSpacingSourceView, camera: CameraController): void {
    const start = camera.worldToScreen({ x: sourceView.bounds.x, y: sourceView.bounds.y })
    const end = camera.worldToScreen({
      x: sourceView.bounds.x + sourceView.bounds.width,
      y: sourceView.bounds.y + sourceView.bounds.height,
    })
    const rect = rectFromPoints(start, end)
    highlight.dataset.plantSpacingSource = sourceView.id
    Object.assign(highlight.style, {
      display: 'block',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  function hidePreview(): void {
    guide.style.display = 'none'
    guide.removeAttribute('data-plant-spacing-guide')
    lengthLabel.style.display = 'none'
    ghosts.replaceChildren()
  }

  return {
    showSourcePicking(message = t('canvas.plantSpacing.selectSource')) {
      refreshStaticLabels()
      root.dataset.state = 'source-picking'
      status.textContent = message
      count.style.display = 'none'
      count.textContent = ''
      count.removeAttribute('data-density')
      hint.textContent = t('canvas.plantSpacing.escToExit')
      intervalRow.style.display = 'none'
      root.removeAttribute('data-interval-validity')
      hideSourceHighlight()
      hidePreview()
      show()
    },
    showSourceSelected(sourceView, camera, interval) {
      refreshStaticLabels()
      root.dataset.state = 'source-selected'
      status.textContent = sourceView.label
      hint.textContent = t('canvas.plantSpacing.escToCancel')
      intervalInput.value = interval.value
      setIntervalValidity(interval.valid)
      intervalRow.style.display = 'flex'
      updateSourceHighlight(sourceView, camera)
      show()
    },
    setIntervalValidity,
    setGeneratedCount(generatedCount, options = {}) {
      if (generatedCount === null) {
        count.style.display = 'none'
        count.textContent = ''
        count.removeAttribute('data-density')
        return
      }
      count.textContent = t('canvas.plantSpacing.generatedCount', { count: generatedCount })
      count.dataset.density = options.dense ? 'dense' : 'normal'
      count.style.color = options.dense ? 'var(--color-primary)' : 'var(--color-text)'
      count.style.fontWeight = options.dense ? '600' : '400'
      count.style.display = 'block'
    },
    showPreview(preview, camera) {
      const start = camera.worldToScreen(preview.start)
      const end = camera.worldToScreen(preview.end)
      const dx = end.x - start.x
      const dy = end.y - start.y
      const length = Math.hypot(dx, dy)
      guide.dataset.plantSpacingGuide = 'true'
      Object.assign(guide.style, {
        display: 'block',
        left: `${start.x}px`,
        top: `${start.y}px`,
        width: `${length}px`,
        transform: `rotate(${Math.atan2(dy, dx)}rad)`,
      })

      lengthLabel.textContent = preview.lengthLabel
      Object.assign(lengthLabel.style, {
        display: 'block',
        left: `${(start.x + end.x) / 2}px`,
        top: `${(start.y + end.y) / 2}px`,
        transform: 'translate(-50%, calc(-100% - var(--space-1)))',
      })

      ghosts.replaceChildren(...preview.ghostPositions.map((position, index) => {
        const ghost = document.createElement('div')
        ghost.dataset.plantSpacingGhost = String(index)
        const screen = camera.worldToScreen(position)
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${screen.x}px`,
          top: `${screen.y}px`,
          width: '12px',
          height: '12px',
          borderRadius: 'var(--radius-full)',
          border: `2px solid ${preview.ghostColor}`,
          background: preview.ghostColor,
          opacity: '0.35',
          transform: 'translate(-50%, -50%)',
          boxSizing: 'border-box',
        })
        return ghost
      }))
    },
    hidePreview,
    focusIntervalInput() {
      intervalInput.focus({ preventScroll: true })
    },
    refreshSourceHighlight(sourceView, camera) {
      if (!sourceView) {
        hideSourceHighlight()
        return
      }
      updateSourceHighlight(sourceView, camera)
    },
    hide() {
      root.style.display = 'none'
      hideSourceHighlight()
      hidePreview()
    },
    dispose() {
      root.remove()
      guide.remove()
      lengthLabel.remove()
      ghosts.remove()
      highlight.remove()
    },
  }
}

function rectFromPoints(a: ScenePoint, b: ScenePoint): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}
