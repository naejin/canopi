import type { ComponentChildren } from 'preact'
import { ButtonTooltip } from './ButtonTooltip'
import { ControlIcon } from './ControlIcon'
import styles from './SurfaceHeader.module.css'

/**
 * Shared chrome; callers retain navigation and dismissal ownership. No bare
 * count beside the title: the rows show it, and a summary worth reading is a
 * labelled sentence in the panel body.
 */
export function SurfaceHeader({ title, actions, onClose, closeLabel }: {
  title: string
  actions?: ComponentChildren
  onClose(): void
  closeLabel: string
}) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <div className={styles.actions}>
        {actions}
        <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
          <ControlIcon name="close" size={18} />
          <ButtonTooltip label={closeLabel} side="left" />
        </button>
      </div>
    </header>
  )
}
