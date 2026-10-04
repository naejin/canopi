// app/keyboard/target-class.ts
//
// Owns where a key press comes from (spec §1.6, step 2): the focus class the key router's scopes read, and whether the
// target is a control, which keeps its own keys. With nothing focused (<body>) the key is the map's only when the last
// pointer press or focus move landed in the map host: a click on a dock panel's text also leaves focus on <body>, and so
// does a dock control that unmounts while focused. Also whether the key comes from the side-panel dock or the phone
// sheet (the roots that carry DOCK_KEY_REGION), focused there or on <body> after a press or focus move there: the map's
// selection edits leave such a key to the page, so the browser's copy and select all work on the panel's text.

import { isEditableTarget } from '../../canvas/runtime/input/editable-target'

/** modal: a modal dialog holds the keys; text: a text field; map: the map host or a non-control inside it, or nothing
 *  focused after a press on the map; other: rail buttons, dock lists, menus, controls inside the map, and nothing focused
 *  after a press anywhere else (or none yet). */
export type FocusClass = 'modal' | 'text' | 'map' | 'other'

/** The side-panel dock's root (SidePanelDock) and the phone sheet's (PhoneSheet) carry `data-key-region="dock"`. */
export const DOCK_KEY_REGION = 'dock'
const DOCK_SELECTOR = `[data-key-region="${DOCK_KEY_REGION}"]`

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
  /** A text field: it types the key. */
  readonly text: boolean
  /** Nothing is focused (<body>) and no modal is open, whatever the last press: Space holds for panning there (spec §1.6,
   *  step 3). */
  readonly unfocused: boolean
  /** The key comes from the dock or the phone sheet: focus is there, or on <body> after a press or focus move there. */
  readonly dock: boolean
}

/** Where the last pointer press or focus move in the document landed. */
export interface LastPress {
  /** Inside the map host. */
  readonly onMap: boolean
  /** Inside the dock or the phone sheet. */
  readonly inDock: boolean
}

export function classifyKeyTarget(
  target: EventTarget | null,
  host: HTMLElement | null,
  modal: boolean,
  last: LastPress,
): KeyTarget {
  const element = elementOf(target)
  // jsdom leaves isContentEditable undefined on plain elements.
  const text = isEditableTarget(target) === true
  const control = (element?.closest(CONTROL_SELECTOR) ?? null) !== null
  const unfocused = !element || element === document.body || element === document.documentElement
  const dock = unfocused ? last.inDock : isInDock(element)
  if (modal) return { focus: 'modal', text, unfocused: false, dock }
  if (text) return { focus: 'text', text, unfocused, dock }
  if (unfocused) return { focus: host && last.onMap ? 'map' : 'other', text, unfocused, dock }
  if (host && host.contains(element) && !control) return { focus: 'map', text, unfocused, dock }
  return { focus: 'other', text, unfocused, dock }
}

/** Inside the side-panel dock or the phone sheet. */
export function isInDock(target: EventTarget | null): boolean {
  return (elementOf(target)?.closest(DOCK_SELECTOR) ?? null) !== null
}

/** An arrow-owning widget keeps its arrows, Shift+arrows included. */
export function ownsArrows(target: EventTarget | null): boolean {
  return (elementOf(target)?.closest(ARROW_OWNING_SELECTOR) ?? null) !== null
}

function elementOf(target: EventTarget | null): Element | null {
  if (typeof Element !== 'undefined' && target instanceof Element) return target
  return typeof Node !== 'undefined' && target instanceof Node ? target.parentElement : null
}
