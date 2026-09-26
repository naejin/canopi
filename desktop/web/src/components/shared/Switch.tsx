import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import styles from './Switch.module.css'

/** An on/off setting: a native checkbox with `role="switch"`, drawn as a track and knob. */
export function Switch({ label, hint, checked, disabled = false, onChange, className }: {
  readonly label: ComponentChildren
  readonly hint?: ComponentChildren
  readonly checked: boolean
  readonly disabled?: boolean
  onChange(checked: boolean): void
  readonly className?: string
}) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-hint`
  return (
    <label className={`${styles.row}${className ? ` ${className}` : ''}`} data-disabled={disabled ? 'true' : undefined}>
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {hint && <span id={hintId} className={styles.hint}>{hint}</span>}
      </span>
      <span className={styles.control}>
        <input
          type="checkbox"
          role="switch"
          className={styles.input}
          checked={checked}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => {
            const next = event.currentTarget.checked
            // Stay controlled: the owner decides whether the new state sticks.
            event.currentTarget.checked = checked
            onChange(next)
          }}
        />
        <span className={styles.track} aria-hidden="true" />
      </span>
    </label>
  )
}
