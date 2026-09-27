import type { RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { holdModalLayer, registerModalInertRegion } from '../../app/shell/modal-layer'

/**
 * Makes the calling dialog modal: the chrome behind it is inert while it is
 * mounted, and focus goes back to what had it once the chrome is live again.
 * The element that had focus is read before the chrome turns inert, since a
 * browser drops focus from an element that becomes inert.
 */
export function useModalLayer(): void {
  useLayoutEffect(() => {
    const previous = document.activeElement
    const release = holdModalLayer()
    return () => {
      release()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
}

/** Marks chrome that must be inert while a modal dialog is open. */
export function useModalInertRegion(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const element = ref.current
    return element ? registerModalInertRegion(element) : undefined
  }, [ref])
}
