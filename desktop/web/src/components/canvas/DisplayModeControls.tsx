import { useRef, useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { plantDisplayMode, plantColorByAttr, type PlantDisplayMode, type ColorByAttribute } from '../../state/canvas'
import { t } from '../../i18n'
import styles from './DisplayModeControls.module.css'

const DISPLAY_OPTIONS: { value: PlantDisplayMode; labelKey: string }[] = [
  { value: 'default', labelKey: 'canvas.display.default' },
  { value: 'canopy', labelKey: 'canvas.display.canopySpread' },
]

const COLOR_BY_OPTIONS: { value: ColorByAttribute | null; labelKey: string }[] = [
  { value: null, labelKey: 'canvas.display.none' },
  { value: 'stratum', labelKey: 'canvas.display.stratum' },
  { value: 'hardiness', labelKey: 'canvas.display.hardiness' },
  { value: 'lifecycle', labelKey: 'canvas.display.lifecycle' },
  { value: 'nitrogen', labelKey: 'canvas.display.nitrogen' },
  { value: 'edibility', labelKey: 'canvas.display.edibility' },
]

function Dropdown<T extends string | null>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string
  options: { value: T; labelKey: string }[]
  value: T
  onSelect: (v: T) => void
}) {
  const open = useSignal(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Close on click-outside (pointerup, not mousedown — avoids catching opening click)
  useEffect(() => {
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
  }, [open.value])

  const current = options.find((o) => o.value === value)
  const displayLabel = current ? t(current.labelKey) : ''

  return (
    <div className={styles.dropdown} ref={ref}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        onClick={() => { open.value = !open.value }}
        aria-expanded={open.value}
        aria-haspopup="listbox"
        aria-label={label}
      >
        <span className={styles.label}>{label}</span>
        {displayLabel}
        <span
          className={`${styles.chevron} ${open.value ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {open.value && (
        <div className={styles.menu} role="listbox" aria-label={label}>
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              className={`${styles.option} ${opt.value === value ? styles.optionActive : ''}`}
              role="option"
              type="button"
              aria-selected={opt.value === value}
              onClick={() => {
                onSelect(opt.value)
                open.value = false
                triggerRef.current?.focus()
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DisplayModeControls() {
  const mode = plantDisplayMode.value
  const colorAttr = plantColorByAttr.value

  // Derive the effective display value: if mode is 'color-by', show as default/canopy based
  // on the underlying size mode. Display dropdown only controls default vs canopy.
  const displayValue: PlantDisplayMode = mode === 'color-by' ? 'default' : mode

  // Derive the effective color-by value: null if not in color-by mode
  const colorByValue: ColorByAttribute | null = mode === 'color-by' ? colorAttr : null

  const handleDisplaySelect = (v: PlantDisplayMode) => {
    plantDisplayMode.value = v
  }

  const handleColorBySelect = (v: ColorByAttribute | null) => {
    if (v === null) {
      // "None" selected — revert to whatever display mode makes sense
      // If currently color-by, go back to default
      if (mode === 'color-by') {
        plantDisplayMode.value = 'default'
      }
    } else {
      plantDisplayMode.value = 'color-by'
      plantColorByAttr.value = v
    }
  }

  return (
    <div className={styles.container} role="group" aria-label={t('canvas.display.label')}>
      <Dropdown
        label={t('canvas.display.sizeBy')}
        options={DISPLAY_OPTIONS}
        value={displayValue}
        onSelect={handleDisplaySelect}
      />
      <div className={styles.divider} aria-hidden="true" />
      <Dropdown
        label={t('canvas.display.colorBy')}
        options={COLOR_BY_OPTIONS}
        value={colorByValue}
        onSelect={handleColorBySelect}
      />
    </div>
  )
}
