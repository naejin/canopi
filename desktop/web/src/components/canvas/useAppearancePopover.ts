import { useLayoutEffect, useRef } from 'preact/hooks'

/** The appearance popover owns its viewport positioning and resize subscription. */
export function useAppearancePopover(open: boolean, buttonRef: { current: HTMLButtonElement | null }) {
  const menuRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const menu = menuRef.current
    const button = buttonRef.current
    if (!open || !menu || !button) return
    const place = () => {
      const anchor = button.getBoundingClientRect()
      const bounds = menu.getBoundingClientRect()
      menu.style.left = `${Math.max(8, Math.min(anchor.right + 8, window.innerWidth - bounds.width - 8))}px`
      menu.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - bounds.height - 8))}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, buttonRef])
  return menuRef
}

/** Arrow keys preview a choice; application still requires the explicit scope action. */
export function navigateAppearanceChoices(event: KeyboardEvent, columns: number) {
  const target = event.target
  if (!(target instanceof HTMLButtonElement) || target.getAttribute('role') !== 'option') return
  const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }
  const options = Array.from(target.closest('[role="dialog"]')?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
  const index = options.indexOf(target)
  const step = steps[event.key]
  if (index < 0 || (step === undefined && event.key !== 'Home' && event.key !== 'End')) return
  event.preventDefault()
  event.stopPropagation()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (step ?? 0) + options.length) % options.length
  options[next]?.focus()
  options[next]?.click()
}
