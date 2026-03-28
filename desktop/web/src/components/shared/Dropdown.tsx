import { useRef } from 'preact/hooks'
import { useSignal, useSignalEffect } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import styles from './Dropdown.module.css'

export interface DropdownItem<T> {
  value: T
  label: ComponentChildren
}

interface Props<T> {
  /** Rendered inside the trigger button alongside the chevron. */
  trigger: ComponentChildren
  items: DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  /** 'up' opens menu above trigger, 'down' below. Default: 'down'. */
  menuDirection?: 'up' | 'down'
  /** Accessible label for the trigger button and menu. */
  ariaLabel: string
  /** Extra class on the outermost wrapper. */
  className?: string
  /** Extra class on the trigger button. */
  triggerClassName?: string
  /** Extra class on the menu container. */
  menuClassName?: string
  /** Extra class on each option button. */
  optionClassName?: string
}

export function Dropdown<T>({
  trigger,
  items,
  value,
  onChange,
  menuDirection = 'down',
  ariaLabel,
  className,
  triggerClassName,
  menuClassName,
  optionClassName,
}: Props<T>) {
  const open = useSignal(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close on click-outside (pointerup, not mousedown — avoids catching the opening click)
  // Close on Escape — return focus to trigger
  useSignalEffect(() => {
    if (!open.value) return
    const handleOutside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        open.value = false
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open.value = false
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerup', handleOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerup', handleOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  })

  const menuDirClass = menuDirection === 'up' ? styles.menuUp : styles.menuDown

  return (
    <div className={`${styles.dropdown}${className ? ` ${className}` : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        className={`${styles.trigger}${triggerClassName ? ` ${triggerClassName}` : ''}`}
        type="button"
        onClick={() => { open.value = !open.value }}
        aria-expanded={open.value}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        {trigger}
        <span
          className={`${styles.chevron} ${open.value ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {open.value && (
        <div
          className={`${styles.menu} ${menuDirClass}${menuClassName ? ` ${menuClassName}` : ''}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {items.map((item) => (
            <button
              key={String(item.value)}
              className={`${styles.option} ${item.value === value ? styles.optionActive : ''}${optionClassName ? ` ${optionClassName}` : ''}`}
              role="option"
              type="button"
              aria-selected={item.value === value}
              onClick={() => {
                onChange(item.value)
                open.value = false
                triggerRef.current?.focus()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
