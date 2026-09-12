/** Throwaway review: A refines the accepted surfaces; B compares alternative disclosure/current UI.
 * Only imported by the dev-only gallery. All authored prototype state is disposable.
 */
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { SurfaceHeader } from '../src/components/shared/SurfaceHeader'
import { SurfaceSearch } from '../src/components/shared/SurfaceSearch'
import { SpeciesIdentity } from '../src/components/shared/SpeciesIdentity'
import { ActionMenu } from '../src/components/shared/ActionMenu'
import { PlantSymbolGlyph } from '../src/components/canvas/PlantSymbolGlyph'
import { PlantDetailCard } from '../src/components/plant-detail/PlantDetailCard'
import { navigateAppearanceChoices } from '../src/components/canvas/useAppearancePopover'
import { PLANT_SYMBOL_IDS, type PlantSymbolId } from '../src/canvas/runtime/scene'
import { speciesCatalogWorkbench } from '../src/app/plant-browser'
import { readCanvasLayerPresentation, setCanvasLayerPresentationActiveLayer, setCanvasLayerPresentationVisibility, setCanvasLayerPresentationLocked, setCanvasLayerPresentationOpacity, setCanvasLayerPresentationContourIntervalMeters } from '../src/app/canvas-layer-presentation/presentation'
import { currentCanvasQuerySurface, currentCanvasPlantPresentationCommandSurface } from '../src/canvas/session'
import { t } from '../src/i18n'
import { specimens } from './fixtures'
import { activity } from './memory-backend'
import styles from './review-proposals.module.css'

type IconName = 'eye' | 'hidden' | 'lock' | 'unlock' | 'leaf' | 'note' | 'ruler' | 'zone' | 'map' | 'contours' | 'hillshade' | 'plus' | 'trash' | 'section' | 'file' | 'import' | 'star'
const paths: Record<IconName, string> = {
  eye: 'M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4Z M6 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  hidden: 'M2 8s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4Z M2 2l12 12',
  lock: 'M4 7h8v7H4Z M5 7V5a3 3 0 0 1 6 0v2 M8 10v2',
  unlock: 'M4 7h8v7H4Z M5 7V5a3 3 0 0 1 6-1 M8 10v2',
  leaf: 'M3 13C-1 4 9 2 14 2c0 8-3 13-10 10 M2 15 11 5',
  note: 'M3 2h10M8 2v12M5 14h6', ruler: 'm2 10 8-8 4 4-8 8Z M5 7l2 2M8 4l2 2',
  zone: 'M2 4h12v8H2Z', map: 'm2 4 4-2 4 2 4-2v10l-4 2-4-2-4 2Z M6 2v10M10 4v10',
  contours: 'm2 5 4-3 4 3 4-3M2 9l4-3 4 3 4-3M2 13l4-3 4 3 4-3',
  hillshade: 'm1 13 5-10 4 10Zm6 0 4-7 4 7Z', plus: 'M8 3v10M3 8h10',
  trash: 'M3 4h10M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4',
  section: 'M2 4h5l2 2h5v8H2Z M10 8v4M8 10h4',
  file: 'M4 2h6l3 3v9H4Z M10 2v4h3M6 9h5M6 11h4',
  import: 'M8 2v8M5 7l3 3 3-3M3 11v3h10v-3',
  star: 'm8 1 2 4.5 5 .7-3.5 3.5.8 5L8 12.3l-4.3 2.4.8-5L1 6.2l5-.7Z',
}
function Icon({ name }: { name: IconName }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
function IconButton({ label, icon, onClick, pressed }: { label: string; icon: IconName; onClick(): void; pressed?: boolean }) {
  return <button type="button" className={styles.iconButton} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}><Icon name={icon} /></button>
}
function Header({ title, count, close, actions }: { title: string; count?: number; close(): void; actions?: ComponentChildren }) {
  return <SurfaceHeader title={title} count={count} closeLabel={t('window.close')} onClose={close} actions={actions} />
}

