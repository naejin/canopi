import { useEffect, useState } from 'preact/hooks'
import { currentCanvasPlantPresentationCommandSurface, currentCanvasQuerySurface, currentCanvasSelection } from '../../canvas/session'
import { plantSymbolMenuOpen } from '../../canvas/plant-symbol-menu-state'
import { DEFAULT_PLANT_COLOR, normalizeHexColor } from '../../canvas/plant-colors'
import {
  DEFAULT_PLANT_SYMBOL_ID,
  type PlantSymbolId,
} from '../../canvas/runtime/scene'
import { t } from '../../i18n'
import { PlantSymbolGlyph } from './PlantSymbolGlyph'
import styles from './PlantSymbolMenu.module.css'

interface PlantSymbolMenuProps {
  buttonRef: { current: HTMLButtonElement | null }
}

const HABIT_SYMBOLS: readonly PlantSymbolId[] = ['tree', 'shrub', 'herbaceous', 'climber', 'groundcover']
const ABSTRACT_SYMBOLS: readonly PlantSymbolId[] = ['round', 'square', 'triangle', 'cross', 'wave']

function closeMenu(buttonRef?: { current: HTMLButtonElement | null }) {
  plantSymbolMenuOpen.value = false
  buttonRef?.current?.focus()
}

export function PlantSymbolMenu({ buttonRef }: PlantSymbolMenuProps) {
  void currentCanvasSelection.value
  const commandSurface = currentCanvasPlantPresentationCommandSurface.value
  const querySurface = currentCanvasQuerySurface.value
  void querySurface?.revision.plantNames.value
  const menuOpen = plantSymbolMenuOpen.value
  const context = querySurface?.getSelectedPlantSymbolContext() ?? {
    plantIds: [],
    singleSpeciesCanonicalName: null,
    singleSpeciesCommonName: null,
    sharedCurrentSymbol: null,
    sharedEffectiveSymbol: DEFAULT_PLANT_SYMBOL_ID,
    inheritedSymbol: null,
    singleSpeciesDefaultSymbol: null,
    canClearSelectedSymbol: false,
  }
  const [activeSymbol, setActiveSymbol] = useState<PlantSymbolId>(DEFAULT_PLANT_SYMBOL_ID)
  const selectionKey = context.plantIds.join('|')
  const hasSelectedPlants = context.plantIds.length > 0

  useEffect(() => {
    if (!menuOpen) return
    setActiveSymbol(resolveInitialSymbol(
      context.sharedCurrentSymbol,
      context.inheritedSymbol,
      context.sharedEffectiveSymbol,
    ))
  }, [menuOpen, selectionKey, context.sharedCurrentSymbol, context.sharedEffectiveSymbol, context.inheritedSymbol])

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

  const singleSpeciesLabel = context.singleSpeciesCommonName ?? context.singleSpeciesCanonicalName
  const selectionSummary =
    singleSpeciesLabel
      ? singleSpeciesLabel
      : t('canvas.plantSymbol.selectedCount', { count: context.plantIds.length })
  const statusText = describeCurrentSymbol(
    context.sharedCurrentSymbol,
    context.inheritedSymbol,
    context.sharedEffectiveSymbol,
  )
  const previewColor = resolvePreviewColor(context.plantIds[0] ?? null)

  const applyToSelection = () => {
    commandSurface?.setSelectedPlantSymbol(activeSymbol)
    closeMenu(buttonRef)
  }

  const applyToSpecies = () => {
    if (!context.singleSpeciesCanonicalName) return
    commandSurface?.setPlantSymbolForSpecies(context.singleSpeciesCanonicalName, activeSymbol)
    closeMenu(buttonRef)
  }

  return (
    <div
      className={styles.menu}
      role="dialog"
      aria-label={t('canvas.plantSymbol.label')}
      data-preserve-overlays="true"
    >
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.sectionLabel}>{t('canvas.plantSymbol.label')}</div>
          <div className={styles.title}>{selectionSummary}</div>
          {context.singleSpeciesCommonName && context.singleSpeciesCanonicalName && (
            <div className={styles.subtitle}>
              <em>{context.singleSpeciesCanonicalName}</em>
            </div>
          )}
          <div className={styles.status}>{statusText}</div>
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

      <div
        className={styles.preview}
        style={{ '--plant-symbol-preview-color': previewColor } as Record<string, string>}
        aria-label={t('canvas.plantSymbol.preview')}
      >
        <PlantSymbolGlyph symbol={activeSymbol} className={styles.previewGlyph} />
      </div>

      <SymbolGrid symbols={HABIT_SYMBOLS} activeSymbol={activeSymbol} onSelect={setActiveSymbol} />
      <SymbolGrid symbols={ABSTRACT_SYMBOLS} activeSymbol={activeSymbol} onSelect={setActiveSymbol} />

      <div className={styles.actions}>
        <button type="button" className={styles.primaryAction} onClick={applyToSelection}>
          {t('canvas.plantSymbol.setSymbol')}
        </button>
        {context.singleSpeciesCanonicalName && singleSpeciesLabel && (
          <button type="button" className={styles.secondaryAction} onClick={applyToSpecies}>
            {t('canvas.plantSymbol.setSymbolForSpecies', { species: singleSpeciesLabel })}
          </button>
        )}
      </div>
    </div>
  )
}

