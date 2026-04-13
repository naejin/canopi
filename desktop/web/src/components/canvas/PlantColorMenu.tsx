import { locale } from '../../app/shell/state'
import { plantColorMenuOpen, plantSpeciesColors } from '../../state/canvas'
import { useEffect, useRef, useState } from 'preact/hooks'
import { currentCanvasSelection, currentCanvasSession } from '../../canvas/session'
import {
  DEFAULT_PLANT_COLOR,
  PLANT_COLOR_PALETTE,
  hexToHsl,
  hslToHex,
  normalizeHexColor,
  pointerPositionToHue,
  pointerPositionToSaturationLightness,
  type HslColor,
} from '../../canvas/plant-colors'
import { t } from '../../i18n'
import styles from './PlantColorMenu.module.css'

interface PlantColorMenuProps {
  buttonRef: { current: HTMLButtonElement | null }
}

const DEFAULT_HSL = hexToHsl(DEFAULT_PLANT_COLOR) ?? { h: 122, s: 39, l: 49 }
const HUE_STRIP_BACKGROUND = `
  linear-gradient(
    to bottom,
    #FF0000 0%,
    #FFFF00 17%,
    #00FF00 33%,
    #00FFFF 50%,
    #0000FF 67%,
    #FF00FF 83%,
    #FF0000 100%
  )
`

function closeMenu(buttonRef?: { current: HTMLButtonElement | null }) {
  plantColorMenuOpen.value = false
  buttonRef?.current?.focus()
}

