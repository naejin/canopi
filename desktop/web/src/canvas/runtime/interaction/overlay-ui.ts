import { computeSelectionRect } from '../../operations'
import type { ScenePoint } from '../scene'

export type InteractionPreviewMode = 'band' | 'rectangle' | 'ellipse' | 'line'

// Every preview stroke sits on a casing painted on both sides of the border so
// it reads on bright or dark imagery: the band selection box is 2 px ochre over
// a 5 px casing, drafts are light 2 px strokes over a 4 px dark casing.
const SELECTION_BOX_BORDER = '2px solid var(--canvas-selection-stroke)'
const SELECTION_BOX_CASING = '0 0 0 1.5px var(--canvas-interaction-casing), inset 0 0 0 1.5px var(--canvas-interaction-casing)'
const DRAFT_BORDER = '2px solid var(--canvas-guide-line)'
const DRAFT_CASING = '0 0 0 1px var(--canvas-overlay-casing), inset 0 0 0 1px var(--canvas-overlay-casing)'
const DRAFT_LINE_CASING = '0 0 0 1px var(--canvas-overlay-casing)'

export function createInteractionPreview(container: HTMLElement): HTMLDivElement {
  const preview = document.createElement('div')
  Object.assign(preview.style, {
    position: 'absolute',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '2',
    border: SELECTION_BOX_BORDER,
    boxShadow: SELECTION_BOX_CASING,
    background: 'var(--canvas-selection)',
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
  if (mode === 'line') {
    const dx = end.x - start.x
    const dy = end.y - start.y
    Object.assign(preview.style, {
      display: 'block',
      left: `${start.x}px`,
      top: `${start.y}px`,
      width: `${Math.hypot(dx, dy)}px`,
      height: '0',
      border: '0',
      borderTop: DRAFT_BORDER,
      borderRadius: '0',
      boxShadow: DRAFT_LINE_CASING,
      background: 'transparent',
      transform: `rotate(${Math.atan2(dy, dx)}rad)`,
      transformOrigin: '0 0',
    })
    return
  }

  const rect = computeSelectionRect(start, end)
  Object.assign(preview.style, {
    display: 'block',
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: mode === 'band' ? SELECTION_BOX_BORDER : DRAFT_BORDER,
    borderRadius: mode === 'ellipse' ? '50%' : '0',
    boxShadow: mode === 'band' ? SELECTION_BOX_CASING : DRAFT_CASING,
    background: mode === 'band' ? 'var(--canvas-selection)' : 'var(--canvas-zone-fill)',
    transform: 'none',
    transformOrigin: '0 0',
  })
}

export function hideInteractionPreview(preview: HTMLElement): void {
  preview.style.display = 'none'
}
