// THROWAWAY: accepted Layers inspector + Library drill-in. No production mutations.
// Real 2025 raster; incoming regions and survey changes are labelled synthetic fixtures.
import { computed, signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { DockPanelHeader } from '../../src/components/shared/DockPanelHeader'
import { PlantSymbolGlyph } from '../../src/components/canvas/PlantSymbolGlyph'
import styles from './lidar-prototype.module.css'

type Kind = string
type Meaning = 'elevation' | 'height' | 'intensity' | 'numeric'
type Product = { id: Kind; name: string; meaning: Meaning; units: string; reference: string; builtin: boolean }
type Mode = 'hillshade' | 'elevation'
type Design = { selected: boolean; kind: Kind; visible: boolean; opacity: number; modes: Record<Kind, Mode>; located: boolean }
type Regions = { north: boolean; south: boolean; eastNorth: boolean; eastSouth: boolean }
const empty = (): Regions => ({ north: false, south: false, eastNorth: false, eastSouth: false })
const products = signal<Record<Kind, Product>>({
  mnt: { id: 'mnt', name: 'Ground · MNT', meaning: 'elevation', units: 'm', reference: 'IGN69', builtin: true },
  mns: { id: 'mns', name: 'Surface · MNS', meaning: 'elevation', units: 'm', reference: 'IGN69', builtin: true },
})
const pendingProduct = signal<Product | null>(null)
const product = (kind: Kind): Product => products.value[kind] ?? (pendingProduct.value?.id === kind ? pendingProduct.value : { id: kind, name: 'LiDAR', meaning: 'numeric', units: '', reference: '', builtin: false })
const nameOf = (kind: Kind) => product(kind)?.name ?? 'Unavailable type'
const measuredBase = (kind: Kind) => kind === 'mnt' || kind === 'mns'
const kinds = computed(() => Object.keys(products.value))
const designs = signal<Record<'orchard' | 'new', Design>>({ orchard: { selected: true, kind: 'mnt', visible: true, opacity: 100, modes: { mnt: 'hillshade', mns: 'hillshade' }, located: true }, new: { selected: false, kind: 'mnt', visible: true, opacity: 100, modes: { mnt: 'hillshade', mns: 'hillshade' }, located: false } })
const current = signal<'orchard' | 'new'>('orchard')
const design = computed(() => ({ ...designs.value[current.value], mode: designs.value[current.value].modes[designs.value[current.value].kind] ?? 'elevation' }))
const coverage = signal<Record<Kind, Regions>>({ mnt: empty(), mns: empty() })
const receipts = signal<{ kind: Kind; before: Regions; band: string }[]>([])
const active = computed(() => coverage.value[design.value.kind] ?? empty())
type Fixture = 'ready' | 'missing-library' | 'missing-type' | 'read-error'
const fixture = signal<Fixture>('ready')
const libraryPresent = computed(() => fixture.value !== 'missing-library')
const resolved = computed(() => fixture.value === 'ready' && !!products.value[design.value.kind])
const browser = signal(false)
const importing = signal(false)
const importKind = signal<Kind>('mnt')
const importStep = signal<'assign' | 'review'>('assign')
const importTarget = signal('mnt')
const customName = signal('Canopy height')
const customMeaning = signal<Meaning>('height')
const customUnits = signal('m')
const customReference = signal('Above ground')
const importBand = signal('1')
const customError = computed(() => !customName.value.trim() ? 'Give this type a name.' : kinds.value.some(key => nameOf(key).toLowerCase() === customName.value.trim().toLowerCase()) ? 'This name already exists. Choose that type or use a distinct name.' : !customUnits.value.trim() ? 'Specify units, or enter unknown.' : '')
const decisions = signal<Regions>(empty())
const query = signal('')
const message = signal('All accepted coverage follows the selected type, across every Design.')
const grid = signal(true)
const objects = signal({ plants: true, zones: true, annotations: true, guides: true, basemap: true })
const selectedPlant = signal<number | null>(null)
const zoom = signal(2)
const pan = signal({ x: 0, y: 0 })
const viewport = signal({ width: 900, height: 650 })
const level = computed(() => Math.max(0, Math.min(6, Math.floor(Math.log2(1 / (zoom.value * 0.5))))))
const coverageWidth = computed(() => active.value.eastNorth || active.value.eastSouth ? 2000 : 1000)
function visibleExtent(x: number, width: number, y = 0, height = 1000) {
  const left = viewport.value.width / 2 + pan.value.x + (x - 500) * zoom.value
  const top = viewport.value.height / 2 + pan.value.y + (y - 500) * zoom.value
  return left < viewport.value.width && left + width * zoom.value > 0 && top < viewport.value.height && top + height * zoom.value > 0
}
const intersects = computed(() => (measuredBase(design.value.kind) && visibleExtent(0, 1000)) || ((active.value.north || active.value.south) && visibleExtent(500, 500)) || (active.value.eastNorth && visibleExtent(1000, 1000, 0, 500)) || (active.value.eastSouth && visibleExtent(1000, 1000, 500, 500)))
const status = computed(() => !resolved.value ? '' : !design.value.selected ? 'Choose a data type' : !measuredBase(design.value.kind) && !Object.values(active.value).some(Boolean) ? 'No accepted coverage yet' : !design.value.located ? 'Set a Design location' : !design.value.visible ? 'LiDAR hidden' : design.value.opacity === 0 ? 'LiDAR transparent' : !intersects.value ? 'Outside coverage' : 'All accepted coverage · up to date')
const shown = computed(() => design.value.selected && resolved.value && design.value.located && design.value.visible && design.value.opacity > 0 && intersects.value)
function patch(change: Partial<Design> & { mode?: Mode }) {
  const { mode, ...rest } = change
  const next = { ...designs.value[current.value], ...rest }
  if (mode) next.modes = { ...next.modes, [next.kind]: mode }
  designs.value = { ...designs.value, [current.value]: next }
}
const source = (kind: Kind, mode = design.value.mode, lod = level.value) => new URL(`./assets/${kind}-${mode}-${lod}.png`, import.meta.url).href
function designView() { zoom.value = 2; pan.value = { x: 0, y: 0 } }
function choose(kind = design.value.kind) { patch({ selected: true, visible: true, kind }); message.value = `${nameOf(kind)} selected. All accepted coverage is available automatically.` }
function startImport() {
  importTarget.value = design.value.kind
  importStep.value = 'assign'
  pendingProduct.value = null
  importBand.value = '1'
  importing.value = true
}
function prepareReview() {
  if (importTarget.value === 'create') {
    if (customError.value) return
    const id = `custom:${crypto.randomUUID()}`
    pendingProduct.value = { id, name: customName.value.trim(), meaning: customMeaning.value, units: customUnits.value.trim(), reference: customReference.value.trim(), builtin: false }
    importKind.value = id
  } else {
    pendingProduct.value = null
    importKind.value = importTarget.value
  }
  const existing = coverage.value[importKind.value] ?? empty()
  decisions.value = { north: !measuredBase(importKind.value) && !existing.north, south: !measuredBase(importKind.value) && !existing.south, eastNorth: !existing.eastNorth, eastSouth: !existing.eastSouth }
  importStep.value = 'review'
}
function applyImport() {
  const kind = importKind.value
  const before = coverage.value[kind] ?? empty()
  if (pendingProduct.value) products.value = { ...products.value, [kind]: pendingProduct.value }
  receipts.value = [...receipts.value, { kind, before, band: importBand.value }]
  coverage.value = { ...coverage.value, [kind]: { north: before.north || decisions.value.north, south: before.south || decisions.value.south, eastNorth: before.eastNorth || decisions.value.eastNorth, eastSouth: before.eastSouth || decisions.value.eastSouth } }
  fixture.value = 'ready'
  importing.value = false
  message.value = `${nameOf(kind)} updated for every Design. Selected areas accepted; other areas unchanged. Originals retained.`
}
function undoImport() {
  const last = receipts.value.at(-1)
  if (!last) return
  coverage.value = { ...coverage.value, [last.kind]: last.before }
  receipts.value = receipts.value.slice(0, -1)
  message.value = `Last ${nameOf(last.kind)} import undone across all Designs. Original sources retained.`
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(): void }) {
  return <button className={styles.visibility} aria-label={`Toggle ${label}`} aria-pressed={value} onClick={onChange}>{value ? '◉' : '○'}</button>
}
function LayerStack() {
  return <section aria-label="Fixed layer order">
    <DockPanelHeader title="Layers" />
    <div className={styles.sectionLabel}>Design objects <span>Above LiDAR</span></div>
    {([['annotations', 'Annotations', '1'], ['plants', 'Plants', '18'], ['guides', 'Measurement guides', '1'], ['zones', 'Zones', '1']] as const).map(([key, label, count]) => <div className={styles.layerRow} key={key}><Toggle label={label} value={objects.value[key]} onChange={() => { objects.value = { ...objects.value, [key]: !objects.value[key] } }} /><span>{label}</span><small>{count}</small></div>)}
    <div className={styles.layerRow}><Toggle label="Canvas grid" value={grid.value} onChange={() => { grid.value = !grid.value }} /><span>Canvas grid</span><small>Above LiDAR</small></div>
    <div className={styles.sectionLabel}>Site references <span>Fixed order</span></div>
    <div className={styles.layerRow} data-active="true"><Toggle label="LiDAR" value={design.value.visible} onChange={() => patch({ visible: !design.value.visible })} /><strong>LiDAR</strong><small>{design.value.selected ? nameOf(design.value.kind) : 'None'}</small></div>
    <div className={styles.layerRow}><Toggle label="Basemap" value={objects.value.basemap} onChange={() => { objects.value = { ...objects.value, basemap: !objects.value.basemap } }} /><span>Basemap</span><small>Behind LiDAR</small></div>
  </section>
}
// Deliberately irregular validity footprints: ragged boundaries, holes and disconnected islands.
// SVG paths are visual fixtures only; production acceptance uses exact raster validity masks.
const regionPaths: Record<keyof Regions, string> = {
  north: 'M540 55L690 90Q800 10 940 100L985 260L900 360L930 450L770 490L650 410L520 440L555 300L505 185ZM640 165Q690 130 735 170L710 245L645 230Z',
  south: 'M570 535L700 575L800 520Q960 540 940 690L855 755L725 705L550 760L510 645ZM620 835L740 800L815 885L705 965L570 930Z',
  eastNorth: 'M1010 155L1180 100L1240 185L1380 80Q1550 35 1680 115L1740 250L1940 300L1850 420L1610 455L1500 365L1290 465L1180 380L1040 445ZM1510 175L1600 160L1640 250L1535 285Z',
  eastSouth: 'M1030 565L1200 505L1350 590L1300 715L1470 780L1400 955L1230 870L1130 965L1005 790ZM1650 580L1800 535L1900 660L1790 730L1620 675Z',
}
function RegionArtwork({ regions }: { regions: Regions }) {
  return <g data-accepted-regions={JSON.stringify(regions)}>
    {(Object.keys(regionPaths) as (keyof Regions)[]).map(key => regions[key] && <path data-region={key} d={regionPaths[key]} fill-rule="evenodd" className={styles.syntheticSurvey} />)}
  </g>
}
function CoverageDiagram({ kind = design.value.kind }: { kind?: Kind }) {
  const regions = coverage.value[kind] ?? empty()
  return <svg className={styles.diagram} viewBox="0 0 2000 1000" role="img" aria-label={`${nameOf(kind)} accepted coverage`}>
    {measuredBase(kind) && <image href={source(kind, 'hillshade', 3)} width="1000" height="1000" />}
    <RegionArtwork regions={regions} />
  </svg>
}
function ImportReview() {
  const dialog = useRef<HTMLDialogElement>(null)
  // Both comparison panes share one camera for this modal mount.
  const camera = useRef({ zoom: signal(1), pan: signal(0) }).current
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  const before = coverage.value[importKind.value] ?? empty()
  const after = { north: before.north || decisions.value.north, south: before.south || decisions.value.south, eastNorth: before.eastNorth || decisions.value.eastNorth, eastSouth: before.eastSouth || decisions.value.eastSouth }
  const count = Object.values(decisions.value).filter(Boolean).length
  const assignment = importStep.value === 'assign'
  const builtin = measuredBase(importKind.value)
  const selectedDefinition = importTarget.value === 'create' ? null : product(importTarget.value)
  return <dialog ref={dialog} className={styles.reviewDialog} aria-labelledby="lidar-import-title" onCancel={() => { importing.value = false }}>
    <header className={styles.reviewHeader}><div><small>Import into shared library</small><h2 id="lidar-import-title">{assignment ? 'Choose the data type' : `Review ${nameOf(importKind.value)} coverage`}</h2></div><button aria-label="Cancel import" onClick={() => { importing.value = false }}>×</button></header>
    {assignment ? <div className={`${styles.reviewBody} ${styles.assignment}`}>
      <p>A custom survey can belong to MNT or MNS. Use a custom type when its values describe something different.</p>
      <label>Destination<select aria-label="Import destination" value={importTarget.value} onChange={event => { importTarget.value = event.currentTarget.value; importBand.value = '1' }}>
        {kinds.value.map(kind => <option value={kind}>{nameOf(kind)}</option>)}<option value="create">Create custom type…</option>
      </select></label>
      {importTarget.value === 'create' ? <>
        <label>Type name<input aria-label="Custom type name" value={customName.value} onInput={event => { customName.value = event.currentTarget.value }} /></label>
        <div className={styles.reviewColumns}><label>Values represent<select aria-label="Values represent" value={customMeaning.value} onChange={event => { const value = event.currentTarget.value as Meaning; customMeaning.value = value; customUnits.value = value === 'height' || value === 'elevation' ? 'm' : 'relative'; customReference.value = value === 'height' ? 'Above ground' : value === 'elevation' ? 'Unknown vertical reference' : 'Sensor / method specific' }}><option value="height">Height above ground</option><option value="elevation">Elevation</option><option value="intensity">Intensity</option><option value="numeric">Other numeric measurement</option></select></label><label>Units<input aria-label="Custom units" value={customUnits.value} onInput={event => { customUnits.value = event.currentTarget.value }} /></label></div>
        <label>Reference / measurement context<input aria-label="Measurement reference" value={customReference.value} onInput={event => { customReference.value = event.currentTarget.value }} /></label>
        <small>The name can change later. Meaning and units determine compatibility and available display tools. No shared “Other” bucket.</small>
        {customError.value && <p role="alert">{customError.value}</p>}
      </> : <p className={styles.scope}>{selectedDefinition?.meaning === 'elevation' ? 'Elevation' : selectedDefinition?.meaning} · {selectedDefinition?.units} · {selectedDefinition?.reference}. Only compatible measurements belong together.</p>}
      <details open><summary>Input interpretation · demo metadata</summary><label>Raster band<select aria-label="Raster band" value={importBand.value} onChange={event => { importBand.value = event.currentTarget.value }}><option value="1">Band 1 · numeric values</option>{(importTarget.value === 'create' || !selectedDefinition?.builtin) && <option value="2">Band 2 · alternate numeric fixture</option>}</select></label><p>Horizontal position: EPSG:2154 · 0.5 m cells. Missing positioning must be resolved before placement. Custom previews are schematic; no custom TIFF is decoded.</p></details>
      <p className={styles.fixtureNote}>A new type stays a draft until you apply accepted areas. Cancel leaves the library unchanged.</p>
    </div> : <>
    <div className={styles.reviewBody}>
      <p className={styles.scope}>These changes apply to every Design displaying {nameOf(importKind.value)}.</p>
      <div className={styles.compareToolbar}><span>{builtin ? 'Same view · fixed 140–200 m scale' : `Same view · ${product(importKind.value).units} · schematic values`}</span><button aria-label="Comparison pan west" onClick={() => { camera.pan.value -= 200 }}>←</button><button aria-label="Comparison pan east" onClick={() => { camera.pan.value += 200 }}>→</button><button aria-label="Comparison zoom in" onClick={() => { camera.zoom.value = Math.min(4, camera.zoom.value * 2) }}>+</button><button onClick={() => { camera.zoom.value = 1; camera.pan.value = 0 }}>Reset view</button></div>
      <div className={styles.comparison}>{(['Before', 'After'] as const).map(label => <section><strong>{label} <small>{label === 'Before' ? 'Current accepted coverage' : 'Your selected changes'}</small></strong><svg role="img" aria-label={`${label} import comparison`} viewBox={`${camera.pan.value} 0 ${2000 / camera.zoom.value} ${1000 / camera.zoom.value}`}>
        <rect width="2000" height="1000" className={styles.emptyCoverage} />
        {builtin && <image href={source(importKind.value, 'elevation', 3)} width="1000" height="1000" />}
        <RegionArtwork regions={label === 'Before' ? before : after} />
        {Object.entries(regionPaths).map(([key, path]) => <path data-review-region={key} d={path} fill-rule="evenodd" className={styles.updateOutline} vector-effect="non-scaling-stroke" />)}
        <g className={styles.regionLabels}><text x="760" y="80">A</text><text x="760" y="590">B</text><text x="1480" y="80">C</text><text x="1480" y="590">D</text></g>
      </svg></section>)}</div>
      <p className={styles.fixtureNote}>{builtin ? 'Simulation: 2025 background is measured. Incoming patches are schematic, not measured 2026 heights. Irregular edges, holes and disconnected islands are preserved; NoData retains existing data.' : 'Custom raster simulation: all colored patches are schematic. There is no measured custom raster. A new type starts empty. Irregular edges, holes and disconnected islands are preserved.'}</p>
      <div className={styles.reviewColumns}><section><h3>Uncovered areas</h3><p>Add by default. Deselect any area to leave it empty.</p>{(['eastNorth', 'eastSouth'] as const).map((key, i) => <label className={styles.decisionRow}><input type="checkbox" checked={decisions.value[key]} disabled={before[key]} onChange={event => { decisions.value = { ...decisions.value, [key]: event.currentTarget.checked } }} /><span>{i === 0 ? 'C' : 'D'} · Add east {i === 0 ? 'north' : 'south'}<small>{before[key] ? 'Already accepted · identical demo' : 'Irregular valid area · no existing data'}</small></span></label>)}</section>
      <section><h3>{builtin ? 'Overlapping areas' : 'Additional uncovered areas'}</h3><p>{builtin ? 'Keep existing unless you approve a replacement.' : 'Independent coverage for this custom type.'}</p>{(['north', 'south'] as const).map((key, i) => <label className={styles.decisionRow}><input type="checkbox" checked={decisions.value[key]} disabled={before[key]} onChange={event => { decisions.value = { ...decisions.value, [key]: event.currentTarget.checked } }} /><span>{i === 0 ? 'A' : 'B'} · {builtin ? 'Replace' : 'Add'} {key}{builtin ? ' overlap' : ''}<small>{before[key] ? 'Already accepted · identical demo' : `${builtin ? 'Keep 2025 → use 2026 demo' : 'No existing valid data'} · irregular mask`}</small></span></label>)}</section></div>
      <details><summary>Source details &amp; validity</summary><p>{builtin ? 'Existing: IGN · 15 Feb 2025 · 0.5 m · IGN69.' : `${nameOf(importKind.value)} · ${product(importKind.value).units} · ${product(importKind.value).reference}.`} Incoming fixture: band {importBand.value} · 0.5 m · compatible reference assumed; quality unverified. A newer date does not approve a replacement. Incoming NoData never removes existing valid samples.</p></details>
    </div>
    </>}
    <footer className={styles.reviewFooter}>{assignment ? <><span>1 · Interpret input</span><button onClick={() => { importing.value = false }}>Cancel</button><button className={styles.primaryButton} disabled={importTarget.value === 'create' && !!customError.value} onClick={prepareReview}>Review coverage</button></> : <><button onClick={() => { importStep.value = 'assign' }}>Back</button><span>{count} area{count === 1 ? '' : 's'} selected · other coverage stays unchanged</span><button onClick={() => { importing.value = false }}>Cancel</button><button className={styles.primaryButton} disabled={!count} onClick={applyImport}>Apply to shared library</button></>}</footer>
  </dialog>
}
function Controls() {
  return <section className={styles.controls} aria-label="LiDAR display">
    <div className={styles.heading}><strong>LiDAR</strong><button data-open-lidar-library onClick={() => { browser.value = true }}>Library</button></div>
    <label>Data type<select aria-label="LiDAR data type" value={design.value.selected ? design.value.kind : ''} onChange={event => { const value = event.currentTarget.value; if (products.value[value]) choose(value); else patch({ selected: false }) }}><option value="">None</option>{kinds.value.map(kind => <option value={kind}>{nameOf(kind)}</option>)}</select></label>
    <p>All accepted coverage, automatically.<br /><small>Including files added from other Designs.</small></p>
    <div className={styles.segment} aria-label="Display style">{(product(design.value.kind).meaning === 'elevation' ? ['hillshade', 'elevation'] as const : ['elevation'] as const).map(mode => <button aria-pressed={design.value.mode === mode} onClick={() => patch({ mode })}>{mode === 'hillshade' ? 'Relief' : product(design.value.kind).meaning === 'elevation' ? 'Elevation' : 'Value colors'}</button>)}</div>
    <label className={styles.range}>Opacity <output>{design.value.opacity}%</output><input aria-label="LiDAR opacity" type="range" min="0" max="100" value={design.value.opacity} onInput={event => patch({ opacity: Number(event.currentTarget.value) })} /></label>
    {status.value && <p className={styles.state} role="status">{status.value}</p>}
    <div className={styles.actions}>{!design.value.located ? <button onClick={() => { patch({ located: true }); designView() }}>Use sample location</button> : null}<button onClick={startImport}>Import files…</button></div>
  </section>
}
function Library() {
  return <>
    <DockPanelHeader title="LiDAR library" count={libraryPresent.value ? kinds.value.length : 0} actions={<button className={styles.back} onClick={() => { browser.value = false }}>Back</button>} />
    <section className={styles.library}>
      <p>On this computer · shared by all Designs</p>
      <input type="search" aria-label="Search LiDAR library" placeholder="Find a data type…" value={query.value} onInput={event => { query.value = event.currentTarget.value }} />
      {libraryPresent.value ? <>{kinds.value.filter(kind => nameOf(kind).toLowerCase().includes(query.value.toLowerCase())).map(kind => <div><button className={styles.datasetSelect} aria-pressed={design.value.selected && design.value.kind === kind} onClick={() => choose(kind)}>{measuredBase(kind) ? <img src={source(kind, 'hillshade', 3)} alt="" /> : <span className={styles.customGlyph} aria-hidden="true">▦</span>}<span><strong>{nameOf(kind)}</strong><small>{measuredBase(kind) ? '1 measured tile · ' : ''}{Object.values(coverage.value[kind] ?? empty()).filter(Boolean).length} accepted demo regions</small></span></button><CoverageDiagram kind={kind} />{!product(kind).builtin && <details><summary>Type details</summary><p>{product(kind).meaning} · {product(kind).units} · {product(kind).reference}</p><label>Rename<input aria-label={`Rename ${nameOf(kind)}`} value={nameOf(kind)} onChange={event => { const name = event.currentTarget.value.trim(); if (name && !kinds.value.some(other => other !== kind && nameOf(other).toLowerCase() === name.toLowerCase())) products.value = { ...products.value, [kind]: { ...product(kind), name } } }} /></label><small>Stable identity retained across Designs. Meaning and units are fixed for this type.</small></details>}</div>)}{!kinds.value.some(kind => nameOf(kind).toLowerCase().includes(query.value.toLowerCase())) && <p>No matching data types.</p>}</> : null}
      <button onClick={startImport}>Import into library…</button>
      <details><summary>Sources &amp; import history</summary><p>2 measured sources · 32 MB originals · acquired 15 Feb 2025. Added regions are simulation fixtures.</p><p>{receipts.value.length} accepted demo imports. Original sources retained.</p><button disabled={!receipts.value.length} onClick={undoImport}>Undo last library import</button></details>
      <small>Choose a type once. Newly accepted areas appear automatically everywhere that type is displayed.</small>
    </section>
  </>
}
export function LidarPanelPrototype() {
  const panel = useRef<HTMLDivElement>(null)
  const wasBrowsing = useRef(false)
  useEffect(() => {
    if (!browser.value && wasBrowsing.current) panel.current?.querySelector<HTMLButtonElement>('[data-open-lidar-library]')?.focus()
    if (panel.current) panel.current.scrollTop = 0
    wasBrowsing.current = browser.value
  }, [browser.value])
  return <div ref={panel} className={styles.panel}>
    {browser.value ? <Library /> : <><LayerStack /><Controls /></>}
  </div>
}