const layerIcons: Record<string, IconName> = { annotations: 'note', plants: 'leaf', 'measurement-guides': 'ruler', zones: 'zone', base: 'map', contours: 'contours', hillshading: 'hillshade' }
export function LayersProposal({ close, alternative, locate }: { close(): void; alternative: boolean; locate(): void }) {
  const rows = readCanvasLayerPresentation().rows
  const active = rows.find(row => row.active) ?? rows[1]!
  const scene = currentCanvasQuerySurface.value?.getSceneSnapshot()
  const counts: Record<string, number> = { plants: scene?.plants.length ?? 0, annotations: scene?.annotations.length ?? 0, zones: scene?.zones.length ?? 0, 'measurement-guides': scene?.measurementGuides.length ?? 0 }
  const detail = active.detail
  const needsLocation = detail.type !== 'scene' && !detail.hasLocation
  const status = `${active.visible ? 'Visible' : 'Hidden'}${active.locked ? ' · locked' : ''}`
  return <section className={styles.panel} aria-label="Layers proposal">
    <Header title={t('canvas.layers.layerPanel')} close={close} />
    <div className={styles.scroll}>
      <div className={styles.sectionHeading}><h3>Scene stack</h3><span>Top to bottom</span></div>
      {rows.map((row, index) => <div key={row.id}>
        {index === 4 && <div className={styles.sectionHeading}><h3>{t('canvas.layers.references')}</h3><span>Below the scene</span></div>}
        <div className={styles.layerRow} data-active={active.id === row.id}>
          <IconButton label={`Visibility: ${row.label}`} icon={row.visible ? 'eye' : 'hidden'} pressed={row.visible} onClick={() => setCanvasLayerPresentationVisibility(row.id, !row.visible)} />
          <button className={styles.layerName} aria-current={active.id === row.id ? 'true' : undefined} onClick={() => setCanvasLayerPresentationActiveLayer(row.id)}>
            <Icon name={layerIcons[row.id] ?? 'zone'} /><strong>{row.label}</strong>
          </button>
          {row.detail.type === 'scene' && <span className={styles.count}>{counts[row.id]}</span>}
          {row.canLock && <IconButton label={`${row.locked ? 'Unlock' : 'Lock'}: ${row.label}`} icon={row.locked ? 'lock' : 'unlock'} pressed={row.locked} onClick={() => setCanvasLayerPresentationLocked(row.id, !row.locked)} />}
        </div>
        {alternative && row.detail.type === 'scene' && <label className={styles.inlineSlider}>Opacity<input type="range" min="0" max="100" aria-label={`Opacity: ${row.label}`} value={Math.round(row.opacity * 100)} onInput={e => setCanvasLayerPresentationOpacity(row.id, Number(e.currentTarget.value) / 100)} /><output>{Math.round(row.opacity * 100)}%</output></label>}
      </div>)}
      {(!alternative || detail.type !== 'scene') && <section className={styles.inspector} aria-label={`${active.label} settings`}>
        <div className={styles.inspectorHeading}><Icon name={layerIcons[active.id] ?? 'zone'} /><h3>{active.label}</h3><span>{status}</span></div>
        {needsLocation ? <><p>Add a design location to use this site reference.</p><button className={styles.action} onClick={locate}>Set location</button></> : <>
          {detail.type === 'location-map' && <p>{detail.locationSummary}</p>}
          <label className={styles.slider}>Opacity<output>{Math.round(active.opacity * 100)}%</output><input type="range" aria-label={`Opacity: ${active.label}`} min="0" max="100" value={Math.round(active.opacity * 100)} disabled={detail.type === 'location-map' && detail.opacityDisabled} onInput={e => setCanvasLayerPresentationOpacity(active.id, Number(e.currentTarget.value) / 100)} /></label>
          {detail.type === 'contours' && <label className={styles.number}>Contour interval <span><input aria-label="Contour interval" type="number" min="0" value={detail.contourIntervalMeters} onInput={e => { if (e.currentTarget.value) setCanvasLayerPresentationContourIntervalMeters(Math.max(0, Number(e.currentTarget.value))) }} /> m</span></label>}
        </>}
      </section>}
    </div>
    <p className={styles.footnote}>Visibility and locking are independent of the active layer.</p>
  </section>
}