function SymbolGrid({
  symbols,
  activeSymbol,
  onSelect,
}: {
  symbols: readonly PlantSymbolId[]
  activeSymbol: PlantSymbolId
  onSelect(symbol: PlantSymbolId): void
}) {
  return (
    <div className={styles.grid} role="listbox" aria-label={t('canvas.plantSymbol.label')}>
      {symbols.map((symbol) => {
        const active = symbol === activeSymbol
        const label = symbolLabel(symbol)
        return (
          <button
            key={symbol}
            type="button"
            className={`${styles.symbolButton}${active ? ` ${styles.symbolButtonActive}` : ''}`}
            aria-label={label}
            aria-selected={active}
            title={label}
            onClick={() => onSelect(symbol)}
          >
            <PlantSymbolGlyph symbol={symbol} className={styles.symbolGlyph} />
          </button>
        )
      })}
    </div>
  )
}

function symbolLabel(symbol: PlantSymbolId): string {
  return t(`canvas.plantSymbol.names.${symbol}`, symbol)
}

function resolveInitialSymbol(
  current: PlantSymbolId | 'mixed' | null,
  inherited: PlantSymbolId | null,
  effective: PlantSymbolId | 'mixed',
): PlantSymbolId {
  if (current === 'mixed') {
    return inherited ?? (effective === 'mixed' ? DEFAULT_PLANT_SYMBOL_ID : effective)
  }
  return current ?? inherited ?? (effective === 'mixed' ? DEFAULT_PLANT_SYMBOL_ID : effective)
}

function describeCurrentSymbol(
  current: PlantSymbolId | 'mixed' | null,
  inherited: PlantSymbolId | null,
  effective: PlantSymbolId | 'mixed',
): string {
  if (current === 'mixed') return t('canvas.plantSymbol.mixed')
  if (current) return t('canvas.plantSymbol.current', { symbol: symbolLabel(current) })
  if (inherited) return t('canvas.plantSymbol.inherited', { symbol: symbolLabel(inherited) })
  if (effective === 'mixed') return t('canvas.plantSymbol.mixed')
  return t('canvas.plantSymbol.inherited', { symbol: symbolLabel(effective) })
}

function resolvePreviewColor(plantId: string | null): string {
  const scene = currentCanvasQuerySurface.value?.getSceneSnapshot()
  const plant = plantId ? scene?.plants.find((entry) => entry.id === plantId) : null
  const speciesColor = plant ? scene?.plantSpeciesColors[plant.canonicalName] : null
  return normalizeHexColor(plant?.color ?? speciesColor ?? null) ?? DEFAULT_PLANT_COLOR
}