export function PlantColorMenu({ buttonRef }: PlantColorMenuProps) {
  void currentCanvasSelection.value
  void plantSpeciesColors.value
  const session = currentCanvasSession.value
  const activeLocale = locale.value
  const menuOpen = plantColorMenuOpen.value
  const context = session?.getSelectedPlantColorContext() ?? {
    plantIds: [],
    singleSpeciesCanonicalName: null,
    singleSpeciesCommonName: null,
    sharedCurrentColor: null,
    suggestedColor: null,
    singleSpeciesDefaultColor: null,
  }

  const [activeColor, setActiveColor] = useState<string | null>(DEFAULT_PLANT_COLOR)
  const [customInput, setCustomInput] = useState(DEFAULT_PLANT_COLOR)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [customColorHex, setCustomColorHex] = useState<string | null>(null)
  const [pickerColor, setPickerColor] = useState<HslColor>(DEFAULT_HSL)
  const [, setCacheVersion] = useState(0)

  const pickerColorRef = useRef<HslColor>(DEFAULT_HSL)
  const selectionKey = context.plantIds.join('|')
  const hasSelectedPlants = context.plantIds.length > 0
  const squareRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    pickerColorRef.current = pickerColor
  }, [pickerColor])

  function syncPickerFromHex(nextHex: string, options: { markCustom: boolean }): void {
    const normalized = normalizeHexColor(nextHex)
    if (!normalized) {
      setActiveColor(null)
      setCustomInput(nextHex)
      return
    }

    const nextHsl = hexToHsl(normalized) ?? DEFAULT_HSL
    pickerColorRef.current = nextHsl
    setPickerColor(nextHsl)
    setCustomInput(normalized)
    setActiveColor(normalized)
    if (options.markCustom) {
      setCustomColorHex(normalized)
    }
  }

  function syncPickerFromHsl(nextHsl: HslColor): void {
    pickerColorRef.current = nextHsl
    setPickerColor(nextHsl)
    const nextHex = hslToHex(nextHsl)
    setCustomInput(nextHex)
    setActiveColor(nextHex)
    setCustomColorHex(nextHex)
  }

  function beginPointerDrag(
    event: PointerEvent,
    ref: { current: HTMLElement | null },
    update: (nextEvent: PointerEvent, rect: DOMRect) => void,
  ): void {
    event.preventDefault()
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    update(event, rect)

    const handleMove = (nextEvent: PointerEvent) => {
      update(nextEvent, rect)
    }
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  useEffect(() => {
    if (!menuOpen) return

    const initialColor =
      context.sharedCurrentColor === 'mixed'
        ? context.singleSpeciesDefaultColor ?? context.suggestedColor ?? DEFAULT_PLANT_COLOR
        : context.sharedCurrentColor
          ?? context.singleSpeciesDefaultColor
          ?? context.suggestedColor
          ?? DEFAULT_PLANT_COLOR

    const initialHsl = hexToHsl(initialColor) ?? DEFAULT_HSL
    pickerColorRef.current = initialHsl
    setPickerColor(initialHsl)
    setActiveColor(initialColor)
    setCustomInput(initialColor)
    setCustomColorHex(null)
    setAdvancedOpen(false)
  }, [menuOpen, selectionKey, context.sharedCurrentColor, context.singleSpeciesDefaultColor, context.suggestedColor])

  useEffect(() => {
    if (!menuOpen || !context.singleSpeciesCanonicalName || context.suggestedColor) return

    const pending = session?.ensureSpeciesCacheEntries([context.singleSpeciesCanonicalName], activeLocale)
    if (!pending) return

    void pending.then((loaded) => {
      if (loaded) {
        setCacheVersion((value) => value + 1)
      }
    })
  }, [menuOpen, activeLocale, context.singleSpeciesCanonicalName, context.suggestedColor])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerUp = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-preserve-overlays="true"]')) return
      closeMenu()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu(buttonRef)
      }
    }

    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen, buttonRef])

  if (!menuOpen || !hasSelectedPlants) return null

  const normalizedActiveColor = normalizeHexColor(activeColor)
  const canApply = normalizedActiveColor !== null
  const singleSpeciesLabel = context.singleSpeciesCommonName ?? context.singleSpeciesCanonicalName
  const selectionSummary =
    singleSpeciesLabel
      ? singleSpeciesLabel
      : t('canvas.plantColor.selectedCount', { count: context.plantIds.length })
  const previewColor =
    normalizedActiveColor
    ?? customColorHex
    ?? context.singleSpeciesDefaultColor
    ?? context.suggestedColor
    ?? DEFAULT_PLANT_COLOR
  const canClearSelected = context.sharedCurrentColor !== null

  const applyToSelection = () => {
    if (!normalizedActiveColor) return
    session?.setSelectedPlantColor(normalizedActiveColor)
    closeMenu(buttonRef)
  }

  const applyToSpecies = () => {
    if (!normalizedActiveColor || !context.singleSpeciesCanonicalName) return
    session?.setPlantColorForSpecies(context.singleSpeciesCanonicalName, normalizedActiveColor)
    closeMenu(buttonRef)
  }

  const clearSelectedPlantColors = () => {
    session?.setSelectedPlantColor(null)
    closeMenu(buttonRef)
  }

  const clearSpeciesColor = () => {
    if (!context.singleSpeciesCanonicalName) return
    session?.clearPlantSpeciesColor(context.singleSpeciesCanonicalName)
    closeMenu(buttonRef)
  }

  const squareCursorLeft = `${pickerColor.s}%`
  const squareCursorTop = `${100 - pickerColor.l}%`
  const hueCursorTop = `${(pickerColor.h / 360) * 100}%`

  return (
    <div
      className={styles.menu}
      role="dialog"
      aria-label={t('canvas.plantColor.label')}
      data-preserve-overlays="true"
    >
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.sectionLabel}>{t('canvas.plantColor.label')}</div>
          <div className={styles.title}>{selectionSummary}</div>
          {context.singleSpeciesCommonName && context.singleSpeciesCanonicalName && (
            <div className={styles.subtitle}>
              <em>{context.singleSpeciesCanonicalName}</em>
            </div>
          )}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => closeMenu(buttonRef)}
          aria-label={t('window.close')}
        >
          ×
        </button>
      </div>

      {context.suggestedColor && context.sharedCurrentColor !== 'mixed' && (
        <div className={styles.suggestion}>
          <span className={styles.suggestionSwatch} style={{ backgroundColor: context.suggestedColor }} />
          {t('canvas.plantColor.suggested')}
        </div>
      )}

      <div className={styles.palette} role="listbox" aria-label={t('canvas.plantColor.label')}>
        {PLANT_COLOR_PALETTE.map((color) => {
          const active = normalizeHexColor(color.hex) === normalizedActiveColor
          return (
            <button
              key={color.hex}
              type="button"
              className={`${styles.swatch}${active ? ` ${styles.swatchActive}` : ''}`}
              style={{ backgroundColor: color.hex }}
              aria-label={color.name}
              aria-selected={active}
              onClick={() => {
                syncPickerFromHex(color.hex, { markCustom: false })
              }}
            />
          )
        })}
      </div>

      <div className={styles.moreColorsRow}>
        <button
          type="button"
          className={styles.moreColorsButton}
          aria-expanded={advancedOpen}
          onClick={() => { setAdvancedOpen((value) => !value) }}
        >
          {t('canvas.plantColor.moreColors')}
        </button>
        <button
          type="button"
          className={`${styles.customSwatchButton}${customColorHex ? '' : ` ${styles.customSwatchEmpty}`}${customColorHex && customColorHex === normalizedActiveColor ? ` ${styles.swatchActive}` : ''}`}
          aria-label={customColorHex ? t('canvas.plantColor.customSwatch') : t('canvas.plantColor.customSwatchEmpty')}
          disabled={!customColorHex}
          onClick={() => {
            if (!customColorHex) return
            syncPickerFromHex(customColorHex, { markCustom: true })
          }}
        >
          {customColorHex && (
            <span
              className={styles.customSwatchFill}
              style={{ backgroundColor: customColorHex }}
            />
          )}
        </button>
      </div>

      {advancedOpen && (
        <div className={styles.advancedSection}>
          <div className={styles.sectionLabel}>{t('canvas.plantColor.advanced')}</div>
          <div className={styles.advancedControls}>
            <div
              ref={squareRef}
              className={styles.colorSquare}
              aria-label={t('canvas.plantColor.saturationLightness')}
              style={{
                background: `
                  linear-gradient(to top, rgb(0 0 0 / 1), rgb(0 0 0 / 0) 50%),
                  linear-gradient(to bottom, rgb(255 255 255 / 1), rgb(255 255 255 / 0) 50%),
                  linear-gradient(to right, hsl(${pickerColor.h} 0% 50%), hsl(${pickerColor.h} 100% 50%))
                `,
              }}
              onPointerDown={(event) => {
                beginPointerDrag(event, squareRef, (nextEvent, rect) => {
                  const { s, l } = pointerPositionToSaturationLightness(nextEvent.clientX, nextEvent.clientY, rect)
                  syncPickerFromHsl({ ...pickerColorRef.current, s, l })
                })
              }}
            >
              <span
                className={styles.squareCursor}
                style={{ left: squareCursorLeft, top: squareCursorTop }}
              />
            </div>

            <div
              ref={hueRef}
              className={styles.hueStrip}
              aria-label={t('canvas.plantColor.hue')}
              style={{ background: HUE_STRIP_BACKGROUND }}
              onPointerDown={(event) => {
                beginPointerDrag(event, hueRef, (nextEvent, rect) => {
                  const nextHue = pointerPositionToHue(nextEvent.clientY, rect)
                  syncPickerFromHsl({ ...pickerColorRef.current, h: nextHue })
                })
              }}
            >
              <span className={styles.hueCursor} style={{ top: hueCursorTop }} />
            </div>
          </div>

          <div className={styles.hexRow}>
            <span
              className={styles.previewSwatch}
              style={{ backgroundColor: previewColor }}
              aria-label={t('canvas.plantColor.preview')}
            />
            <input
              className={styles.customInput}
              type="text"
              value={customInput}
              onInput={(event) => {
                const value = (event.currentTarget as HTMLInputElement).value
                setCustomInput(value)
                const normalized = normalizeHexColor(value)
                if (!normalized) {
                  setActiveColor(null)
                  return
                }
                syncPickerFromHex(normalized, { markCustom: true })
              }}
              placeholder="#C44230"
              aria-label={t('canvas.plantColor.customHex')}
              spellcheck={false}
            />
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryAction}
          disabled={!canApply}
          onClick={applyToSelection}
        >
          {t('canvas.plantColor.setColor')}
        </button>
        {context.singleSpeciesCanonicalName && singleSpeciesLabel && (
          <>
            <button type="button" className={styles.secondaryAction} disabled={!canApply} onClick={applyToSpecies}>
              {t('canvas.plantColor.setColorForSpecies', { species: singleSpeciesLabel })}
            </button>
            <div className={styles.helpText}>{t('canvas.plantColor.speciesDefaultHint')}</div>
          </>
        )}
      </div>

      <button type="button" className={styles.clearAction} disabled={!canClearSelected} onClick={clearSelectedPlantColors}>
        {t('canvas.plantColor.clearColor')}
      </button>
      {context.singleSpeciesCanonicalName && context.singleSpeciesDefaultColor && (
        <button type="button" className={styles.clearAction} onClick={clearSpeciesColor}>
          {t('canvas.plantColor.clearSpeciesColor')}
        </button>
      )}
    </div>
  )
}