export function SymbolProposal({ close }: { close(): void }) {
  const [symbol, setSymbol] = useState<PlantSymbolId>(() => {
    const effective = currentCanvasQuerySurface.value?.getSelectedPlantSymbolContext().sharedEffectiveSymbol
    return effective && effective !== 'mixed' ? effective : 'canopy'
  })
  const ref = useRef<HTMLElement>(null)
  const query = currentCanvasQuerySurface.value
  void query?.revision.scene.value
  const context = query?.getSelectedPlantSymbolContext()
  const abstract: readonly PlantSymbolId[] = ['round', 'square', 'triangle', 'cross']
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus() }, [])
  const groups = [{ label: t('canvas.plantSymbol.botanical'), symbols: PLANT_SYMBOL_IDS.filter(s => !abstract.includes(s)) }, { label: t('canvas.plantSymbol.abstract'), symbols: abstract }]
  return <section ref={ref} className={`${styles.panel} ${styles.symbolPanel}`} role="dialog" aria-label="Plant symbol proposal" data-preserve-overlays="true" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } else navigateAppearanceChoices(e, 3) }}>
    <Header title={t('canvas.plantSymbol.label')} close={close} />
    <div className={styles.selection}><SpeciesIdentity commonName={context?.singleSpeciesCommonName} canonicalName={context?.singleSpeciesCanonicalName ?? 'Mixed selection'} mark={<span style={{ color: specimens[0][3] }}><PlantSymbolGlyph symbol={symbol} size={32} /></span>} detail={`${context?.plantIds.length ?? 0} selected · preview`} /></div>
    <div className={styles.symbolScroll} role="listbox" aria-label="Plant symbols">{groups.map(group => <div className={styles.symbolGroup} role="group" aria-label={group.label} key={group.label}>
      <h3>{group.label}</h3><div className={styles.symbolGrid}>{group.symbols.map(id => <button key={id} role="option" aria-selected={symbol === id} tabIndex={symbol === id ? 0 : -1} title={t(`canvas.plantSymbol.names.${id}`)} onClick={() => setSymbol(id)}>
        <PlantSymbolGlyph symbol={id} size={24} /><span>{t(`canvas.plantSymbol.names.${id}`)}</span>
      </button>)}</div>
    </div>)}</div>
    <div className={styles.actions}><button className={styles.primary} disabled={!context?.plantIds.length} onClick={() => { currentCanvasPlantPresentationCommandSurface.value?.setSelectedPlantSymbol(symbol); activity.value = `Applied ${symbol} to the sample selection.`; close() }}>Apply to {context?.plantIds.length ?? 0} selected</button>
      {context?.singleSpeciesCanonicalName && <button className={styles.action} onClick={() => { currentCanvasPlantPresentationCommandSurface.value?.setPlantSymbolForSpecies(context.singleSpeciesCanonicalName!, symbol); activity.value = `Applied ${symbol} to the sample species.`; close() }}>All {context.singleSpeciesCommonName ?? context.singleSpeciesCanonicalName} in this design</button>}
    </div>
  </section>
}

