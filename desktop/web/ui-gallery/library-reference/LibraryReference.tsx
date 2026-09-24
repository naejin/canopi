import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { SurfaceHeader } from '../../src/components/shared/SurfaceHeader'
import { SurfaceSearch } from '../../src/components/shared/SurfaceSearch'
import { ActionMenu } from '../../src/components/shared/ActionMenu'
import { createLibraryReference, designNames, scenarios, type DesignId, type LibraryItem, type LibraryReferenceModel } from './model'
import styles from './reference.module.css'

type View = { kind: 'list' | 'picker' | 'import' } | { kind: 'details' | 'rename' | 'delete'; id: string }
const sampleFiles = ['orchard-west.tif', 'orchard-east.tif', 'orchard-south.tif']
const statusLabels = { ready: 'Ready', importing: 'Preparing data…', failed: 'Import failed', cancelled: 'Cancelled', unavailable: 'Data unavailable' }

export function LibraryReference({ model: suppliedModel }: { model?: LibraryReferenceModel }) {
  const params = new URLSearchParams(location.search)
  const model = useMemo(() => suppliedModel ?? createLibraryReference(params.get('state') ?? 'ready'), [suppliedModel])
  const [dark, setDark] = useState(params.get('theme') === 'dark')
  const [panel, setPanel] = useState<'library' | 'layers' | null>('library')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All data')
  const [name, setName] = useState('Orchard terrain')
  const [files, setFiles] = useState<string[]>(sampleFiles.slice(0, 2))
  const [selected, setSelected] = useState<string | null>(null)
  const [sample, setSample] = useState<string | null>(null)
  const [fit, setFit] = useState(false)
  const [zoom, setZoom] = useState(1)
  const scroll = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const restoreId = useRef<string | null>(null)
  const restoreList = useRef(false)
  const currentLayers = model.layers.value[model.activeDesign.value]
  const activeJob = model.items.value.find(item => item.status === 'importing')
  const item = 'id' in view ? model.items.value.find(row => row.id === view.id) : undefined
  const selectedItem = model.items.value.find(row => row.id === selected)
  const selectedLayer = currentLayers.find(row => row.id === selected)
  const busy = Boolean(activeJob)
  const visibleItems = [...model.items.value].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .filter(row => ['importing', 'failed', 'cancelled'].includes(row.status)
      || ((filter === 'All data' || row.kind === filter) && row.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())))

  useEffect(() => {
    const previous = document.documentElement.dataset.theme
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    return () => { document.documentElement.dataset.theme = previous ?? 'light' }
  }, [dark])
  useEffect(() => {
    if (!model.inspection.value) setSample(null)
  }, [model.inspection.value])
  useLayoutEffect(() => {
    if (panel === 'library' && view.kind === 'list' && restoreList.current) {
      restoreList.current = false
      if (scroll.current) scroll.current.scrollTop = savedScroll.current
      const target = restoreId.current ? document.getElementById(`item-${restoreId.current}`) : null
      ;(target ?? scroll.current?.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true })
    } else if (panel === 'library' && view.kind !== 'list') {
      scroll.current?.querySelector<HTMLElement>('input, h3')?.focus()
    }
  }, [view, panel])

  const back = () => { restoreList.current = true; setView({ kind: 'list' }) }
  const open = (next: View) => {
    if (view.kind === 'list') savedScroll.current = scroll.current?.scrollTop ?? 0
    if ('id' in next) restoreId.current = next.id
    setView(next)
  }
  const showPanel = (next: 'library' | 'layers') => { setPanel(next); model.inspection.value = null }
  const closePanel = () => { const previous = panel; setPanel(null); document.getElementById(`nav-${previous}`)?.focus() }
  const details = (row: LibraryItem) => { setPanel('library'); open({ kind: 'details', id: row.id }) }
  const beginImport = () => {
    let suggested = 'Orchard survey'
    let suffix = 2
    while (model.items.value.some(item => item.name === suggested)) suggested = `Orchard survey ${suffix++}`
    setName(suggested)
    setFiles(sampleFiles.slice(0, 2))
    restoreId.current = null
    open({ kind: 'picker' })
  }
  const add = (row: LibraryItem) => <button className={styles.add} disabled={row.status !== 'ready' || currentLayers.some(layer => layer.id === row.id)}
    aria-label={currentLayers.some(layer => layer.id === row.id) ? `${row.name} added` : `Add ${row.name} to Design`} onClick={() => model.add(row.id)}>
    {currentLayers.some(layer => layer.id === row.id) ? 'Added' : 'Add to Design'}</button>
  const menu = (row: LibraryItem) => <ActionMenu label={`Actions for ${row.name}`} items={[
    { label: 'Rename', run: () => { setName(row.name); open({ kind: 'rename', id: row.id }) } },
    { label: 'Delete from library', danger: true, run: () => open({ kind: 'delete', id: row.id }) },
  ]} />
  const jobControls = (row: LibraryItem) => row.status === 'importing' ? <div className={styles.job}>
    <progress aria-label={`Import progress for ${row.name}`} /><button onClick={() => model.cancel(row.id)}>Cancel</button>
  </div> : row.status === 'failed' || row.status === 'cancelled' ? <div className={styles.job}>
    {row.status === 'failed' && <span>Could not prepare the selected files.</span>}
    <button disabled={busy} onClick={() => model.retry(row.id)}>Retry</button>
    <button onClick={() => { model.deleteItem(row.id); back() }}>Dismiss</button>
  </div> : null
  const takeSample = () => {
    const target = model.items.value.find(row => row.id === model.inspection.value)
    if (target) setSample(target.kind === 'Slope' ? '12.4° · illustrative sample' : '118.6 m · illustrative sample')
  }

  return <div className={styles.app} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (model.inspection.value) { model.inspection.value = null; document.getElementById('inspect-layer')?.focus() }
    else if (view.kind !== 'list') back()
  }}>
    <div className={styles.review}>
      <span><strong>Interactive reference</strong> · Desktop UX · simulated files, jobs and terrain</span>
      <label>Fixture <select aria-label="Review fixture" value={params.get('state') ?? 'ready'} onChange={event => {
        const url = new URL(location.href); url.searchParams.set('state', event.currentTarget.value); url.searchParams.set('theme', dark ? 'dark' : 'light'); location.href = url.href
      }}>{scenarios.map(state => <option key={state}>{state}</option>)}</select></label>
      {activeJob && <><button onClick={() => model.finishImport(activeJob.id)}>Complete import</button><button onClick={() => model.finishImport(activeJob.id, true)}>Fail import</button></>}
      <a href="/?surface=workspace">Current app gallery ↗</a>
    </div>
    <header className={styles.titlebar}>
      <strong className={styles.brand}>canopi<span> / field notebook</span></strong>
      <label>Design <select aria-label="Current Design" value={model.activeDesign.value} onChange={event => {
        model.switchDesign(event.currentTarget.value as DesignId); setSelected(null); setFit(false)
      }}>{Object.entries(designNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <button onClick={() => setDark(!dark)}>{dark ? 'Light theme' : 'Dark theme'}</button>
    </header>
    <main className={styles.workspace}>
      <section className={styles.map} aria-label="Illustrative Design canvas">
        <div className={styles.mapHeading}><span>CANVAS</span><h1>{designNames[model.activeDesign.value]}</h1><p>Plants, paths and terrain in one place.</p></div>
        <svg className={styles.scene} viewBox={fit ? '160 90 640 520' : `${(1 - 1 / zoom) * 500} ${(1 - 1 / zoom) * 350} ${1000 / zoom} ${700 / zoom}`} role="img" aria-label="Illustrative orchard with terrain overlays">
          <defs><pattern id="plan-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--canvas-grid-major)" /></pattern></defs>
          <rect width="1000" height="700" fill="var(--canvas-bg)" /><rect width="1000" height="700" fill="url(#plan-grid)" />
          <path d="M-30 530 Q270 610 390 270 T1050 100" fill="none" stroke="var(--color-surface-alt)" strokeWidth="65" />
          {[...currentLayers].reverse().filter(layer => layer.visible).map(layer => {
            const data = model.items.value.find(row => row.id === layer.id)
            return data?.status === 'ready' ? <g key={layer.id} opacity={layer.opacity / 100} transform={data.id === 'north' || data.id === 'slope' ? 'translate(220 -30)' : undefined}>
              <path d="M180 170 L565 115 L720 435 L405 565 L180 435Z" fill={data.kind === 'Slope' ? 'var(--color-primary-bg)' : 'var(--color-surface-alt)'} />
              {Array.from({ length: 12 }, (_, i) => <path key={i} transform={`translate(440 340) scale(${1 - i * 0.065}) translate(-440 -340)`} d="M220 380C175 270 230 190 355 185C430 95 570 175 610 265C725 365 665 470 555 460C425 550 300 515 220 380Z" fill="none" stroke="var(--color-primary)" strokeWidth="1.6" />)}
              <path d="M180 170 L565 115 L720 435 L405 565 L180 435Z" fill="none" stroke="var(--color-primary)" strokeDasharray="6 5" />
            </g> : null
          })}
          <path d="M260 290 L540 215 L625 365 L343 438 Z" fill="var(--canvas-zone-fill)" stroke="var(--canvas-zone-stroke)" strokeWidth="1.5" />
          {Array.from({ length: 18 }, (_, i) => <g key={i} transform={`translate(${310 + i % 6 * 45 + Math.floor(i / 6) * 18} ${296 + Math.floor(i / 6) * 48 - i % 6 * 10})`}>
            <circle r="14" fill="var(--color-edible-bg)" stroke="var(--color-edible)" strokeWidth="1.5" /><path d="M-4 0H4M0-4V4" stroke="var(--color-edible)" />
          </g>)}
          <text x="340" y="478" fill="var(--color-text-muted)" fontSize="13">Mixed orchard · 18 trees</text>
          <path d="M655 500L715 475L744 526L685 553Z" fill="var(--color-surface)" stroke="var(--color-text-muted)" />
          <text x="685" y="580" fill="var(--color-text-muted)" fontSize="12">Tool shed</text>
          <g transform="translate(835 110)" stroke="var(--color-text-muted)"><path d="M0 35V0L-5 10M0 0L5 10" fill="none" /><text x="-5" y="-12" stroke="none" fill="var(--color-text-muted)">N</text></g>
        </svg>
        {model.inspection.value && <button className={styles.sampleTarget} aria-label="Sample terrain on canvas" onClick={takeSample} />}
        {model.inspection.value && <div className={styles.inspection} role="status"><strong>{model.items.value.find(row => row.id === model.inspection.value)?.name}</strong>
          <span>{sample ?? 'Click the terrain or sample the centre.'}</span><button onClick={takeSample}>Sample centre</button><button onClick={() => { model.inspection.value = null }}>Done</button></div>}
        <div className={styles.mapBottom}><span>Illustrative preview · no measured raster data</span><div><button aria-label="Zoom out" onClick={() => { setFit(false); setZoom(Math.max(0.7, zoom - 0.2)) }}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => { setFit(false); setZoom(Math.min(2, zoom + 0.2)) }}>+</button></div></div>
      </section>
      {panel && <aside className={styles.dock} aria-label={panel === 'library' ? 'Data Library' : 'Layers'}>
        <SurfaceHeader title={panel === 'library' ? 'Data Library' : 'Layers'} count={panel === 'library' ? model.items.value.length : currentLayers.length} onClose={closePanel} closeLabel="Close panel"
          actions={panel === 'library' && view.kind === 'list' ? <button className={styles.primary} disabled={busy} onClick={beginImport}>+ Import</button> : undefined} />
        <div className={styles.scroll} ref={scroll}>
          {panel === 'library' && view.kind === 'list' && <>
            <div className={styles.filters}><SurfaceSearch value={query} onChange={setQuery} label="Search data" />
              <label>Type <select aria-label="Data type" value={filter} onChange={event => setFilter(event.currentTarget.value)}>{['All data', 'Elevation', 'Slope'].map(type => <option key={type}>{type}</option>)}</select></label></div>
            {!model.items.value.length ? <div className={styles.empty}><h3>Your data, ready to reuse</h3><p>Import terrain once. Use it in any Design.</p><button onClick={beginImport}>Import terrain</button></div> : <ul className={styles.list}>
              {visibleItems.map(row => <li className={styles.item} key={row.id}>
                <div className={styles.itemMain}><button id={`item-${row.id}`} className={styles.identity} onClick={() => open({ kind: 'details', id: row.id })}>
                  <TerrainPreview slope={row.kind === 'Slope'} /><span><strong>{row.name}</strong><small>{row.kind === 'Slope' ? 'Slope · degrees' : `Elevation · 1 m · ${row.files.length} TIFF${row.files.length === 1 ? '' : 's'}`}</small>{row.status !== 'ready' && <small data-error={row.status === 'failed'}>{statusLabels[row.status]}</small>}</span>
                </button>{menu(row)}</div><div className={styles.rowActions}>{add(row)}</div>{jobControls(row)}
              </li>)}
            </ul>}
            {model.items.value.length > 0 && !visibleItems.length && <div className={styles.empty}><p>No matching data.</p><button onClick={() => { setQuery(''); setFilter('All data') }}>Clear filters</button></div>}
            <p className={styles.hint}>Shared across your Designs.</p>
          </>}
          {panel === 'library' && view.kind !== 'list' && <>
            <button className={styles.back} onClick={back}>← Back to library</button>
            {view.kind === 'picker' && <form className={styles.form} onSubmit={event => { event.preventDefault(); setView({ kind: 'import' }) }}>
              <h3 tabIndex={-1}>Choose terrain files</h3><p className={styles.muted}>Sample file picker · no files leave this reference.</p>
              {sampleFiles.map(file => <label className={styles.file} key={file}><input type="checkbox" checked={files.includes(file)} onChange={event => setFiles(event.currentTarget.checked ? sampleFiles.filter(name => name === file || files.includes(name)) : files.filter(name => name !== file))} />{file}</label>)}
              <p>{files.length} files → one library item</p><div className={styles.formActions}><button type="button" onClick={back}>Cancel</button><button className={styles.primary} disabled={!files.length}>Use selected files</button></div>
            </form>}
            {view.kind === 'import' && <form className={styles.form} onSubmit={event => {
              event.preventDefault(); const id = model.importFiles(name, files); if (id) { setView({ kind: 'details', id }); restoreId.current = id }
            }}><h3 tabIndex={-1}>Import terrain</h3><label>Name<input required value={name} onInput={event => setName(event.currentTarget.value)} /></label>
              <p>{files.length} TIFF files · ground elevation · metres</p><p className={styles.muted}>Interpretation is known for these sample files. Your import stays in the library until you add it to a Design.</p><details><summary>Selected files</summary>{files.map(file => <p key={file}>{file}</p>)}</details>
              <div className={styles.formActions}><button type="button" onClick={back}>Cancel</button><button className={styles.primary} disabled={busy || !name.trim()}>Import {files.length} files</button></div></form>}
            {view.kind === 'details' && item && <div className={styles.form}><div className={styles.detailTitle}><h3 tabIndex={-1}>{item.name}</h3>{menu(item)}</div>
              <div className={styles.preview}><TerrainPreview slope={item.kind === 'Slope'} /><span>Illustrative preview</span></div>
              <dl className={styles.facts}><dt>Type</dt><dd>{item.kind === 'Slope' ? 'Slope' : 'Ground elevation'}</dd><dt>Units</dt><dd>{item.kind === 'Slope' ? 'Degrees' : 'Metres'}</dd><dt>Resolution</dt><dd>1 m</dd><dt>Coverage</dt><dd>Sample orchard area</dd><dt>Status</dt><dd>{statusLabels[item.status]}</dd></dl>
              {item.kind === 'Slope' && <p className={styles.muted}>Saved result · Horn (legacy). New calculations come in a later milestone.</p>}
              {add(item)}{jobControls(item)}{item.status === 'unavailable' && <p>Local files are unavailable. The saved reference is preserved.</p>}
              <details><summary>{item.files.length} source file{item.files.length === 1 ? '' : 's'}</summary>{item.files.map(file => <p className={styles.filename} key={file}>{file}</p>)}</details>
            </div>}
            {view.kind === 'rename' && item && <form className={styles.form} onSubmit={event => { event.preventDefault(); model.rename(item.id, name); back() }}><h3 tabIndex={-1}>Rename data</h3><label>Name<input required value={name} onInput={event => setName(event.currentTarget.value)} /></label><div className={styles.formActions}><button type="button" onClick={back}>Cancel</button><button className={styles.primary} disabled={!name.trim()}>Save name</button></div></form>}
            {view.kind === 'delete' && item && <div className={styles.form}><h3 tabIndex={-1}>Delete {item.name}?</h3>
              {model.items.value.some(row => row.inputId === item.id) ? <><p>This data has a saved analysis result. Delete the result first.</p><button onClick={() => { setQuery(model.items.value.find(row => row.inputId === item.id)?.name ?? ''); setFilter('All data'); back() }}>Show related data</button></> : <><p>This removes the library item and its reference in the current Design. Other saved Designs may show it as unavailable.</p><p>This cannot be undone in the library.</p><div className={styles.formActions}><button onClick={back}>Keep data</button><button className={styles.danger} disabled={item.status === 'importing'} onClick={() => { model.deleteItem(item.id); back() }}>Delete from library</button></div></>}
            </div>}
          </>}
          {panel === 'layers' && <>
            <div className={styles.sceneLayers}><span className={styles.eyebrow}>DESIGN</span><div><strong>Plants & paths</strong><span>18 trees · 1 zone</span></div></div>
            <div className={styles.sectionTitle}><span>Data layers</span><button onClick={() => showPanel('library')}>+ Add data</button></div>
            {!currentLayers.length ? <div className={styles.empty}><h3>Add context to your Design</h3><p>Choose terrain or a saved result from Data Library.</p><button onClick={() => showPanel('library')}>Browse data</button></div> : <ul className={styles.list}>
              {currentLayers.map((layer, index) => { const row = model.items.value.find(item => item.id === layer.id); const label = row?.name ?? 'Unavailable library item'; return <li className={styles.layer} key={layer.id} data-selected={selected === layer.id}>
                <button className={styles.eye} aria-label={`${layer.visible ? 'Hide' : 'Show'} ${label}`} aria-pressed={layer.visible} onClick={() => model.setVisible(layer.id, !layer.visible)}><Eye visible={layer.visible} /></button>
                <button className={styles.layerName} onClick={() => setSelected(layer.id)}><strong>{label}</strong><small>{!row || row.status === 'unavailable' ? 'Data unavailable' : row.kind}</small></button>
                <div className={styles.order}><button disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => model.move(layer.id, -1)}>↑</button><button disabled={index === currentLayers.length - 1} aria-label={`Move ${label} down`} onClick={() => model.move(layer.id, 1)}>↓</button></div>
              </li> })}
            </ul>}
            {selectedLayer && <div className={styles.settings}><h3>{selectedItem?.name ?? 'Unavailable library item'}</h3>
              <label>Opacity <output>{selectedLayer.opacity}%</output><input aria-label="Layer opacity" type="range" min="0" max="100" value={selectedLayer.opacity} onInput={event => model.setOpacity(selectedLayer.id, Number(event.currentTarget.value))} /></label>
              {selectedItem?.status === 'ready' && <><div className={styles.legend} /><div className={styles.legendLabels}><span>{selectedItem.kind === 'Slope' ? '0°' : '104 m'}</span><span>{selectedItem.kind === 'Slope' ? '35°' : '132 m'}</span></div><p className={styles.muted}>Illustrative scale</p></>}
              <div className={styles.formActions}><button disabled={selectedItem?.status !== 'ready'} onClick={() => { setFit(!fit); setZoom(1) }}>{fit ? 'Return to Design' : 'Fit to data'}</button><button id="inspect-layer" disabled={!selectedLayer.visible || selectedItem?.status !== 'ready'} aria-pressed={model.inspection.value === selectedLayer.id} onClick={() => model.inspect(selectedLayer.id)}>Inspect</button></div>
              {selectedItem && <button onClick={() => details(selectedItem)}>Open in Data Library</button>}
              <button className={styles.remove} onClick={() => { model.remove(selectedLayer.id); setSelected(null) }}>Remove from Design</button>
            </div>}
          </>}
        </div>
      </aside>}
      <nav className={styles.rail} aria-label="Data panels"><button id="nav-library" aria-label="Open Data Library" aria-pressed={panel === 'library'} onClick={() => showPanel('library')}><LibraryIcon /><span>Data</span></button><button id="nav-layers" aria-label="Open Layers" aria-pressed={panel === 'layers'} onClick={() => showPanel('layers')}><LayersIcon /><span>Layers</span></button></nav>
    </main>
    <footer className={styles.status} role="status">{model.message.value}</footer>
  </div>
}

function TerrainPreview({ slope = false }: { slope?: boolean }) {
  return <svg viewBox="0 0 100 72" aria-hidden="true" className={styles.terrainPreview}>
    <rect width="100" height="72" fill="var(--color-surface-alt)" />
    <path d="M0 60Q15 18 46 29T100 9V72H0Z" fill={slope ? 'var(--color-primary)' : 'var(--color-border-strong)'} opacity="0.3" />
    {[0, 1, 2, 3, 4, 5].map(i => <path key={i} d={`M-5 ${40 + i * 7} Q25 ${2 + i * 6} 52 ${21 + i * 5} T105 ${3 + i * 10}`} fill="none" stroke="var(--color-primary)" strokeWidth="0.8" />)}
  </svg>
}
function Eye({ visible }: { visible: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 12S6 5 12 5S22 12 22 12S18 19 12 19S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!visible && <path d="M3 3L21 21" />}</svg> }
function LibraryIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="6" height="16" rx="1" /><path d="M12 4V20M16 4L21 19M3 8H9M3 16H9" /></svg> }
function LayersIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 8L12 3L22 8L12 13Z M2 12L12 17L22 12 M2 16L12 21L22 16" /></svg> }
