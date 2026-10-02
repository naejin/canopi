// app/keyboard/target-class.ts
//
// Owns where a key press comes from (spec §1.6, step 2): the focus class the key router's scopes read, and whether the
// target is a control, which keeps its own keys.

import { isEditableTarget } from '../../canvas/runtime/input/editable-target'

/** modal: a modal dialog holds the keys; text: a text field; map: the map host or a non-control inside it; body: nothing
 *  focused; other: rail buttons, dock lists, menus, controls inside the map. */
type FocusClass = 'modal' | 'text' | 'map' | 'body' | 'other'

/** A control, a field, a menu or a dialog keeps its own keys. */
const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menu"]',
  '[role="dialog"]',
  'dialog',
].join(',')

/** Roles whose widgets move their own focus or value with the arrows (spec §1.6, "arrow-owning widget"). */
const ARROW_OWNING_SELECTOR = [
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="grid"]',
  '[role="radiogroup"]',
  '[role="toolbar"]',
  '[role="separator"][tabindex]',
  '[data-owns-keys~="arrows"]',
].join(',')

export interface KeyTarget {
  readonly focus: FocusClass
  /** Inside a control, field, menu or dialog (a modal counts as one). */
  readonly control: boolean
  /** A text field: it types the key. */
  readonly text: boolean
}

export function classifyKeyTarget(target: EventTarget | null, host: HTMLElement | null, modal: boolean): KeyTarget {
  const element = elementOf(target)
  // jsdom leaves isContentEditable undefined on plain elements.
  const text = isEditableTarget(target) === true
  const control = modal || (element?.closest(CONTROL_SELECTOR) ?? null) !== null
  if (modal) return { focus: 'modal', control, text }
  if (text) return { focus: 'text', control, text }
  if (!element || element === document.body || element === document.documentElement) return { focus: 'body', control, text }
  if (host && host.contains(element) && !control) return { focus: 'map', control, text }
  return { focus: 'other', control, text }
}

/** An arrow-owning widget keeps its arrows, Shift+arrows included. */
export function ownsArrows(target: EventTarget | null): boolean {
  return (elementOf(target)?.closest(ARROW_OWNING_SELECTOR) ?? null) !== null
}

function elementOf(target: EventTarget | null): Element | null {
  if (typeof Element !== 'undefined' && target instanceof Element) return target
  return typeof Node !== 'undefined' && target instanceof Node ? target.parentElement : null
}
