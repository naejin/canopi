import type { ScenePoint } from '../scene'
import { isEditableTarget } from '../input/editable-target'

export function cursorForTool(tool: string): string {
  if (tool === 'hand') return 'grab'
  if (tool === 'line') return 'crosshair'
  if (tool === 'measurement-guide') return 'crosshair'
  if (tool === 'rectangle') return 'crosshair'
  if (tool === 'ellipse') return 'crosshair'
  if (tool === 'polygon') return 'crosshair'
  if (tool === 'text') return 'text'
  if (tool === 'plant-stamp') return 'crosshair'
  if (tool === 'object-stamp') return 'crosshair'
  if (tool === 'plant-spacing') return 'crosshair'
  return 'default'
}

export function hasAdditiveModifier(event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): boolean {
  return Boolean(event.shiftKey || event.ctrlKey || event.metaKey)
}

// The legacy tool modules still read DOM key targets until their streams port them (plan §4 0B).
export { isEditableTarget } from '../input/editable-target'

export function allowsNativeContextMenuTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement
    ? target
    : (target instanceof Node ? target.parentElement : null)
  if (!element) return false
  if (isEditableTarget(element)) return true
  return element.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], dialog') !== null
}

/** Shift while drawing: the point along the nearest 45° direction from `origin`. */
export function constrainPointTo45Degrees(origin: ScenePoint, point: ScenePoint): ScenePoint {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const length = Math.hypot(dx, dy)
  if (length <= 0.000001) return { ...origin }

  const angle = Math.atan2(dy, dx)
  const constrainedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
  return {
    x: origin.x + Math.cos(constrainedAngle) * length,
    y: origin.y + Math.sin(constrainedAngle) * length,
  }
}
