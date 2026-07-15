import { useSignalEffect } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import {
  createCanvasCommandProjection,
  type CanvasToolbarActionCommand,
  type CanvasToolbarToolCommand,
} from '../app/canvas-commands'
import { locale } from '../app/settings/state'
import { plantColorMenuOpen } from '../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../canvas/plant-symbol-menu-state'
import {
  currentCanvasQuerySurface,
  currentCanvasSelection,
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
import {
  readWebCanvasCommandProjectionState,
  webCanvasCommandIntentAdapter,
} from './canvas-command-adapter'

type IconComponent = (props: { className?: string }) => ComponentChildren

const TOOL_ICONS: Record<string, IconComponent> = {
  select: SelectIcon,
  hand: HandIcon,
  line: LineIcon,
  rectangle: RectangleIcon,
  ellipse: EllipseIcon,
  polygon: PolygonIcon,
  text: TextIcon,
  'measurement-guide': MeasurementGuideIcon,
  'object-stamp': ObjectStampIcon,
  'plant-spacing': SpacingIcon,
}

const ACTION_ICONS: Record<string, IconComponent> = {
  undo: UndoIcon,
  redo: RedoIcon,
  grid: GridIcon,
  snap: SnapIcon,
  rulers: RulerIcon,
}

function iconForTool(tool: string): IconComponent {
  const Icon = TOOL_ICONS[tool]
  if (!Icon) throw new Error(`Missing toolbar tool icon '${tool}'`)
  return Icon
}

function iconForAction(id: string): IconComponent {
  const Icon = ACTION_ICONS[id]
  if (!Icon) throw new Error(`Missing toolbar action icon '${id}'`)
  return Icon
}

export function WebCanvasToolbar() {
  void locale.value
  void currentCanvasSelection.value
  const querySurface = currentCanvasQuerySurface.value
  const toolbarProjection = createCanvasCommandProjection({
    state: readWebCanvasCommandProjectionState(),
    intents: webCanvasCommandIntentAdapter,
    translate: t,
  })
  const allTools = [
    ...toolbarProjection.primaryTools,
    ...toolbarProjection.creationTools,
    ...toolbarProjection.reuseTools,
  ]
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

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset.tool) return

    event.preventDefault()
    const currentTool = event.target.dataset.tool
    const currentIndex = allTools.findIndex(
      (command) => command.tool === currentTool,
    )
    if (currentIndex === -1) return

    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % allTools.length
      : (currentIndex - 1 + allTools.length) % allTools.length
    const nextTool = allTools[nextIndex]
    if (!nextTool) return

    nextTool.action()
    toolbarRef.current?.querySelector<HTMLButtonElement>(
      `[data-tool="${nextTool.tool}"]`,
    )?.focus()
  }

  useSignalEffect(() => {
    if (!plantSymbolMenuOpen.value) return
    currentCanvasSelection.value
    if (!querySurface || querySurface.getSelectedPlantSymbolContext().plantIds.length === 0) {
      plantSymbolMenuOpen.value = false
    }
  })

  function renderToolButton(command: CanvasToolbarToolCommand) {
    const Icon = iconForTool(command.tool)
    const shortcutLabel = command.shortcut ? `(${command.shortcut})` : ''
    return (
      <button
        key={command.tool}
        data-tool={command.tool}
        type="button"
        role="radio"
        aria-checked={command.active}
        aria-label={command.shortcut ? `${command.label} ${shortcutLabel}` : command.label}
        aria-keyshortcuts={command.ariaShortcut}
        aria-disabled={command.disabled}
        disabled={command.disabled}
        tabIndex={command.active ? 0 : -1}
        className={`${styles.toolButton}${command.disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
        onClick={command.action}
      >
        <Icon className={styles.toolIcon} />
        <ButtonTooltip
          label={command.label}
          shortcut={shortcutLabel}
          description={command.description}
        />
      </button>
    )
  }

  function renderCommandButton(command: CanvasToolbarActionCommand) {
    return renderActionButton(
      command.id,
      command.label,
      iconForAction(command.id),
      command.pressed,
      command.disabled,
      command.action,
      {
        description: command.description,
        commandId: command.commandId,
        shortcut: command.shortcut,
        ariaShortcut: command.ariaShortcut,
      },
    )
  }

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t('canvas.toolbar')}
      aria-orientation="vertical"
      className={styles.toolbar}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === toolbarRef.current) {
          toolbarRef.current?.querySelector<HTMLButtonElement>(
            '[aria-checked="true"]',
          )?.focus()
        }
      }}
    >
      {toolbarProjection.primaryTools.map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {toolbarProjection.creationTools.map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {toolbarProjection.reuseTools.map(renderToolButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {toolbarProjection.historyActions.map(renderCommandButton)}

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
          { ref: plantColorButtonRef },
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
          { ref: plantSymbolButtonRef },
        )}
        {plantSymbolMenuOpen.value && hasSelectedSymbolPlants && <PlantSymbolMenu buttonRef={plantSymbolButtonRef} />}
      </div>

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {toolbarProjection.settingsToggles.map(renderCommandButton)}
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
  options: {
    readonly ref?: { current: HTMLButtonElement | null }
    readonly description?: string
    readonly commandId?: string
    readonly shortcut?: string
    readonly ariaShortcut?: string
  } = {},
) {
  const pressedProps = pressed === undefined ? {} : { 'aria-pressed': pressed }
  return (
    <button
      ref={options.ref}
      key={id}
      data-command={options.commandId}
      type="button"
      {...pressedProps}
      aria-label={label}
      aria-keyshortcuts={options.ariaShortcut}
      aria-disabled={disabled}
      disabled={disabled}
      tabIndex={0}
      className={`${styles.toolButton}${disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
      onClick={onClick}
    >
      <Icon className={styles.toolIcon} />
      <ButtonTooltip
        label={label}
        shortcut={options.shortcut ? `(${options.shortcut})` : undefined}
        description={options.description}
      />
    </button>
  )
}
