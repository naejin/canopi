import { useSignalEffect } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { locale } from '../../app/settings/state'
import { plantColorMenuOpen } from '../../canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../canvas/plant-symbol-menu-state'
import {
  appCommandGraphToolbarProjection,
  type AppCommandGraphToolbarActionCommand,
  type AppCommandGraphToolbarToolCommand,
} from '../../commands/registry'
import { t } from '../../i18n'
import {
  currentCanvasQuerySurface,
  currentCanvasSelection,
} from '../../canvas/session'
import {
  SelectIcon,
  HandIcon,
  UndoIcon,
  RedoIcon,
  LineIcon,
  RectangleIcon,
  EllipseIcon,
  PolygonIcon,
  TextIcon,
  MeasurementGuideIcon,
  ObjectStampIcon,
  SpacingIcon,
  GridIcon,
  SnapIcon,
  RulerIcon,
  PaletteIcon,
  PlantSymbolIcon,
} from './toolbar-icons'
import { PlantColorMenu } from './PlantColorMenu'
import { PlantSymbolMenu } from './PlantSymbolMenu'
import { ButtonTooltip } from '../shared/ButtonTooltip'

import styles from './CanvasToolbar.module.css'

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

export function CanvasToolbar() {
  // Subscribe to locale so labels re-render on language change
  void locale.value
  void currentCanvasSelection.value
  const querySurface = currentCanvasQuerySurface.value
  const toolbarProjection = appCommandGraphToolbarProjection.value
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

  useSignalEffect(() => {
    if (!plantSymbolMenuOpen.value) return
    currentCanvasSelection.value
    if (!querySurface || querySurface.getSelectedPlantSymbolContext().plantIds.length === 0) {
      plantSymbolMenuOpen.value = false
    }
  })

  // Arrow key navigation within the toolbar (roving tabindex pattern)
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if (!(e.target instanceof HTMLButtonElement) || !e.target.dataset.tool) return

    e.preventDefault()

    const currentId = e.target.dataset.tool
    const currentIndex = allTools.findIndex((t) => t.tool === currentId)
    if (currentIndex === -1) return

    const nextIndex =
      e.key === 'ArrowDown'
        ? (currentIndex + 1) % allTools.length
        : (currentIndex - 1 + allTools.length) % allTools.length

    const nextTool = allTools[nextIndex]
    if (!nextTool) return

    nextTool.action()

    // Move DOM focus to the newly active button
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const btn = toolbar.querySelector<HTMLButtonElement>(
      `[data-tool="${nextTool.tool}"]`
    )
    btn?.focus()
  }

  function renderToolButton(command: AppCommandGraphToolbarToolCommand) {
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
        aria-keyshortcuts={command.shortcut}
        aria-disabled={command.disabled}
        disabled={command.disabled}
        // Only the active button is in the tab sequence; arrow keys move focus
        tabIndex={command.active ? 0 : -1}
        className={`${styles.toolButton}${command.disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
        onClick={command.action}
      >
        <Icon className={styles.toolIcon} />
        <ButtonTooltip label={command.label} shortcut={shortcutLabel} description={command.description} />
      </button>
    )
  }

  function renderActionButton(
    id: string,
    label: string,
    desc: string | undefined,
    Icon: IconComponent,
    pressed: boolean | undefined,
    disabled: boolean,
    onClick: () => void,
    options?: {
      commandId?: string
      shortcut?: string
    },
  ) {
    const pressedProps = pressed === undefined ? {} : { 'aria-pressed': pressed }

    return (
      <button
        ref={id === 'plant-color' ? plantColorButtonRef : id === 'plant-symbol' ? plantSymbolButtonRef : undefined}
        key={id}
        data-command={options?.commandId}
        type="button"
        {...pressedProps}
        aria-label={label}
        aria-keyshortcuts={options?.shortcut}
        aria-disabled={disabled}
        disabled={disabled}
        tabIndex={0}
        className={`${styles.toolButton}${disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
        onClick={onClick}
      >
        <Icon className={styles.toolIcon} />
        <ButtonTooltip
          label={label}
          shortcut={options?.shortcut ? `(${options.shortcut})` : undefined}
          description={desc}
        />
      </button>
    )
  }

  function renderCommandButton(command: AppCommandGraphToolbarActionCommand) {
    const Icon = iconForAction(command.id)
    return renderActionButton(
      command.id,
      command.label,
      command.description,
      Icon,
      command.pressed,
      command.disabled,
      command.action,
      { commandId: command.commandId, shortcut: command.shortcut },
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
      // tabIndex={0} puts the toolbar itself in the tab order. When the
      // container receives focus (not one of its children), we immediately
      // delegate to the active tool button so the user lands on a real button.
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === toolbarRef.current) {
          const active = toolbarRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
          active?.focus()
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
          t('canvas.plantColor.toolbarDesc'),
          PaletteIcon,
          plantColorMenuOpen.value,
          !hasSelectedPlants,
          () => {
            if (!hasSelectedPlants) return
            plantSymbolMenuOpen.value = false
            plantColorMenuOpen.value = !plantColorMenuOpen.value
          },
        )}
        {plantColorMenuOpen.value && hasSelectedPlants && <PlantColorMenu buttonRef={plantColorButtonRef} />}
        {renderActionButton(
          'plant-symbol',
          t('canvas.plantSymbol.label'),
          t('canvas.plantSymbol.toolbarDesc'),
          PlantSymbolIcon,
          plantSymbolMenuOpen.value,
          !hasSelectedSymbolPlants,
          () => {
            if (!hasSelectedSymbolPlants) return
            plantColorMenuOpen.value = false
            plantSymbolMenuOpen.value = !plantSymbolMenuOpen.value
          },
        )}
        {plantSymbolMenuOpen.value && hasSelectedSymbolPlants && <PlantSymbolMenu buttonRef={plantSymbolButtonRef} />}
      </div>

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {toolbarProjection.settingsToggles.map(renderCommandButton)}

    </div>
  )
}
