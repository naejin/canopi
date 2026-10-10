import { useRef } from 'preact/hooks'

/**
 * Backdrop handlers for a dialog's scrim. A press closes the dialog only when
 * it starts and ends on the scrim, so a drag that begins in a field (selecting
 * its text) and is released outside keeps the dialog and what was typed.
 */
export function useScrimPress(onClose: () => void): {
  onPointerDown(event: Event): void
  onPointerUp(event: Event): void
} {
  const pressedInside = useRef(false)
  return {
    onPointerDown: (event) => { pressedInside.current = event.target !== event.currentTarget },
    onPointerUp: (event) => {
      const release = event.target === event.currentTarget && !pressedInside.current
      pressedInside.current = false
      if (release) onClose()
    },
  }
}
