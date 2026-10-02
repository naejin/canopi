// canvas/runtime/chrome/text-entry-host.ts
//
// Owns the note's text entry (ToolHostDeps.chrome.requestTextEntry, spec §1.4): one textarea over the map, which the host
// opens for a tool and whose state it reads live (isOpen). 'create' is today's new-note field, 'edit' today's in-place
// editor of a note (its font size, its text's frame, select-all). Enter and a blur hand the text to the tool's submit, which
// closes the entry or keeps the same field open while its commit is refused; an entry whose blur commit was refused no
// longer holds focus, so the press or menu that would have blurred it submits it instead (submitUnfocused). Esc is the
// entry's own handler and discards it before any canvas key handling hears it (spec §3.7), then tells the opener
// (onCancel), so a tool can follow the cancel. Closing a focused entry returns focus to the map
// (focusMap('text-entry-closed')). The field stays on its anchor through camera moves ('overlays' frames). It
// listens only on its own textarea (P6).

import { CANVAS_CHROME_FONT_FAMILY } from '../../chrome-fonts'
import { annotationScreenFrameAt } from '../annotation-layout'
import type { CanvasFocusPort } from '../app-adapter'
import type { TextEntryRequest } from '../tools/tool'
import type { ViewFrame, ViewFrameSource } from '../view/types'

export interface TextEntryHostOptions {
  readonly container: HTMLElement
  readonly frames: ViewFrameSource
  readonly translate: (key: string) => string
  readonly focus: Pick<CanvasFocusPort, 'focusMap'>
}

export interface TextEntryHost {
  /** Opens an entry; an open one is submitted first and stays open when its commit is refused. The same note asked again
   *  keeps its field (today's start of an editor already open). onCancel runs after the entry's own Esc closed it. */
  open(request: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void
  /** Discards the open entry without submitting it (no onCancel: the caller closed it). */
  close(): void
  /** Submits an open entry that does not hold focus (its blur commit was refused); one that holds focus is left to its blur. */
  submitUnfocused(): void
  isOpen(): boolean
  dispose(): void
}

interface OpenEntry {
  readonly request: TextEntryRequest
  readonly submit: (text: string) => 'close' | 'keep'
  readonly onCancel: (() => void) | undefined
  readonly textarea: HTMLTextAreaElement
}

const MIN_WIDTH_PX = 120
const MIN_HEIGHT_PX = 24
/** A new note's size until it is written; an edited note's comes from its request. */
const DEFAULT_NOTE_FONT_SIZE_PX = 16

export function createTextEntryHost(options: TextEntryHostOptions): TextEntryHost {
  let active: OpenEntry | null = null
  let disposed = false
  const stopFollowing = options.frames.onViewFrame('overlays', (frame) => {
    if (active) place(active, frame)
  })

  function open(request: TextEntryRequest, submit: (text: string) => 'close' | 'keep', onCancel?: () => void): void {
    if (disposed) return
    if (active && sameEntry(active.request, request)) {
      active.textarea.focus()
      active.textarea.select()
      return
    }
    if (active) {
      submitActive()
      if (active) return
    }

    const textarea = document.createElement('textarea')
    const entry: OpenEntry = { request, submit, onCancel, textarea }
    textarea.dataset.canvasTextEntry = request.mode
    textarea.setAttribute('aria-label', options.translate('canvas.tools.text'))
    textarea.value = request.initialText
    if (request.mode === 'edit') {
      textarea.dataset.annotationInlineEditor = 'true'
      textarea.dataset.preserveOverlays = 'true'
    } else {
      textarea.placeholder = options.translate(request.placeholderKey)
    }
    styleEntry(entry)
    place(entry, options.frames.viewFrame.peek())
    active = entry
    options.container.appendChild(textarea)
    if (request.mode === 'edit') autosize(entry)

    textarea.addEventListener('input', () => autosize(entry))
    textarea.addEventListener('blur', () => {
      if (active === entry) submitActive()
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (active !== entry) return
        closeActive()
        entry.onCancel?.()
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (active === entry) submitActive()
      }
    })
    requestAnimationFrame(() => {
      if (active !== entry) return
      textarea.focus()
      if (request.mode === 'edit') textarea.select()
    })
  }