function ScenePreview() {
  const transform = `translate(${viewport.value.width / 2 + pan.value.x} ${viewport.value.height / 2 + pan.value.y}) scale(${zoom.value}) translate(-500 -500)`
  const gridStep = zoom.value > 0.8 ? 25 : 100
  return <svg className={styles.scene} width="100%" height="100%" aria-label="Layered preview: basemap, LiDAR, grid, zones, plants and annotations">
    <defs><pattern id="lidar-demo-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M ${gridStep} 0 H 0 V ${gridStep}`} className={styles.gridLine} vector-effect="non-scaling-stroke" /></pattern><pattern id="lidar-demo-neighbour" width="70" height="70" patternUnits="userSpaceOnUse"><path d="M0 70L70 0" className={styles.demoHatch} vector-effect="non-scaling-stroke" /></pattern></defs>
    <g transform={transform}>
      <g data-layer="basemap" visibility={objects.value.basemap ? 'visible' : 'hidden'}><rect x="-5000" y="-5000" width="10000" height="10000" className={styles.baseFill} /><path d="M-1000 320Q450 420 900 730T2800 850M280 2000Q220 950 700 -1000" className={styles.baseRoad} /><path d="M-1000 320Q450 420 900 730T2800 850M280 2000Q220 950 700 -1000" className={styles.baseRoadCenter} /></g>
      <g data-layer="lidar" pointer-events="none" opacity={design.value.opacity / 100}>
        {shown.value && measuredBase(design.value.kind) && visibleExtent(0, 1000) && <image data-raster="measured" onError={() => { fixture.value = 'read-error' }} href={source(design.value.kind)} x="0" y="0" width="1000" height="1000" aria-label={`${nameOf(design.value.kind)} real 2025 raster`} />}
        {shown.value && <RegionArtwork regions={active.value} />}
      </g>
      <g data-layer="grid" pointer-events="none" visibility={grid.value ? 'visible' : 'hidden'}><rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#lidar-demo-grid)" /></g>
      <g data-layer="zones" visibility={objects.value.zones ? 'visible' : 'hidden'}><path d="M370 410L585 420L635 575L390 590Z" className={styles.zone} vector-effect="non-scaling-stroke" /><text x="388" y="435" className={styles.sceneText}>Orchard · sample Zone</text></g>
      <g data-layer="plants" visibility={objects.value.plants ? 'visible' : 'hidden'}>{Array.from({ length: 18 }, (_, i) => {
        const x = 408 + i % 6 * 30; const y = 464 + Math.floor(i / 6) * 40
        return <g transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={`Select sample plant ${i + 1}`} onPointerDown={event => event.stopPropagation()} onClick={() => { selectedPlant.value = i }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectedPlant.value = i } }} className={styles.plant}>
          {selectedPlant.value === i && <circle r="13" className={styles.selection} vector-effect="non-scaling-stroke" />}<g transform="translate(-8 -8)"><PlantSymbolGlyph symbol="round" size={16} /></g>
        </g>
      })}</g>
      <g data-layer="guides" visibility={objects.value.guides ? 'visible' : 'hidden'}><path d="M390 610H630M390 602V618M630 602V618" className={styles.guide} vector-effect="non-scaling-stroke" /><text x="490" y="624" className={styles.sceneText}>240 m</text></g>
      <g data-layer="annotations" visibility={objects.value.annotations ? 'visible' : 'hidden'}><text x="390" y="396" className={styles.annotation}>Design over terrain</text></g>

    </g>
  </svg>
}
export function LidarCanvasPrototype() {
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const node = area.current!
    const resize = new ResizeObserver(() => { viewport.value = { width: node.clientWidth, height: node.clientHeight } })
    resize.observe(node)
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable],[role="slider"]')) return
      if (importing.value) return
      if (event.key === 'Escape') { browser.value = false; importing.value = false; selectedPlant.value = null }
    }
    window.addEventListener('keydown', key)
    return () => { resize.disconnect(); window.removeEventListener('keydown', key) }
  }, [])
  return <div className={styles.canvasWorkspace}>
    <div className={styles.experiment}><strong>LiDAR study</strong><span>Memory-only preview</span><label>LiDAR fixture <select aria-label="LiDAR fixture" value={fixture.value} onChange={event => { fixture.value = event.currentTarget.value as Fixture }}><option value="ready">Available</option><option value="missing-library">Missing library</option><option value="missing-type">Missing type</option><option value="read-error">Read failure</option></select></label><select aria-label="Sample Design" value={current.value} onChange={event => { current.value = event.currentTarget.value === 'new' ? 'new' : 'orchard'; designView() }}><option value="orchard">Saved Design</option><option value="new">New Design</option></select><button onClick={() => { patch({ located: !design.value.located }) }}>{design.value.located ? 'Clear location' : 'Use sample location'}</button></div>
    <div ref={area} className={styles.map} tabIndex={0} aria-label="LiDAR preview; drag to pan, wheel to zoom, or use buttons"
      onWheel={event => { event.preventDefault(); zoom.value = Math.max(0.025, Math.min(8, zoom.value * Math.exp(-event.deltaY * 0.002))) }}
      onPointerDown={event => { if ((event.target as Element).closest('button,input,select,label,section,[role="button"]')) return; drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (!drag.current) return; pan.value = { x: pan.value.x + event.clientX - drag.current.x, y: pan.value.y + event.clientY - drag.current.y }; drag.current = { x: event.clientX, y: event.clientY } }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <ScenePreview />
      {resolved.value && <div className={styles.mapCaption}><strong>Site 0446–6807 · {nameOf(design.value.kind)}</strong><span>{status.value}</span><span>Basemap → LiDAR → grid & Design objects</span>{Object.values(active.value).some(Boolean) && <span>Incoming coverage patches are simulations</span>}</div>}
      {resolved.value && !shown.value && <section className={styles.notice}><strong>{status.value}</strong><p>Design objects stay visible. Your selected data type and display settings are retained.</p></section>}
      {selectedPlant.value !== null && <section className={styles.selectionNotice}>Sample plant {selectedPlant.value + 1} selected above LiDAR<button onClick={() => { selectedPlant.value = null }}>Clear selection</button></section>}
      <section className={styles.zoom} aria-label="Preview camera"><button aria-label="Zoom out" onClick={() => { zoom.value = Math.max(0.025, zoom.value / 2) }}>−</button><span>{(1 / zoom.value).toFixed(2)} m / px</span><button aria-label="Zoom in" onClick={() => { zoom.value = Math.min(8, zoom.value * 2) }}>+</button><button onClick={designView}>Design view</button><button onClick={() => { pan.value = { x: viewport.value.width + coverageWidth.value * zoom.value, y: 0 } }}>Pan outside</button></section>
      {shown.value && <section className={styles.legend}><strong>{!measuredBase(design.value.kind) ? `${nameOf(design.value.kind)} · ${product(design.value.kind).units}` : design.value.mode === 'elevation' ? 'Elevation · metres IGN69' : 'Relief · NW illumination'}</strong>{measuredBase(design.value.kind) && design.value.mode === 'elevation' && <><img className={styles.ramp} src={new URL('./assets/elevation-legend.png', import.meta.url).href} alt="Elevation scale from pale at 140 metres to brown at 200 metres" /><span>140 m <span>200 m</span></span></>}<small>{measuredBase(design.value.kind) ? 'IGN LiDAR HD · schematic basemap' : 'Custom values are schematic'}</small></section>}
    </div>
    {importing.value && <ImportReview />}
    <details className={styles.evidence}><summary>Prototype state · shared {design.value.kind.toUpperCase()} coverage · overview {level.value}</summary><pre>{JSON.stringify({ layout: 'Layers inspector + Library drill-in', fixture: fixture.value, libraryPresent: libraryPresent.value, productRegistry: products.value, stagedType: pendingProduct.value, importBand: importBand.value, importReceipts: receipts.value, camera: { zoom: zoom.value, pan: pan.value }, acceptedCoverage: coverage.value, designs: designs.value, currentDesign: current.value, importDecisions: importing.value ? decisions.value : null, grid: grid.value, objects: objects.value, drawOrder: 'basemap < LiDAR < grid < zones < plants < guides/annotations', intersects: intersects.value, previewCellMetres: 0.5 * 2 ** level.value, storage: 'memory only; native tiling and persistence not implemented', simulated: 'incoming survey patches, neighbouring coverage, Design geometry and basemap' }, null, 2)}</pre></details>
    {resolved.value && <div className={styles.message} role="status">{message.value}</div>}

  </div>
}
