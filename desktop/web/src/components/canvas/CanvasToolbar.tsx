import { useSignalEffect } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import {
  gridVisible,
  plantColorMenuOpen,
  rulersVisible,
  snapToGridEnabled,
} from '../../state/canvas'
import { locale } from '../../app/shell/state'
import { t } from '../../i18n'
import { currentCanvasSelection, currentCanvasSession, currentCanvasTool } from '../../canvas/session'
import {
  SelectIcon,
  HandIcon,
  RectangleIcon,
  TextIcon,
  GridIcon,
  SnapIcon,
  RulerIcon,
  PaletteIcon,
} from './toolbar-icons'
import { PlantColorMenu } from './PlantColorMenu'

import styles from './CanvasToolbar.module.css'

type IconComponent = (props: { className?: string }) => ComponentChildren

interface ToolDef {
  id: string
  labelKey: string
  descKey: string
  shortcut?: string
  Icon: IconComponent
}

const TOOLS: ToolDef[] = [
  { id: 'select',      labelKey: 'canvas.tools.select',      descKey: 'canvas.tools.selectDesc',      shortcut: 'V', Icon: SelectIcon },
  { id: 'hand',        labelKey: 'canvas.tools.hand',        descKey: 'canvas.tools.handDesc',        shortcut: 'H', Icon: HandIcon },
]

const SHAPE_TOOLS: ToolDef[] = [
  { id: 'rectangle',   labelKey: 'canvas.tools.rectangle',   descKey: 'canvas.tools.rectangleDesc',   shortcut: 'R', Icon: RectangleIcon },
  { id: 'text',        labelKey: 'canvas.tools.text',        descKey: 'canvas.tools.textDesc',        shortcut: 'T', Icon: TextIcon },
]

// All tool groups in order for keyboard navigation
const ALL_TOOLS: ToolDef[] = [...TOOLS, ...SHAPE_TOOLS]

export function CanvasToolbar() {
  // Subscribe to locale so labels re-render on language change
  void locale.value
  void currentCanvasSelection.value
  const session = currentCanvasSession.value

  const toolbarRef = useRef<HTMLDivElement>(null)
  const plantColorButtonRef = useRef<HTMLButtonElement>(null)
  const plantColorContext = session?.getSelectedPlantColorContext() ?? {
    plantIds: [],
    singleSpeciesCanonicalName: null,
    singleSpeciesCommonName: null,
    sharedCurrentColor: null,
    suggestedColor: null,
  }
  const hasSelectedPlants = plantColorContext.plantIds.length > 0

  useSignalEffect(() => {
    if (!plantColorMenuOpen.value) return
    currentCanvasSelection.value
    if (!session || session.getSelectedPlantColorContext().plantIds.length === 0) {
      plantColorMenuOpen.value = false
    }
  })

  // Arrow key navigation within the toolbar (roving tabindex pattern)
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

    e.preventDefault()

    const currentId = currentCanvasTool.value
    const currentIndex = ALL_TOOLS.findIndex((t) => t.id === currentId)
    if (currentIndex === -1) return

    const nextIndex =
      e.key === 'ArrowDown'
        ? (currentIndex + 1) % ALL_TOOLS.length
        : (currentIndex - 1 + ALL_TOOLS.length) % ALL_TOOLS.length

    const nextTool = ALL_TOOLS[nextIndex]
    if (!nextTool) return

    session?.setTool(nextTool.id)

    // Move DOM focus to the newly active button
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const btn = toolbar.querySelector<HTMLButtonElement>(
      `[data-tool="${nextTool.id}"]`
    )
    btn?.focus()
  }

  function renderButton(tool: ToolDef) {
    const isActive = currentCanvasTool.value === tool.id
    const label = t(tool.labelKey)
    const desc = t(tool.descKey)
    const shortcutLabel = tool.shortcut ? `(${tool.shortcut})` : ''

    return (
      <button
        key={tool.id}
        data-tool={tool.id}
        type="button"
        role="radio"
        aria-checked={isActive}
        aria-label={tool.shortcut ? `${label} ${shortcutLabel}` : label}
        aria-keyshortcuts={tool.shortcut}
        // Only the active button is in the tab sequence; arrow keys move focus
        tabIndex={isActive ? 0 : -1}
        className={styles.toolButton}
        onClick={() => { session?.setTool(tool.id) }}
      >
        <tool.Icon className={styles.toolIcon} />
        <span className={styles.tooltip} role="tooltip">
          <span className={styles.tooltipName}>{label}</span>
          {tool.shortcut && (
            <span className={styles.tooltipShortcut}>{shortcutLabel}</span>
          )}
          <br />
          <span className={styles.tooltipDesc}>{desc}</span>
        </span>
      </button>
    )
  }

  function renderActionButton(
    id: string,
    label: string,
    desc: string,
    Icon: IconComponent,
    pressed: boolean,
    disabled: boolean,
    onClick: () => void,
  ) {
    return (
      <button
        ref={id === 'plant-color' ? plantColorButtonRef : undefined}
        key={id}
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        aria-disabled={disabled}
        disabled={disabled}
        tabIndex={0}
        className={`${styles.toolButton}${disabled ? ` ${styles.toolButtonDisabled}` : ''}`}
        onClick={onClick}
      >
        <Icon className={styles.toolIcon} />
        <span className={styles.tooltip} role="tooltip">
          <span className={styles.tooltipName}>{label}</span>
          <br />
          <span className={styles.tooltipDesc}>{desc}</span>
        </span>
      </button>
    )
  }

  function renderToggle(
    id: string,
    labelKey: string,
    descKey: string,
    pressed: boolean,
    Icon: IconComponent,
    onToggle: () => void,
  ) {
    const label = t(labelKey)
    const desc = t(descKey)
    return (
      <button
        key={id}
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        tabIndex={0}
        className={styles.toolButton}
        onClick={onToggle}
      >
        <Icon className={styles.toolIcon} />
        <span className={styles.tooltip} role="tooltip">
          <span className={styles.tooltipName}>{label}</span>
          <br />
          <span className={styles.tooltipDesc}>{desc}</span>
        </span>
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
      {TOOLS.map(renderButton)}

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {SHAPE_TOOLS.map(renderButton)}

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
            plantColorMenuOpen.value = !plantColorMenuOpen.value
          },
        )}
        {plantColorMenuOpen.value && hasSelectedPlants && <PlantColorMenu buttonRef={plantColorButtonRef} />}
      </div>

      <div className={styles.separator} role="separator" aria-hidden="true" />

      {renderToggle(
        'grid',
        'canvas.grid.grid',
        'canvas.grid.gridDesc',
        gridVisible.value,
        GridIcon,
        () => session?.toggleGrid(),
      )}
      {renderToggle(
        'snap',
        'canvas.grid.snapToGrid',
        'canvas.grid.snapToGridDesc',
        snapToGridEnabled.value,
        SnapIcon,
        () => session?.toggleSnapToGrid(),
      )}
      {renderToggle(
        'rulers',
        'canvas.grid.rulers',
        'canvas.grid.rulersDesc',
        rulersVisible.value,
        RulerIcon,
        () => session?.toggleRulers(),
      )}

    </div>
  )
}
