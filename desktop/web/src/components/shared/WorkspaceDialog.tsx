import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef } from 'preact/hooks'
import { t } from '../../i18n'
import { ControlIcon } from './ControlIcon'
import styles from './WorkspaceDialog.module.css'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * A modal workspace dialog: Literata title, close button, focus moved in on
 * open, trapped while open and returned on close; Escape closes.
 */
export function WorkspaceDialog({ title, onClose, children, footer, wide = false }: {
  readonly title: string
  onClose(): void
  readonly children: ComponentChildren
  readonly footer?: ComponentChildren
  readonly wide?: boolean
}) {
  const dialog = useRef<HTMLElement>(null)
  const titleId = useId()

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
      ?? dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => previous?.focus?.()
  }, [])

  return (
    <div
      className={styles.overlay}
      onPointerUp={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        ref={dialog}
        className={`${styles.dialog} ${wide ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-preserve-overlays="true"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        <header className={styles.header}>
          <h2 className={styles.title} id={titleId}>{title}</h2>
          <button type="button" className={styles.close} aria-label={t('window.close')} onClick={onClose}>
            <ControlIcon name="close" size={18} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </section>
    </div>
  )
}
