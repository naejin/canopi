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

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function allowsNativeContextMenuTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement
    ? target
    : (target instanceof Node ? target.parentElement : null)
  if (!element) return false
  if (isEditableTarget(element)) return true
  return element.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"], dialog') !== null
}