export function FavoritesProposal({ close, empty, long }: { close(): void; empty: boolean; long: boolean }) {
  const [search, setSearch] = useState('')
  const favorites = speciesCatalogWorkbench.favorites.value.items
  const [stamps, setStamps] = useState(empty ? [] : [{ name: 'Apple guild', summary: '7 plants · 1 zone' }, { name: 'Berry hedge', summary: '12 plants · 1 zone' }, { name: 'Pollinator border', summary: '9 plants · 1 zone' }])
  const [rename, setRename] = useState<number | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const [stampHeight, setStampHeight] = useState(260)
  const [preview, setPreview] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const backFocus = useRef<string | null>(null)
  const dragStamp = useRef<number | null>(null)
  const selected = speciesCatalogWorkbench.selectedCanonicalName.value
  const showingDetail = selected && selected === opened
  useEffect(() => speciesCatalogWorkbench.mount('favorites'), [])
  useLayoutEffect(() => { if (rename !== null) root.current?.querySelector<HTMLInputElement>('input[aria-label="Stamp name"]')?.focus() }, [rename])
  useLayoutEffect(() => {
    if (showingDetail) { backFocus.current = selected; root.current?.querySelector<HTMLButtonElement>('[data-detail] button')?.focus() }
    else if (backFocus.current) { Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-info]') ?? []).find(b => b.dataset.info === backFocus.current)?.focus(); backFocus.current = null }
  }, [showingDetail])
  const canSave = Boolean(currentCanvasQuerySurface.value?.getSelectedPlantSymbolContext().plantIds.length)
  function moveStamp(from: number, to: number) {
    const next = [...stamps]; const [item] = next.splice(from, 1); if (item) next.splice(to, 0, item); setStamps(next)
  }
  return <section ref={root} className={styles.panel} aria-label="Favorites proposal" onKeyDown={e => { if (e.key === 'Escape' && showingDetail) { e.stopPropagation(); speciesCatalogWorkbench.closeSpeciesDetail() } }}>
    <div className={styles.favoriteList} hidden={Boolean(showingDetail)}>
      <Header title="Favorites" close={close} />
      <section className={styles.plantsFrame} aria-label="Favorite plants">
        <div className={styles.sectionHeading}><h3>Plants</h3><span>{favorites.length}</span></div>
        <div className={styles.search}><SurfaceSearch value={search} onChange={setSearch} label="Find a favorite…" /></div>
        <div className={styles.scroll}>{favorites.filter(p => `${p.common_name} ${p.canonical_name}`.toLowerCase().includes(search.toLowerCase())).map(plant => {
          const spec = specimens.find(p => p[0] === plant.canonical_name)!
          const name = spec[1]
          return <div className={styles.favoriteRow} key={plant.canonical_name}>
            <span className={styles.draggableIdentity} draggable onDragStart={e => { e.dataTransfer?.setData('text/plain', name); activity.value = `Placement preview: ${name}.` }}>
              <SpeciesIdentity commonName={long ? name + ' — a particularly long local cultivar name' : name} canonicalName={plant.canonical_name} mark={<span style={{ color: spec[3] }}><PlantSymbolGlyph symbol={spec[2]} size={22} /></span>} />
            </span>
            <IconButton icon="plus" label={`Place ${name}`} onClick={() => { activity.value = `Placement preview: ${name}.` }} />
            <IconButton icon="star" label={`Remove ${name} from favorites`} pressed onClick={() => { void speciesCatalogWorkbench.toggleFavorite(plant.canonical_name) }} />
            <button className={styles.info} data-info={plant.canonical_name} aria-label={`Plant information: ${name}`} title={`Plant information: ${name}`} onClick={() => { setPreview(null); setOpened(plant.canonical_name); speciesCatalogWorkbench.selectSpecies(plant.canonical_name) }}>›</button>
          </div>
        })}{!favorites.length && <p className={styles.empty}>Favorite plants in the Species Catalog to keep them here.</p>}{favorites.length > 0 && !favorites.some(p => `${p.common_name} ${p.canonical_name}`.toLowerCase().includes(search.toLowerCase())) && <p className={styles.empty}>No matching favorites.</p>}</div>
      </section>
      <div role="separator" tabIndex={0} aria-label="Resize Plants and Saved stamps" aria-orientation="horizontal" aria-valuenow={stampHeight} aria-valuemin={120} aria-valuemax={500} className={styles.splitter}
        onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setStampHeight(Math.max(120, Math.min(500, stampHeight + (e.key === 'ArrowUp' ? 20 : -20)))) } }}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.start = `${e.clientY},${stampHeight}` }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const [y, h] = e.currentTarget.dataset.start!.split(',').map(Number); setStampHeight(Math.max(120, Math.min(500, h! + y! - e.clientY))) }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }} />
      <section className={styles.stampsFrame} style={{ height: stampHeight }} aria-label="Saved stamps">
        <div className={styles.sectionHeading}><h3>Saved stamps</h3><span>{stamps.length}</span><IconButton icon="import" label="Import a saved stamp" onClick={() => setStamps([...stamps, { name: 'Imported orchard guild', summary: '7 plants · 1 zone' }])} /></div>
        <div className={styles.save}><button className={styles.action} disabled={!canSave} onClick={() => setStamps([...stamps, { name: 'Current selection', summary: '3 plants' }])}><Icon name="plus" />Save selection</button></div>
        <div className={styles.scroll}>{stamps.map((stamp, index) => <div key={index} className={styles.stampRow} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragStamp.current !== null) moveStamp(dragStamp.current, index); dragStamp.current = null }}>
          <button className={styles.grip} draggable aria-label={`Reorder ${stamp.name}`} title="Drag to reorder; Alt+↑/↓" onDragStart={() => { dragStamp.current = index; setPreview(null) }} onDragEnd={() => { dragStamp.current = null }} onKeyDown={e => { if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); moveStamp(index, Math.max(0, Math.min(stamps.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)))) } }}>⠿</button>
          <div className={styles.stampIdentity}>
            {rename === index ? <input aria-label="Stamp name" value={stamp.name} onInput={e => setStamps(stamps.map((s, i) => i === index ? { ...s, name: e.currentTarget.value } : s))} onBlur={() => setRename(null)} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setRename(null) }} /> : <button className={styles.rowBody} draggable onDragStart={e => { e.dataTransfer?.setData('text/plain', stamp.name); activity.value = `Placement preview: ${stamp.name}.`; setPreview(null) }} onMouseEnter={() => setPreview(stamp.name)} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview(stamp.name)} onBlur={() => setPreview(null)} onClick={() => { activity.value = `Placement preview: ${stamp.name}.` }}><strong>{long ? stamp.name + ' — a reusable arrangement for the northern boundary' : stamp.name}</strong><span>{stamp.summary}</span></button>}
            {removing === index && <div className={styles.confirm}>Delete stamp? <button onClick={() => { setStamps(stamps.filter((_, i) => i !== index)); setRemoving(null) }}>Delete</button><button onClick={() => setRemoving(null)}>Cancel</button></div>}
          </div>
          <IconButton icon="plus" label={`Place ${stamp.name}`} onClick={() => { activity.value = `Placement preview: ${stamp.name}.` }} />
          <ActionMenu label={`Actions for ${stamp.name}`} items={[{ label: 'Export', run: () => { activity.value = `Export preview: ${stamp.name}. No file written.` } }, { label: 'Rename', run: () => { setPreview(null); setRename(index) } }, { label: 'Delete', danger: true, run: () => { setPreview(null); setRemoving(index) } }]} />
        </div>)}{!stamps.length && <p className={styles.empty}>Save a canvas selection as a reusable arrangement.</p>}</div>
      </section>
      <p className={styles.footnote}>Place with + · Plant information with ›</p>
    </div>
    {showingDetail && <div className={styles.detail} data-detail><PlantDetailCard canonicalName={selected} /></div>}
    {preview && !showingDetail && <div className={styles.stampPreview} aria-hidden="true"><svg viewBox="0 0 180 140"><rect x="20" y="20" width="140" height="100" rx="30" fill="none" stroke="currentColor" />{[45, 90, 135].map(x => <g transform={`translate(${x} 65)`}><circle r="18" fill={specimens[0][3]} /><circle cy="32" r="8" fill={specimens[2][3]} /></g>)}</svg></div>}
  </section>
}

