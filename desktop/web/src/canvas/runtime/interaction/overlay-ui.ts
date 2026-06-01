import { computeSelectionRect } from '../../operations'
import type { ScenePoint } from '../scene'

export type InteractionPreviewMode = 'band' | 'rectangle' | 'ellipse'

export function createInteractionPreview(container: HTMLElement): HTMLDivElement {
  const preview = document.createElement('div')
  Object.assign(preview.style, {
    position: 'absolute',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '2',
    border: '1px dashed var(--color-overlay-band-border)',
    background: 'var(--color-overlay-band-bg)',
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
    borderStyle: mode === 'band' ? 'dashed' : 'solid',
    borderRadius: mode === 'ellipse' ? '50%' : '0',
    background: mode === 'band' ? 'var(--color-overlay-band-bg)' : 'var(--color-overlay-rect-bg)',
  })
}

export function hideInteractionPreview(preview: HTMLElement): void {
  preview.style.display = 'none'
}
