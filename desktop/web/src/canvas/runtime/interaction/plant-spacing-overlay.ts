import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import type { WorkspaceCameraFrameReader } from '../camera'
import type { ScenePoint } from '../scene'

interface PlantSpacingSourceView {
  id: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

interface PlantSpacingPreviewView {
  start: ScenePoint
  end: ScenePoint
  lengthLabel: string
  ghostPositions: readonly ScenePoint[]
  ghostColor: string
  ghostRadiusPx: number
}

/**
 * What Plant a row draws on the map: a ring on the picked plant, the dashed
 * row guide with its length and the plants the row would add. The tool card
 * (name, instruction, spacing field, count) is the shared Preact card.
 */
export interface PlantSpacingOverlayController {
  showSource(source: PlantSpacingSourceView, camera: WorkspaceCameraFrameReader): void
  showPreview(preview: PlantSpacingPreviewView, camera: WorkspaceCameraFrameReader): void
  hidePreview(): void
  refreshSourceHighlight(source: PlantSpacingSourceView | null, camera: WorkspaceCameraFrameReader): void
  hide(): void
  dispose(): void
}

export function createPlantSpacingOverlay(container: HTMLElement): PlantSpacingOverlayController {
  const highlight = document.createElement('div')
  highlight.style.cssText = [
    'position: absolute',
    'z-index: 4',
    'display: none',
    'pointer-events: none',
    'border: 2px solid var(--canvas-selection-stroke)',
    'border-radius: var(--radius-full)',
    'box-sizing: border-box',
    'box-shadow: 0 0 0 1px var(--canvas-interaction-casing), inset 0 0 0 1px var(--canvas-interaction-casing)',
    'background: transparent',
  ].join(';')

  const guide = document.createElement('div')
  guide.style.cssText = [
    'position: absolute',
    'z-index: 3',
    'display: none',
    'height: 0',
    'border-top: 2px dashed var(--canvas-selection-stroke)',
    'box-shadow: 0 0 0 1px var(--canvas-interaction-casing)',
    'transform-origin: 0 0',
    'pointer-events: none',
  ].join(';')

  const lengthLabel = document.createElement('div')
  lengthLabel.dataset.plantSpacingLengthLabel = 'true'
  lengthLabel.style.cssText = [
    'position: absolute',
    `font-family: ${CANVAS_CHROME_FONT_FAMILY}`,
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

  try {
    container.appendChild(ghosts)
    container.appendChild(guide)
    container.appendChild(lengthLabel)
    container.appendChild(highlight)
  } catch (error) {
    guide.remove()
    lengthLabel.remove()
    ghosts.remove()
    highlight.remove()
    throw error
  }

  function hideSourceHighlight(): void {
    highlight.style.display = 'none'
    highlight.removeAttribute('data-plant-spacing-source')
  }

  function updateSourceHighlight(sourceView: PlantSpacingSourceView, camera: WorkspaceCameraFrameReader): void {
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
    showSource(sourceView, camera) {
      updateSourceHighlight(sourceView, camera)
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
        const diameterPx = `${preview.ghostRadiusPx * 2}px`
        Object.assign(ghost.style, {
          position: 'absolute',
          left: `${screen.x}px`,
          top: `${screen.y}px`,
          width: diameterPx,
          height: diameterPx,
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
    refreshSourceHighlight(sourceView, camera) {
      if (!sourceView) {
        hideSourceHighlight()
        return
      }
      updateSourceHighlight(sourceView, camera)
    },
    hide() {
      hideSourceHighlight()
      hidePreview()
    },
    dispose() {
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
