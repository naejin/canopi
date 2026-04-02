export function cursorForTool(tool: string): string {
  if (tool === 'hand') return 'grab'
  if (tool === 'rectangle') return 'crosshair'
  if (tool === 'text') return 'text'
  if (tool === 'plant-stamp') return 'crosshair'
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
