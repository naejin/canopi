import { useSignalEffect } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { locale } from '../app/settings/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import {
  currentCanvasCommandSurface,
  currentCanvasQuerySurface,
  currentCanvasSelection,
  currentCanvasTool,
  setCurrentCanvasTool,
} from '../canvas/session'
import { t } from '../i18n'
import { ButtonTooltip } from '../components/shared/ButtonTooltip'
import { PlantColorMenu } from '../components/canvas/PlantColorMenu'
import { PlantSymbolMenu } from '../components/canvas/PlantSymbolMenu'
import {
  EllipseIcon,
  GridIcon,
  HandIcon,
  LineIcon,
  MeasurementGuideIcon,
  ObjectStampIcon,
  PaletteIcon,
  PlantSymbolIcon,
  PolygonIcon,
  RectangleIcon,
  RedoIcon,
  RulerIcon,
  SelectIcon,
  SnapIcon,
  SpacingIcon,
  TextIcon,
  UndoIcon,
} from '../components/canvas/toolbar-icons'
import styles from '../components/canvas/CanvasToolbar.module.css'

type IconComponent = (props: { className?: string }) => ComponentChildren

interface WebToolbarTool {
  readonly tool: string
  readonly label: string
  readonly description: string
  readonly Icon: IconComponent
}

const WEB_TOOLS: readonly WebToolbarTool[] = [
  { tool: 'select', label: 'canvas.tools.select', description: 'canvas.tools.selectDesc', Icon: SelectIcon },
  { tool: 'hand', label: 'canvas.tools.hand', description: 'canvas.tools.handDesc', Icon: HandIcon },
  { tool: 'line', label: 'canvas.tools.line', description: 'canvas.tools.lineDesc', Icon: LineIcon },
  { tool: 'rectangle', label: 'canvas.tools.rectangle', description: 'canvas.tools.rectangleDesc', Icon: RectangleIcon },
  { tool: 'ellipse', label: 'canvas.tools.ellipse', description: 'canvas.tools.ellipseDesc', Icon: EllipseIcon },
  { tool: 'polygon', label: 'canvas.tools.polygon', description: 'canvas.tools.polygonDesc', Icon: PolygonIcon },
  { tool: 'text', label: 'canvas.tools.text', description: 'canvas.tools.textDesc', Icon: TextIcon },
  { tool: 'measurement-guide', label: 'canvas.tools.measurementGuide', description: 'canvas.tools.measurementGuideDesc', Icon: MeasurementGuideIcon },
  { tool: 'object-stamp', label: 'canvas.tools.objectStamp', description: 'canvas.tools.objectStampDesc', Icon: ObjectStampIcon },
  { tool: 'plant-spacing', label: 'canvas.tools.plantSpacing', description: 'canvas.tools.plantSpacingDesc', Icon: SpacingIcon },
]

