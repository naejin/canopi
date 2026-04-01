import { plantDisplayMode, plantColorByAttr, type PlantDisplayMode, type ColorByAttribute } from '../../state/canvas'
import { t } from '../../i18n'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
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
  { value: 'flower', labelKey: 'canvas.display.flower' },
]

function buildItems<T extends string | null>(
  options: { value: T; labelKey: string }[],
): DropdownItem<T>[] {
  return options.map((o) => ({ value: o.value, label: t(o.labelKey) }))
}

function buildTrigger(labelKey: string, current: { labelKey: string } | undefined) {
  const displayLabel = current ? t(current.labelKey) : ''
  return (
    <>
      <span className={styles.label}>{t(labelKey)}</span>
      {displayLabel}
    </>
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

  const currentDisplay = DISPLAY_OPTIONS.find((o) => o.value === displayValue)
  const currentColorBy = COLOR_BY_OPTIONS.find((o) => o.value === colorByValue)

  return (
    <div className={styles.container} role="group" aria-label={t('canvas.display.label')}>
      <Dropdown
        trigger={buildTrigger('canvas.display.sizeBy', currentDisplay)}
        items={buildItems(DISPLAY_OPTIONS)}
        value={displayValue}
        onChange={handleDisplaySelect}
        menuDirection="up"
        ariaLabel={t('canvas.display.sizeBy')}
        triggerClassName={styles.trigger}
      />
      <div className={styles.divider} aria-hidden="true" />
      <Dropdown
        trigger={buildTrigger('canvas.display.colorBy', currentColorBy)}
        items={buildItems(COLOR_BY_OPTIONS)}
        value={colorByValue}
        onChange={handleColorBySelect}
        menuDirection="up"
        ariaLabel={t('canvas.display.colorBy')}
        triggerClassName={styles.trigger}
      />
    </div>
  )
}