  function submitActive(): void {
    const entry = active
    if (!entry) return
    if (entry.submit(entry.textarea.value) === 'close' && active === entry) closeActive()
  }

  function closeActive(): void {
    const entry = active
    if (!entry) return
    // Cleared before the removal, whose blur must not submit what is being discarded.
    active = null
    const hadFocus = entry.textarea === document.activeElement
    entry.textarea.remove()
    if (hadFocus) options.focus.focusMap('text-entry-closed')
  }

  return {
    open,
    close: closeActive,
    submitUnfocused() {
      if (active && active.textarea !== document.activeElement) submitActive()
    },
    isOpen: () => active !== null,
    dispose() {
      if (disposed) return
      disposed = true
      stopFollowing()
      closeActive()
    },
  }
}

/** The same note's editor: today's start() of the annotation already being edited. */
function sameEntry(open: TextEntryRequest, next: TextEntryRequest): boolean {
  return open.mode === 'edit'
    && next.mode === 'edit'
    && open.anchor.x === next.anchor.x
    && open.anchor.y === next.anchor.y
    && open.initialText === next.initialText
}

/** Today's two fields: the new note's (text-annotation-tool.ts) and the in-place editor's (annotation-inline-editor.ts). */
function styleEntry({ request, textarea }: OpenEntry): void {
  Object.assign(textarea.style, {
    position: 'absolute',
    minWidth: `${MIN_WIDTH_PX}px`,
    minHeight: `${MIN_HEIGHT_PX}px`,
    padding: '2px 4px',
    background: 'var(--color-surface)',
    border: '1px solid var(--color-primary)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    fontFamily: CANVAS_CHROME_FONT_FAMILY,
    fontSize: request.mode === 'edit' ? `${noteFontSize(request)}px` : 'var(--text-base)',
    lineHeight: request.mode === 'edit' ? '1.25' : '1.4',
    color: 'var(--color-text)',
    zIndex: '3',
    whiteSpace: 'pre',
    transformOrigin: 'top left',
  })
}

/** At the anchor projected through the frame; an edited note keeps its text's frame and turns with the note. */
function place({ request, textarea }: OpenEntry, frame: ViewFrame): void {
  const origin = frame.view.worldToScreen(request.anchor)
  const rotationDeg = request.rotationDeg - frame.view.camera.bearingDeg
  if (request.mode === 'create') {
    Object.assign(textarea.style, {
      left: `${origin.x}px`,
      top: `${origin.y}px`,
      transform: rotationDeg === 0 ? '' : `rotate(${rotationDeg}deg)`,
    })
    return
  }
  const text = annotationScreenFrameAt(
    { text: request.initialText, fontSize: noteFontSize(request), rotationDeg },
    origin,
  )
  Object.assign(textarea.style, {
    left: `${text.origin.x}px`,
    top: `${text.origin.y}px`,
    width: `${Math.max(text.widthPx + 8, MIN_WIDTH_PX)}px`,
    minHeight: `${Math.max(text.heightPx + 4, MIN_HEIGHT_PX)}px`,
    transform: text.rotationDeg === 0 ? '' : `rotate(${text.rotationDeg}deg)`,
  })
}

/** Today's growth: the new note's field follows its content, the editor never shrinks below one line. */
function autosize({ request, textarea }: OpenEntry): void {
  textarea.style.height = 'auto'
  textarea.style.height = request.mode === 'edit'
    ? `${Math.max(textarea.scrollHeight, MIN_HEIGHT_PX)}px`
    : `${textarea.scrollHeight}px`
}

function noteFontSize(request: TextEntryRequest): number {
  return request.fontSizePx ?? DEFAULT_NOTE_FONT_SIZE_PX
}
