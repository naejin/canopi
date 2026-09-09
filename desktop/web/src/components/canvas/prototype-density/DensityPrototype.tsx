// THROWAWAY: three dense-canvas reading experiments + the live baseline, on the
// existing Web Canvas route. DEV + ?prototype=density is required by the host.
import type { RefObject } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { currentCanvasQuerySurface, currentCanvasViewportCommandSurface } from '../../../canvas/session'
import type { PrintPlant, PrintPoint } from '../../../canvas/print'
import { createModel, drawReading, nearby, world, type Palette, type Variant, type ReadingState } from './density-drawing.prototype'
import styles from './density-prototype.module.css'

const variants: { key: Variant; name: string; description: string }[] = [
  { key: 'current', name: 'Current Canopi', description: 'The live renderer. Compare at exactly the same position and zoom.' },
  { key: 'adaptive', name: 'A · Quiet overview', description: 'Positions first. Symbols and notes appear when they have room. Hover to identify.' },
  { key: 'lens', name: 'B · Inspection lens', description: 'Keep the site in view while a local window separates the plants. Click to hold it.' },
  { key: 'strip', name: 'C · Read a planting strip', description: 'Click a planting to read a temporary 1 m strip from top to bottom.' },
]

export function DensityPrototype({ hostRef }: { hostRef: RefObject<HTMLDivElement> }) {
  const query = currentCanvasQuerySurface.value
  const camera = query?.viewport.value
  const revision = query?.revision.scene.value
  const namesRevision = query?.revision.plantNames.value
  const model = useMemo(() => {
    const source = query?.capturePrintSnapshot()
    if (!source || !query) return null
    const localized = query.getLocalizedCommonNames()
    const names = new Map(query.getPlacedPlants().map((plant) => [plant.canonical_name, localized.get(plant.canonical_name) || plant.common_name || plant.canonical_name]))
    return createModel(source, names)
  }, [query, revision, namesRevision])
  const [variant, setVariant] = useState<Variant>(() => {
    const value = new URLSearchParams(location.search).get('variant')
    return variants.find((entry) => entry.key === value)?.key ?? 'adaptive'
  })
  const [pointer, setPointer] = useState<PrintPoint | null>(null)
  const [held, setHeld] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [species, setSpecies] = useState('')
  const [stripX, setStripX] = useState<number | null>(null)
  const [stats, setStats] = useState('')
  const surface = useRef<HTMLCanvasElement>(null)
  const lens = useRef<HTMLCanvasElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const view = camera?.viewport
  const width = camera?.screenSize.width ?? 0
  const height = camera?.screenSize.height ?? 0
  const choice = variants.find((entry) => entry.key === variant)!
  const state: ReadingState = { variant, pointer, selectedId, species, stripX }

  function changeVariant(next: Variant) {
    setVariant(next); setHeld(false); setSelectedId(null)
    const url = new URL(location.href)
    url.searchParams.set('variant', next)
    history.replaceState(null, '', url)
  }
  function cycle(direction: number) {
    changeVariant(variants[(variants.findIndex((entry) => entry.key === variant) + direction + variants.length) % variants.length]!.key)
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault(); event.stopImmediatePropagation()
      cycle(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [variant])

  // Reuse the real camera's wheel path. Only pan/zoom reaches the runtime;
  // pointer selection and all reading controls remain local to this experiment.
  function wheel(deltaX: number, deltaY: number, pan = false, client?: PrintPoint) {
    const host = hostRef.current
    const canvas = host?.querySelector('canvas')
    if (!host || !canvas) return
    const rect = host.getBoundingClientRect()
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX, deltaY, shiftKey: pan, bubbles: true, cancelable: true,
      clientX: client?.x ?? rect.left + rect.width / 2,
      clientY: client?.y ?? rect.top + rect.height / 2,
    }))
  }
  function zoom(percent: number) {
    if (!query) return
    for (let i = 0; i < 12; i++) {
      const current = query.viewport.peek()
      const delta = Math.log(percent / 100 * current.referenceScale / current.viewport.scale)
      if (Math.abs(delta) < .00001) break
      wheel(0, -Math.max(-.9, Math.min(.9, delta)) / .002)
    }
  }
  function locate(point: PrintPoint) {
    const current = query?.viewport.peek()
    if (!current) return
    wheel(current.viewport.x + point.x * current.viewport.scale - current.screenSize.width / 2,
      current.viewport.y + point.y * current.viewport.scale - current.screenSize.height / 2, true)
  }
  useEffect(() => {
    const canvas = surface.current
    if (!canvas) return
    function forward(event: WheelEvent) {
      event.preventDefault(); event.stopPropagation()
      wheel(event.deltaX, event.deltaY, event.shiftKey, { x: event.clientX, y: event.clientY })
    }
    canvas.addEventListener('wheel', forward, { passive: false })
    return () => canvas.removeEventListener('wheel', forward)
  }, [hostRef, model])

  function palette(): Palette {
    const css = getComputedStyle(root.current!)
    return {
      paper: css.getPropertyValue('--canvas-bg'), ink: css.getPropertyValue('--color-text'),
      muted: css.getPropertyValue('--color-text-muted'), accent: css.getPropertyValue('--color-accent'),
      border: css.getPropertyValue('--color-border'),
    }
  }
  useLayoutEffect(() => {
    if (!model || !view || !surface.current) return
    const canvas = surface.current
    const ratio = devicePixelRatio || 1
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    const result = drawReading(ctx, model, view, width, height, state, palette())
    setStats(`${result.visible.toLocaleString()} plants in view · ${result.fullSymbols} full symbols · ${result.positionMarks} position marks`)
    if (lens.current && pointer) {
      lens.current.width = 280 * ratio; lens.current.height = 250 * ratio
      const detail = lens.current.getContext('2d')!
      detail.scale(ratio, ratio)
      const scale = Math.max(140, view.scale)
      drawReading(detail, model, { x: 140 - pointer.x * scale, y: 125 - pointer.y * scale, scale }, 280, 250, { ...state, variant: 'adaptive' }, palette(), true)
    }
  }, [model, view, width, height, variant, pointer, selectedId, species, stripX])

  if (!model || !view) return null
  const close = pointer ? nearby(model, pointer) : []
  const hovered = close[0] && pointer && Math.hypot(close[0].position.x - pointer.x, close[0].position.y - pointer.y) * view.scale < 14 ? close[0] : null
  const strip = stripX === null ? [] : model.source.plants.filter((plant) => Math.abs(plant.position.x - stripX) <= .5).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const name = (plant: PrintPlant) => model.names.get(plant.canonicalName) ?? plant.canonicalName
  const zoomValue = Math.round(view.scale / (camera?.referenceScale ?? 20) * 100)
  const speciesNames = [...new Set(model.source.plants.map((plant) => plant.canonicalName))].sort((a, b) => (model.names.get(a) ?? a).localeCompare(model.names.get(b) ?? b))
  function at(event: PointerEvent): PrintPoint {
    const rect = surface.current!.getBoundingClientRect()
    return world({ x: event.clientX - rect.left, y: event.clientY - rect.top }, query!.viewport.peek().viewport)
  }
  function plantList(plants: PrintPlant[]) {
    return <ol className={styles.plants}>{plants.map((plant, index) => <li key={plant.id}>
      <button type="button" onMouseEnter={() => setSelectedId(plant.id)} onFocus={() => setSelectedId(plant.id)} onClick={() => { setSelectedId(plant.id); locate(plant.position) }}>
        <span className={styles.number}>{index + 1}</span><span>{name(plant)}<small>{plant.position.x.toFixed(2)} m · {plant.position.y.toFixed(2)} m</small></span><span aria-hidden="true">↗</span>
      </button>
    </li>)}</ol>
  }
  return <div className={styles.root} ref={root} data-density-prototype={variant}>
    <canvas ref={surface} className={styles.surface} aria-label="Read-only density proposal canvas"
      onPointerDown={(event) => { surface.current!.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false } }}
      onPointerMove={(event) => {
        if (drag.current) {
          const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true
          wheel(-dx, -dy, true)
          drag.current.x = event.clientX; drag.current.y = event.clientY
        } else if (!held) {
          const point = at(event), plant = nearby(model, point, 1)[0]
          setPointer(point)
          setSelectedId(plant && Math.hypot(plant.position.x - point.x, plant.position.y - point.y) * view.scale < 14 ? plant.id : null)
        }
      }}
      onPointerUp={(event) => {
        if (drag.current && !drag.current.moved) {
          const point = at(event)
          if (variant === 'lens') { setPointer(point); setHeld(!held) }
          if (variant === 'strip') { setStripX(nearby(model, point, 1)[0]?.position.x ?? point.x); setPointer(point) }
        }
        drag.current = null
      }}
      onPointerCancel={() => { drag.current = null }}
      onPointerLeave={() => { if (variant === 'adaptive' && !drag.current) { setPointer(null); setSelectedId(null) } }} />
    <div className={styles.heading}>
      <span className={styles.eyebrow}>DENSITY LAB · READ-ONLY PROPOSAL</span>
      <h2>{choice.name}</h2><p>{choice.description}</p>
      <div className={styles.controls}><button onClick={() => { currentCanvasViewportCommandSurface.value?.zoomToFit() }}>Fit site</button>{[50, 100, 200, 500, 1000, 2000].map((value) => <button aria-pressed={zoomValue === value} onClick={() => zoom(value)}>{value}%</button>)}</div>
      <div className={styles.controls}><label>Spotlight <select aria-label="Spotlight species" value={species} onChange={(event) => setSpecies(event.currentTarget.value)} disabled={variant === 'current'}><option value="">All species</option>{speciesNames.map((entry) => <option value={entry}>{model.names.get(entry) ?? entry}</option>)}</select></label><span>{model.source.plants.length.toLocaleString()} plants · {speciesNames.length} species</span></div>
    </div>
    {variant === 'adaptive' && hovered && <div className={styles.identity}><strong>{name(hovered)}</strong><span>{hovered.position.x.toFixed(2)} m · {hovered.position.y.toFixed(2)} m</span><small>Hover a note anchor to reveal its full text.</small></div>}
    {variant === 'lens' && <aside className={styles.reader}>
      <div className={styles.readerTitle}><strong>Inspection lens</strong><button onClick={() => setHeld(!held)}>{held ? 'Release' : 'Hold'}</button></div>
      <p>{pointer ? `${Math.max(700, zoomValue)}% local view · ${held ? 'held in place' : 'follows your pointer'}` : 'Move over the canvas to inspect a planting.'}</p>
      <canvas className={styles.lens} ref={lens} aria-label="Magnified planting detail" />
      <div className={styles.listTitle}>Closest plants · hover to match, click to locate</div>{plantList(close)}
    </aside>}
    {variant === 'strip' && <aside className={styles.reader}>
      <div className={styles.readerTitle}><strong>Reading strip</strong><button onClick={() => setStripX(null)}>Clear</button></div>
      <p>{stripX === null ? 'Click a planting on the canvas. This temporary strip changes only what you are reading.' : `1 m wide · ${strip.length} plants · top to bottom`}</p>
      <div className={styles.listTitle}>Hover a name to find its position. Click to centre it.</div>{plantList(strip)}
    </aside>}
    <div className={styles.status}>{zoomValue}% · {variant === 'current' ? 'Live production rendering' : stats}<span>Drag to pan · scroll to zoom</span></div>
    <nav className={styles.switcher} aria-label="Density proposal variants"><button aria-label="Previous proposal" onClick={() => cycle(-1)}>←</button>{variants.map((entry) => <button aria-pressed={variant === entry.key} onClick={() => changeVariant(entry.key)}>{entry.name}</button>)}<button aria-label="Next proposal" onClick={() => cycle(1)}>→</button></nav>
  </div>
}
