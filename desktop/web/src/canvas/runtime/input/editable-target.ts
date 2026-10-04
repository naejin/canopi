// canvas/runtime/input/editable-target.ts
//
// Owns the one "is this a text field" test that key handling shares: typing in an input, textarea, select or
// content-editable element keeps its keys. The shell's shortcut dispatchers, the story undo key and the canvas key path
// read it; tools never see DOM targets (keys reach them as ToolCommands through the keyboard port).

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}
