import { useId } from 'preact/hooks'
import styles from './slider.module.css'

/**
 * One slider everywhere (opacity in Layers and Site data, symbol size in the
 * Species key and Settings; finding 11): a label with the formatted value
 * beside it, and a native range input drawn as a thin track and an accent
 * thumb in every engine. The same text is the input's `aria-valuetext`, so a
 * screen reader hears "40 %", not "40".
 */
export function Slider({ label, ariaLabel, value, min, max, step = 1, format, disabled = false, onInput }: {
  readonly label: string
  /** The input's accessible name when the visible label is not enough ("Opacity: Zones"). */
  readonly ariaLabel?: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
  format(value: number): string
  readonly disabled?: boolean
  onInput(value: number): void
}) {
  const labelId = useId()
  const text = format(value)
  return (
    <div className={styles.field}>
      <span className={styles.label}>
        <span id={labelId}>{label}</span>
        <output className={styles.value}>{text}</output>
      </span>
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelId}
        aria-valuetext={text}
        onInput={(event) => onInput(Number(event.currentTarget.value))}
      />
    </div>
  )
}
