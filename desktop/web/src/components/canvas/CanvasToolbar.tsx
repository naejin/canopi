import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { activeTool, gridVisible, rulersVisible, snapToGridEnabled } from '../../state/canvas'
import { locale } from '../../state/app'
import { t } from '../../i18n'
import { canvasEngine } from '../../canvas/engine'
import {
  SelectIcon,
  HandIcon,
  RectangleIcon,
  EllipseIcon,
  PolygonIcon,
  FreeformIcon,
  LineIcon,
  TextIcon,
  MeasureIcon,
  GridIcon,
  SnapIcon,
  RulerIcon,
} from './toolbar-icons'
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
  { id: 'ellipse',     labelKey: 'canvas.tools.ellipse',     descKey: 'canvas.tools.ellipseDesc',     shortcut: 'E', Icon: EllipseIcon },
  { id: 'polygon',     labelKey: 'canvas.tools.polygon',     descKey: 'canvas.tools.polygonDesc',     shortcut: 'P', Icon: PolygonIcon },
  { id: 'freeform',    labelKey: 'canvas.tools.freeform',    descKey: 'canvas.tools.freeformDesc',    shortcut: 'F', Icon: FreeformIcon },
  { id: 'line',        labelKey: 'canvas.tools.line',        descKey: 'canvas.tools.lineDesc',        shortcut: 'L', Icon: LineIcon },
  { id: 'text',        labelKey: 'canvas.tools.text',        descKey: 'canvas.tools.textDesc',        shortcut: 'T', Icon: TextIcon },
  { id: 'measure',     labelKey: 'canvas.tools.measure',     descKey: 'canvas.tools.measureDesc',     shortcut: 'M', Icon: MeasureIcon },
]

// All tool groups in order for keyboard navigation
const ALL_TOOLS: ToolDef[] = [...TOOLS, ...SHAPE_TOOLS]

export function CanvasToolbar() {
  // Subscribe to locale so labels re-render on language change
  void locale.value

  const toolbarRef = useRef<HTMLDivElement>(null)

  // Arrow key navigation within the toolbar (roving tabindex pattern)
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

    e.preventDefault()

    const currentId = activeTool.value
    const currentIndex = ALL_TOOLS.findIndex((t) => t.id === currentId)
    if (currentIndex === -1) return

    const nextIndex =
      e.key === 'ArrowDown'
        ? (currentIndex + 1) % ALL_TOOLS.length
        : (currentIndex - 1 + ALL_TOOLS.length) % ALL_TOOLS.length

    const nextTool = ALL_TOOLS[nextIndex]
    if (!nextTool) return

    activeTool.value = nextTool.id

    // Move DOM focus to the newly active button
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const btn = toolbar.querySelector<HTMLButtonElement>(
      `[data-tool="${nextTool.id}"]`
    )
    btn?.focus()
  }

  function renderButton(tool: ToolDef) {
    const isActive = activeTool.value === tool.id
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
        onClick={() => { activeTool.value = tool.id }}
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

      {renderToggle(
        'grid',
        'canvas.grid.grid',
        'canvas.grid.gridDesc',
        gridVisible.value,
        GridIcon,
        () => canvasEngine?.toggleGrid(),
      )}
      {renderToggle(
        'snap',
        'canvas.grid.snapToGrid',
        'canvas.grid.snapToGridDesc',
        snapToGridEnabled.value,
        SnapIcon,
        () => canvasEngine?.toggleSnapToGrid(),
      )}
      {renderToggle(
        'rulers',
        'canvas.grid.rulers',
        'canvas.grid.rulersDesc',
        rulersVisible.value,
        RulerIcon,
        () => canvasEngine?.toggleRulers(),
      )}
    </div>
  )
}