export function WebCanvasToolbar() {
  void locale.value
  void currentCanvasSelection.value
  const commandSurface = currentCanvasCommandSurface.value
  const querySurface = currentCanvasQuerySurface.value
  const activeTool = currentCanvasTool.value
  const toolbarRef = useRef<HTMLDivElement>(null)
  const plantColorButtonRef = useRef<HTMLButtonElement>(null)
  const plantSymbolButtonRef = useRef<HTMLButtonElement>(null)
  const plantColorContext = querySurface?.getSelectedPlantColorContext() ?? {
    plantIds: [],
    singleSpeciesCanonicalName: null,
    singleSpeciesCommonName: null,
    sharedCurrentColor: null,
    suggestedColor: null,
  }
  const plantSymbolContext = querySurface?.getSelectedPlantSymbolContext() ?? {
    plantIds: [],
    singleSpeciesCanonicalName: null,
    singleSpeciesCommonName: null,
    sharedCurrentSymbol: null,
    sharedEffectiveSymbol: 'round',
    inheritedSymbol: null,
    singleSpeciesDefaultSymbol: null,
    canClearSelectedSymbol: false,
  }
  const hasSelectedPlants = plantColorContext.plantIds.length > 0
  const hasSelectedSymbolPlants = plantSymbolContext.plantIds.length > 0

  useSignalEffect(() => {
    if (!plantColorMenuOpen.value) return
    currentCanvasSelection.value
    if (!querySurface || querySurface.getSelectedPlantColorContext().plantIds.length === 0) {
      plantColorMenuOpen.value = false
    }
  })

  useSignalEffect(() => {
    if (!plantSymbolMenuOpen.value) return
    currentCanvasSelection.value
    if (!querySurface || querySurface.getSelectedPlantSymbolContext().plantIds.length === 0) {
      plantSymbolMenuOpen.value = false
    }
  })

  function renderToolButton(tool: WebToolbarTool) {
    const label = t(tool.label)
    const active = activeTool === tool.tool
    return (
      <button
        key={tool.tool}
        data-tool={tool.tool}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={label}
        disabled={!commandSurface}
        tabIndex={active ? 0 : -1}
        className={`${styles.toolButton}${!commandSurface ? ` ${styles.toolButtonDisabled}` : ''}`}
        onClick={() => setCurrentCanvasTool(tool.tool)}
      >
        <tool.Icon className={styles.toolIcon} />
        <ButtonTooltip label={label} description={t(tool.description)} />
      </button>
    )
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('canvas.toolbar')}
      aria-orientation="vertical"
      className={styles.toolbar}
      tabIndex={0}
    >
      {WEB_TOOLS.slice(0, 2).map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {WEB_TOOLS.slice(2, 8).map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {WEB_TOOLS.slice(8).map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {renderActionButton('undo', t('menu.edit.undo'), UndoIcon, false, !commandSurface?.history.canUndo.value, () => commandSurface?.history.undo())}
      {renderActionButton('redo', t('menu.edit.redo'), RedoIcon, false, !commandSurface?.history.canRedo.value, () => commandSurface?.history.redo())}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      <div className={styles.popoverAnchor} data-preserve-overlays="true">
        {renderActionButton(
          'plant-color',
          t('canvas.plantColor.label'),
          PaletteIcon,
          plantColorMenuOpen.value,
          !hasSelectedPlants,
          () => {
            if (!hasSelectedPlants) return
            plantSymbolMenuOpen.value = false
            plantColorMenuOpen.value = !plantColorMenuOpen.value
          },
          plantColorButtonRef,
        )}
        {plantColorMenuOpen.value && hasSelectedPlants && <PlantColorMenu buttonRef={plantColorButtonRef} />}
        {renderActionButton(
          'plant-symbol',
          t('canvas.plantSymbol.label'),
          PlantSymbolIcon,
          plantSymbolMenuOpen.value,
          !hasSelectedSymbolPlants,
          () => {
            if (!hasSelectedSymbolPlants) return
            plantColorMenuOpen.value = false
            plantSymbolMenuOpen.value = !plantSymbolMenuOpen.value
          },
          plantSymbolButtonRef,
        )}
        {plantSymbolMenuOpen.value && hasSelectedSymbolPlants && <PlantSymbolMenu buttonRef={plantSymbolButtonRef} />}
      </div>

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {renderActionButton('grid', t('canvas.grid.grid'), GridIcon, gridVisible.value, !commandSurface, () => commandSurface?.chrome.toggleGrid())}
      {renderActionButton('snap', t('canvas.grid.snapToGrid'), SnapIcon, snapToGridEnabled.value, !commandSurface, () => commandSurface?.chrome.toggleSnapToGrid())}
      {renderActionButton('rulers', t('canvas.grid.rulers'), RulerIcon, rulersVisible.value, !commandSurface, () => commandSurface?.chrome.toggleRulers())}
    </div>
  )
}

function renderActionButton(
  id: string,
  label: string,
  Icon: IconComponent,
  pressed: boolean | undefined,
  disabled: boolean,
  onClick: () => void,
  ref?: { current: HTMLButtonElement | null },
) {
  const pressedProps = pressed === undefined ? {} : { 'aria-pressed': pressed }
  return (
    <button
      ref={ref}
      key={id}
      type="button"
      {...pressedProps}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      tabIndex={0}
      className={`${styles.toolButton}${disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
      onClick={onClick}
    >
      <Icon className={styles.toolIcon} />
      <ButtonTooltip label={label} />
    </button>
  )
}
