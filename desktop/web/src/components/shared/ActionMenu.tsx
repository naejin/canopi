import { createPortal } from 'preact/compat'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { ButtonTooltip } from './ButtonTooltip'
import styles from './ActionMenu.module.css'

/** A compact command menu, portalled so scrollable lists cannot clip actions. */
export function ActionMenu({ label, items }: {
  label: string
  items: readonly { label: string; run(): void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const popup = menu.current
    const rect = popup.getBoundingClientRect()
    popup.style.left = `${Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8))}px`
    popup.style.top = `${Math.max(8, anchor.bottom + rect.height + 8 <= window.innerHeight ? anchor.bottom + 4 : anchor.top - rect.height - 4)}px`
    popup.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: Event) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    const dismiss = (event: Event) => { if (!(event.target instanceof Node) || !popup.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerup', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerup', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open])
  return <>
    <button ref={trigger} type="button" className={styles.trigger} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) }
      }}>⋯<ButtonTooltip label={label} side="left" /></button>
    {open && createPortal(<div ref={menu} className={styles.menu} role="menu" aria-label={label} data-preserve-overlays="true"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus()
        } else if (event.key === 'Tab') {
          setOpen(false); trigger.current?.focus()
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}>
      {items.map(item => <button key={item.label} type="button" role="menuitem" aria-label={item.label} data-danger={item.danger}
        onClick={() => { setOpen(false); trigger.current?.focus(); item.run() }}>{item.label}</button>)}
    </div>, document.body)}
  </>
}