type Entry = { path: string; name: string; section: string; date: string }
const initialEntries: Entry[] = [
  { path: '/designs/orchard.canopi', name: 'Orchard notebook', section: 'Food forest', date: 'Today' },
  { path: '/designs/spring.canopi', name: 'Spring planting', section: 'Food forest', date: '10 Sep' },
  { path: '/designs/guilds.canopi', name: 'Orchard guild studies', section: 'Food forest', date: '8 Sep' },
  { path: '/designs/pollinators.canopi', name: 'Pollinator border', section: 'Home garden', date: '6 Sep' },
  { path: '/designs/kitchen.canopi', name: 'Kitchen garden', section: 'Home garden', date: '2 Sep' },
  { path: '/designs/site.canopi', name: 'First site survey', section: 'Archive', date: '24 Aug' },
]
export function NotebookProposal({ close, empty, long, alternative }: { close(): void; empty: boolean; long: boolean; alternative: boolean }) {
  const root = useRef<HTMLElement>(null)
  const [entries, setEntries] = useState(empty ? [] : initialEntries)
  const [sections, setSections] = useState(empty ? [] : ['Food forest', 'Home garden', 'Archive'])
  const [active, setActive] = useState(initialEntries[0]!.path)
  const [collapsed, setCollapsed] = useState(alternative ? ['Home garden', 'Archive'] : [])
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const drag = useRef<{ path?: string; section?: string } | null>(null)
  useLayoutEffect(() => { if (editing !== null) root.current?.querySelector<HTMLInputElement>('input')?.focus() }, [editing])
  function saveSection() {
    const next = name.trim()
    if (!next || (sections.includes(next) && next !== editing)) return
    if (editing === '') setSections([...sections, next])
    else { setSections(sections.map(s => s === editing ? next : s)); setEntries(entries.map(e => e.section === editing ? { ...e, section: next } : e)) }
    setEditing(null)
  }
  function drop(section: string, before?: string) {
    const source = drag.current
    if (source?.path) {
      const entry = entries.find(e => e.path === source.path)!
      const next = entries.filter(e => e.path !== source.path)
      const index = before ? next.findIndex(e => e.path === before) : next.length
      next.splice(index < 0 ? next.length : index, 0, { ...entry, section }); setEntries(next)
    } else if (source?.section && source.section !== section) {
      const next = sections.filter(s => s !== source.section); next.splice(next.indexOf(section), 0, source.section); setSections(next)
    }
    drag.current = null
  }
  return <section ref={root} className={styles.panel} aria-label="Design notebook proposal">
    <Header title="Design notebook" count={entries.length} close={close} />
    <div className={styles.notebookCommands}>
      <button className={styles.action} disabled={entries.some(e => e.path === initialEntries[0]!.path)} onClick={() => { if (!sections.length) setSections(['Food forest']); setEntries([...entries, { ...initialEntries[0]!, section: sections[0] ?? 'Food forest' }]) }}><Icon name="plus" />Add current design</button>
      <button className={styles.action} onClick={() => { setEditing(''); setName('') }}><Icon name="section" />New section</button>
    </div>
    {editing === '' && <div className={styles.editor}><input aria-label="New section name" placeholder="Section name" value={name} onInput={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') saveSection(); if (e.key === 'Escape') setEditing(null) }} /><button className={styles.action} disabled={!name.trim() || sections.includes(name.trim())} onClick={saveSection}>Add</button><button className={styles.iconButton} aria-label="Cancel new section" onClick={() => setEditing(null)}>×</button></div>}
    <div className={styles.scroll}>{sections.map(section => <section key={section} className={styles.notebookSection} aria-label={section} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); drop(section) }}>
      <div className={styles.notebookSectionHeading}>
        {editing === section ? <input aria-label="Section name" value={name} onInput={e => setName(e.currentTarget.value)} onBlur={saveSection} onKeyDown={e => { if (e.key === 'Enter') saveSection(); if (e.key === 'Escape') setEditing(null) }} /> : <button className={styles.sectionTitle} draggable title="Drag to reorder · double-click or F2 to rename" onDragStart={() => { drag.current = { section } }} onDragEnd={() => { drag.current = null }} onDblClick={() => { setEditing(section); setName(section) }} onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); setEditing(section); setName(section) } }} onClick={() => { if (alternative) setCollapsed(collapsed.includes(section) ? collapsed.filter(s => s !== section) : [...collapsed, section]) }} aria-expanded={alternative ? !collapsed.includes(section) : undefined}>{alternative && <span>{collapsed.includes(section) ? '›' : '⌄'}</span>}<h3>{section}</h3></button>}
        <span className={styles.count}>{entries.filter(e => e.section === section).length}</span>
        <IconButton icon="trash" label={`Remove section ${section}`} onClick={() => { setSections(sections.filter(s => s !== section)); setEntries(entries.map(e => e.section === section ? { ...e, section: 'Unsectioned' } : e)); if (entries.some(e => e.section === section) && !sections.includes('Unsectioned')) setSections([...sections.filter(s => s !== section), 'Unsectioned']) }} />
      </div>
      {(!alternative || !collapsed.includes(section)) && <>{entries.filter(e => e.section === section).map(entry => <div className={styles.notebookRow} data-active={entry.path === active} key={entry.path} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(section, entry.path) }}>
        <button className={styles.notebookEntry} draggable title={entry.path} aria-current={entry.path === active ? 'page' : undefined} onDragStart={() => { drag.current = { path: entry.path } }} onDragEnd={() => { drag.current = null }} onClick={() => { setActive(entry.path); activity.value = `Design switch preview: ${entry.name}. Sample canvas retained.` }} onKeyDown={e => { if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const i = entries.indexOf(entry); const next = [...entries]; next.splice(i, 1); next.splice(Math.max(0, i + (e.key === 'ArrowUp' ? -1 : 1)), 0, entry); setEntries(next) } }}>
          <Icon name="file" /><span><strong>{long ? entry.name + ' — planting study for the northern boundary' : entry.name}</strong><small>{entry.path === active ? 'Open now' : 'Saved'}<span> · {entry.date}</span></small></span>
        </button>
        <IconButton icon="trash" label={`Remove ${entry.name} from notebook`} onClick={() => setRemoving(entry.path)} />
        {removing === entry.path && <div className={styles.removeNotebook}><span>Remove from notebook? The design file stays.</span><button className={styles.action} onClick={() => { setEntries(entries.filter(e => e.path !== entry.path)); setRemoving(null) }}>Remove</button><button className={styles.action} onClick={() => setRemoving(null)}>Cancel</button></div>}
      </div>)}{!entries.some(e => e.section === section) && <p className={styles.empty}>Drag a design here.</p>}</>}
    </section>)}{!sections.length && <p className={styles.empty}>Keep saved designs together.<br />Add your current design to begin.</p>}</div>
    <p className={styles.footnote}>Drag designs to organize · Double-click a section to rename</p>
  </section>
}

export function ProposalSwitcher({ surface, variant, change }: { surface: string; variant: string; change(value: string): void }) {
  const alternative = surface === 'layers' || surface === 'notebook'
  const label = variant === 'A' ? 'A · Revised proposal' : alternative ? 'B · Alternative layout' : 'B · Current implementation'
  return <nav className={styles.switcher} aria-label="Proposal comparison"><span>Design proposal</span><button aria-label="Previous proposal" onClick={() => change(variant === 'A' ? 'B' : 'A')}>←</button><strong>{label}</strong><button aria-label="Next proposal" onClick={() => change(variant === 'A' ? 'B' : 'A')}>→</button><span>Sample data</span></nav>
}
