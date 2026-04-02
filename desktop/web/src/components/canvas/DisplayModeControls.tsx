import { plantColorByAttr, plantSizeMode, type PlantSizeMode, type ColorByAttribute } from '../../state/canvas'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import { getCurrentCanvasSession } from '../../canvas/session'
import { Dropdown, type DropdownItem } from '../shared/Dropdown'
import styles from './DisplayModeControls.module.css'

const DISPLAY_OPTIONS: { value: PlantSizeMode; labelKey: string }[] = [
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
  void locale.value
  const sizeMode = plantSizeMode.value
  const colorAttr = plantColorByAttr.value

  const handleDisplaySelect = (v: PlantSizeMode) => {
    const session = getCurrentCanvasSession()
    if (session) session.setPlantSizeMode(v)
    else plantSizeMode.value = v
  }

  const handleColorBySelect = (v: ColorByAttribute | null) => {
    const session = getCurrentCanvasSession()
    if (session) session.setPlantColorByAttr(v)
    else plantColorByAttr.value = v
  }

  const currentDisplay = DISPLAY_OPTIONS.find((o) => o.value === sizeMode)
  const currentColorBy = COLOR_BY_OPTIONS.find((o) => o.value === colorAttr)

  return (
    <div className={styles.container} role="group" aria-label={t('canvas.display.label')}>
      <Dropdown
        trigger={buildTrigger('canvas.display.sizeBy', currentDisplay)}
        items={buildItems(DISPLAY_OPTIONS)}
        value={sizeMode}
        onChange={handleDisplaySelect}
        menuDirection="up"
        ariaLabel={t('canvas.display.sizeBy')}
        triggerClassName={styles.trigger}
      />
      <div className={styles.divider} aria-hidden="true" />
      <Dropdown
        trigger={buildTrigger('canvas.display.colorBy', currentColorBy)}
        items={buildItems(COLOR_BY_OPTIONS)}
        value={colorAttr}
        onChange={handleColorBySelect}
        menuDirection="up"
        ariaLabel={t('canvas.display.colorBy')}
        triggerClassName={styles.trigger}
      />
    </div>
  )
}
