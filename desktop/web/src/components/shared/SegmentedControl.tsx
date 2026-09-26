import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import styles from './SegmentedControl.module.css'

export interface SegmentedOption<T> {
  readonly value: T
  readonly label: ComponentChildren
  readonly disabled?: boolean
}

/**
 * A single choice among a few visible options: a radio group with one tab stop.
 * Arrow keys, Home and End move and select, skipping disabled segments; segments wrap
 * onto new lines instead of clipping long translations.
 */
export function SegmentedControl<T>({ label, options, value, onChange, className }: {
  readonly label: string
  readonly options: readonly SegmentedOption<T>[]
  readonly value: T
  onChange(value: T): void
  readonly className?: string
}) {
  const radios = useRef<Array<HTMLButtonElement | null>>([])
  const checkedIndex = options.findIndex((option) => option.value === value)
  const tabStop = checkedIndex >= 0 && !options[checkedIndex]!.disabled
    ? checkedIndex
    : options.findIndex((option) => !option.disabled)

  function choose(index: number): void {
    const option = options[index]
    if (!option || option.disabled) return
    radios.current[index]?.focus()
    if (option.value !== value) onChange(option.value)
  }

  function step(from: number, direction: 1 | -1): number {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (from + direction * offset + options.length) % options.length
      if (!options[index]!.disabled) return index
    }
    return from
  }

  function onKeyDown(event: KeyboardEvent, index: number): void {
    const enabled = options.flatMap((option, candidate) => option.disabled ? [] : [candidate])
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = step(index, 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = step(index, -1)
    else if (event.key === 'Home') next = enabled[0] ?? null
    else if (event.key === 'End') next = enabled.at(-1) ?? null
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    choose(next)
  }

  return (
    <div className={`${styles.group}${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const checked = index === checkedIndex
        return (
          <button
            key={String(option.value)}
            ref={(radio) => { radios.current[index] = radio }}
            type="button"
            role="radio"
            className={styles.segment}
            aria-checked={checked}
            aria-disabled={option.disabled ? true : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => choose(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
