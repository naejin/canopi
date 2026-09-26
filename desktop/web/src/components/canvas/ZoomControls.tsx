import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { CanvasToolbarActionCommand } from '../../app/canvas-commands'
import { locale } from '../../app/settings/state'
import {
  COMMON_MAP_SCALES,
  formatMapScale,
  groundMetersPerCssPixel,
  mapScaleDenominator,
  roundScaleDenominator,
  zoomFactorForScale,
} from '../../canvas/map-scale'
import { getScaleBarDisplay } from '../../canvas/scale-bar'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../canvas/session'
import { t } from '../../i18n'
import { ButtonTooltip } from '../shared/ButtonTooltip'
import { ControlIcon, type ControlIconName } from '../shared/ControlIcon'
import styles from './ZoomControls.module.css'

const VIEW_ACTION_ICONS: Readonly<Record<string, ControlIconName>> = {
  'zoom-in': 'plus',
  'zoom-out': 'minus',
  'fit-to-design': 'fit',
}

/**
 * The zoom group at the bottom right: scale bar, zoom out, the map scale as
 * a ratio (a menu of common scales), zoom in and Fit to Design. The map
 * attribution pill sits just left of it.
 */
export function ZoomControls({ viewActions }: { readonly viewActions: readonly CanvasToolbarActionCommand[] }) {
  const group = useRef<HTMLDivElement>(null)
  const frame = currentCanvasQuerySurface.value?.viewport.value
  const command = (id: string) => viewActions.find((action) => action.id === id)
  const zoomIn = command('zoom-in')
  const zoomOut = command('zoom-out')
  const fit = command('fit-to-design')
  const atMinimum = frame ? frame.viewport.scale <= frame.scaleBounds.minimum : false
  const atMaximum = frame ? frame.viewport.scale >= frame.scaleBounds.maximum : false
  const denominator = frame ? mapScaleDenominator(frame) : null
  const bar = frame ? getScaleBarDisplay(1 / groundMetersPerCssPixel(frame)) : null

  // The attribution pill is placed against this group's measured width.
  useLayoutEffect(() => {
    const element = group.current
    const host = element?.parentElement
    if (!element || !host || typeof ResizeObserver === 'undefined') return
    const publish = () => host.style.setProperty('--zoom-group-width', `${element.offsetWidth}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(element)
    return () => {
      observer.disconnect()
      host.style.removeProperty('--zoom-group-width')
    }
  }, [])

  return (
    <div ref={group} className={styles.group} role="group" aria-label={t('canvas.grid.zoom')} data-zoom-group>
      {bar && (
        <span className={styles.scaleBar} role="img" aria-label={t('canvas.zoom.scaleBar', { distance: formatDistance(bar.meters, locale.value) })}>
          <span className={styles.scaleLabel}>{formatDistance(bar.meters, locale.value)}</span>
          <span className={styles.scaleLine} style={{ width: `${Math.round(bar.barScreenPx)}px` }} />
        </span>
      )}
      <span className={styles.rule} aria-hidden="true" />
      {zoomOut && <ZoomButton command={zoomOut} disabled={zoomOut.disabled || atMinimum} />}
      {denominator !== null && <ScaleMenu denominator={denominator} />}
      {zoomIn && <ZoomButton command={zoomIn} disabled={zoomIn.disabled || atMaximum} />}
      {fit && <ZoomButton command={fit} disabled={fit.disabled} />}
    </div>
  )
}

function ZoomButton({ command, disabled }: { readonly command: CanvasToolbarActionCommand; readonly disabled: boolean }) {
  return (
    <button
      type="button"
      className={styles.button}
      data-command={command.commandId}
      aria-label={command.label}
      aria-keyshortcuts={command.ariaShortcut}
      aria-disabled={disabled ? true : undefined}
      onClick={() => { if (!disabled) command.action() }}
    >
      <ControlIcon name={VIEW_ACTION_ICONS[command.id] ?? 'plus'} size={20} />
      <ButtonTooltip label={command.label} shortcut={command.shortcut} side="top" />
    </button>
  )
}

function ScaleMenu({ denominator }: { readonly denominator: number }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const current = roundScaleDenominator(denominator)
  const label = formatMapScale(denominator, locale.value)

  useEffect(() => {
    if (!open) return
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    const checked = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus()
    const outside = (event: Event) => {
      const target = event.target as Node | null
      if (target && !menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerup', outside)
    return () => document.removeEventListener('pointerup', outside)
  }, [open])

  function close(): void {
    setOpen(false)
    trigger.current?.focus()
  }

  function choose(target: number): void {
    close()
    currentCanvasViewportCommandSurface.peek()?.zoomBy(zoomFactorForScale(denominator, target))
  }

  return (
    <span className={styles.scaleMenuAnchor}>
      <button
        ref={trigger}
        type="button"
        className={styles.ratio}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('canvas.zoom.chooseScale', { scale: label })}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label={t('canvas.zoom.mapScale')}
          onKeyDown={(event) => {
            const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              items[(index + step + items.length) % items.length]?.focus()
            } else if (event.key === 'Tab') {
              setOpen(false)
            }
          }}
        >
          {COMMON_MAP_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              role="menuitemradio"
              aria-checked={scale === current}
              className={styles.menuItem}
              tabIndex={-1}
              onClick={() => choose(scale)}
            >
              <span className={styles.menuCheck} aria-hidden="true">{scale === current && <ControlIcon name="check" />}</span>
              {formatMapScale(scale, locale.value)}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/** "5 m", "2 km", "50 cm": the scale bar's distance in the interface language. */
export function formatDistance(meters: number, activeLocale: string): string {
  const [value, unit] = meters >= 1000 ? [meters / 1000, 'kilometer']
    : meters < 1 ? [meters * 100, 'centimeter']
      : [meters, 'meter']
  return new Intl.NumberFormat(activeLocale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(value)
}
