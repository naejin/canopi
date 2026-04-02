import { computeSelectionRect } from '../../operations'
import type { ScenePoint } from '../scene'

export type InteractionPreviewMode = 'band' | 'rectangle'

export function createInteractionPreview(container: HTMLElement): HTMLDivElement {
  const preview = document.createElement('div')
  Object.assign(preview.style, {
    position: 'absolute',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '2',
    border: '1px dashed rgba(90, 115, 160, 0.9)',
    background: 'rgba(90, 115, 160, 0.16)',
    left: '0',
    top: '0',
  })
  container.appendChild(preview)
  return preview
}

export function showInteractionPreview(
  preview: HTMLElement,
  mode: InteractionPreviewMode,
  start: ScenePoint,
  end: ScenePoint,
): void {
  const rect = computeSelectionRect(start, end)
  Object.assign(preview.style, {
    display: 'block',
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderStyle: mode === 'rectangle' ? 'solid' : 'dashed',
    background: mode === 'rectangle' ? 'rgba(139, 127, 99, 0.18)' : 'rgba(90, 115, 160, 0.16)',
  })
}

export function hideInteractionPreview(preview: HTMLElement): void {
  preview.style.display = 'none'
}
