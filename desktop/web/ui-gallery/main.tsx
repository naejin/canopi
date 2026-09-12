import { render } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { effect, useSignal } from '@preact/signals'
import '../src/styles/global.css'
import styles from './gallery.module.css'
import { SceneCanvasRuntime } from '../src/canvas/runtime/scene-runtime'
import { createSceneCanvasRuntimeHost } from '../src/canvas/runtime/host'
import { createAppCanvasRuntimeAppAdapter } from '../src/app/canvas-runtime/app-adapter'
import { setCurrentCanvasSession, currentCanvasViewportCommandSurface } from '../src/canvas/session'
import type { CanvasRuntimeHost } from '../src/canvas/runtime/runtime'
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import { speciesCatalogWorkbench } from '../src/app/plant-browser'
import { WebCanvasToolbar } from '../src/web/WebCanvasToolbar'
import { InspectionLens } from '../src/components/canvas/InspectionLens'
import { InspectionLensProposal } from './inspection-proposal'
import { SpeciesFocusChip } from '../src/components/canvas/SpeciesFocusChip'
import { ZoomControls } from '../src/components/canvas/ZoomControls'
import { DesktopSpeciesKeyPanel } from '../src/components/panels/DesktopSpeciesKeyPanel'
import { LayersPanel } from '../src/components/panels/LayersPanel'
import { FavoritesPanel } from '../src/components/panels/FavoritesPanel'
import { SidePanelDock } from '../src/components/shared/SidePanelDock'
import { sidePanel } from '../src/app/shell/state'
import { plantColorMenuOpen } from '../src/canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../src/canvas/plant-symbol-menu-state'
import { plantDbStatus } from '../src/app/health/state'
import { theme, locale } from '../src/app/settings/state'
import '../src/i18n'
import { invalidateCssVarCache } from '../src/canvas/canvas2d-utils'
import { designFixture, specimens, species } from './fixtures'
import { designSessionStore } from '../src/app/document-session/store'
import { activity } from './memory-backend'
import { setCanvasLayerPresentationActiveLayer } from '../src/app/canvas-layer-presentation/presentation'
import { LayersProposal, SymbolProposal, FavoritesProposal, NotebookProposal, ProposalSwitcher } from './review-proposals'

if (!import.meta.env.DEV) throw new Error('Gallery cannot run in production.')
const params = new URLSearchParams(location.search)
const proposals = params.get('proposal') === '1'
const compare = proposals && params.get('compare') === '1'
const initial = params.get('surface') ?? (proposals ? 'layers' : 'color')
const fixtureState = params.get('state') ?? 'populated'
const surfaces: Record<string, string> = proposals ? { layers: 'Layers', symbol: 'Plant symbol', notebook: 'Design notebook', favorites: 'Favorites', lens: 'Inspection lens' } : { color: 'Plant color', symbol: 'Plant symbol', key: 'Species key', layers: 'Layers', favorites: 'Favorites', lens: 'Inspection lens' }
const file = designFixture(fixtureState)
designSessionStore.replaceCurrentDesignState(file, null, file.name)
locale.value = (params.get('locale') ?? 'en') as typeof locale.value
theme.value = params.get('theme') === 'dark' ? 'dark' : 'light'
const disposeTheme = effect(() => { document.documentElement.dataset.theme = theme.value; invalidateCssVarCache() })
plantDbStatus.value = 'available'

function Gallery() {
  const canvas = useRef<HTMLDivElement>(null)
  const host = useRef<CanvasRuntimeHost | null>(null)
  const ready = useSignal(false)
  const surface = useSignal(initial)
  const variant = useSignal(compare && params.get('variant') === 'B' ? 'B' : 'A')
  const symbolVisible = useSignal(true)
  const openSurface = (next: string) => {
    surface.value = next
    symbolVisible.value = true
    speciesCatalogWorkbench.closeSpeciesDetail()
    sidePanel.value = next === 'key' ? 'species-key' : next === 'layers' ? 'layers' : next === 'favorites' ? 'favorites' : next === 'notebook' ? 'design-notebook' : null
    plantColorMenuOpen.value = next === 'color'
    plantSymbolMenuOpen.value = next === 'symbol' && (!proposals || variant.value === 'B')
    const url = new URL(location.href); url.searchParams.set('surface', next); history.replaceState(null, '', url)
  }
  const closeProposal = () => {
    sidePanel.value = null
    symbolVisible.value = false
    Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]')).find(button => button.dataset.panel === surface.value)?.focus()
  }
  const changeVariant = (next: string) => {
    variant.value = next
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState(null, '', url)
    openSurface(surface.value)
  }
  useEffect(() => {
    if (!compare) return
    const key = (event: KeyboardEvent) => {
      if (surface.value === 'lens' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof Element) || event.target.closest('input, textarea, button, [contenteditable], [role=separator]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeVariant(variant.value === 'A' ? 'B' : 'A') }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    let cancelled = false
    const container = canvas.current!
    const names = new Map(file.plants.map(plant => [plant.canonical_name, plant.common_name]))
    const runtime = createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter({
        presentationData: {
          plantLabels: { getLocaleSnapshot: () => names, ensureEntries: async () => false },
          speciesCache: { getCache: () => new Map(species.map(plant => [plant.canonical_name, { ...plant }])),
            ensureEntries: async () => false, getSuggestedPlantColor: () => '#E9D28B' },
        },
        savedObjectStamps: { saveCurrentSelection: capture => savedObjectStampWorkbench.saveSelection(capture) },
      }),
    }))
    host.current = runtime
    const resize = new ResizeObserver(() => runtime.surfaces.documents.resize(container.clientWidth, container.clientHeight))
    void runtime.init(container).then(() => {
      if (cancelled) return
      setCurrentCanvasSession(runtime.surfaces)
      runtime.surfaces.documents.loadDocument(file)
      runtime.surfaces.documents.resize(container.clientWidth, container.clientHeight)
      runtime.surfaces.documents.zoomToFit()
      if (proposals && fixtureState === 'dense') {
        for (let step = 0; step < 6; step++) currentCanvasViewportCommandSurface.value?.zoomOut()
      }
      runtime.surfaces.commands.sceneEdits.selectSameSpecies(specimens[0][0])
      if (proposals) setCanvasLayerPresentationActiveLayer('plants')
      resize.observe(container)
      ready.value = true
      openSurface(initial)
    }).catch(error => {
      if (cancelled) return
      activity.value = 'Canvas could not start. See the browser console.'
      console.error('Unable to start gallery canvas:', error)
    })
    return () => { cancelled = true; resize.disconnect(); setCurrentCanvasSession(null); runtime.destroy(); host.current = null }
  }, [])
  useEffect(() => {
    if (proposals || !ready.value || surface.value !== 'lens') return
    canvas.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
  }, [ready.value, surface.value])
  return <div className={styles.gallery} data-gallery-ready={ready.value}>
    <header className={styles.title}><strong>canopi</strong><span>Orchard notebook</span><span>{proposals ? 'Final proposal · review only' : 'UI gallery'}</span>
      <button onClick={() => { theme.value = theme.value === 'light' ? 'dark' : 'light' }}>{theme.value === 'light' ? 'Dark' : 'Light'} theme</button>
    </header>
    <nav className={styles.review} aria-label="Review surfaces">
      {Object.entries(surfaces).map(([key, label]) => <button data-panel={key === 'key' ? 'species-key' : key} aria-pressed={surface.value === key} onClick={() => openSurface(key)}>{label}</button>)}
      <span>State:</span>{['populated', ...(proposals ? ['dense'] : []), 'empty', 'mixed', 'long', 'located'].map(state => <a aria-current={fixtureState === state ? 'page' : undefined}
        href={`?surface=${surface.value}&state=${state}&theme=${theme.value}&locale=${locale.value}${proposals ? `&proposal=1${compare ? `&compare=1&variant=${variant.value}` : ''}` : ''}`}>{state}</a>)}
    </nav>
    <main className={styles.workspace}>
      {ready.value && <WebCanvasToolbar />}
      <div className={styles.canvasArea}>
        <div ref={canvas} className={styles.canvas} />
        {ready.value && <>{proposals ? <InspectionLensProposal key={surface.value === 'lens' ? 'lens' : 'other'} canvasRef={canvas} initialOpen={surface.value === 'lens'} /> : <InspectionLens key={surface.value === 'lens' ? 'lens' : 'other'} canvasRef={canvas} />}<SpeciesFocusChip /><ZoomControls /></>}
      </div>
      {ready.value && proposals && surface.value === 'symbol' && variant.value === 'A' && symbolVisible.value && <SymbolProposal close={closeProposal} />}
      {ready.value && sidePanel.value && <SidePanelDock>
        {proposals && sidePanel.value === 'layers' ? <LayersProposal alternative={variant.value === 'B'} close={closeProposal} locate={() => {
          designSessionStore.replaceCurrentDesignSnapshot({ ...file, location: { lat: 48.85, lon: 2.35, altitude_m: 35 } })
          activity.value = 'Sample location set in memory.'
        }} /> : proposals && sidePanel.value === 'design-notebook' ? <NotebookProposal key={variant.value} alternative={variant.value === 'B'} empty={fixtureState === 'empty'} long={fixtureState === 'long'} close={closeProposal} />
        : proposals && sidePanel.value === 'favorites' && variant.value === 'A' ? <FavoritesProposal empty={fixtureState === 'empty'} long={fixtureState === 'long'} close={closeProposal} />
        : sidePanel.value === 'species-key' ? <DesktopSpeciesKeyPanel /> : sidePanel.value === 'layers' ? <LayersPanel onLocation={() => {
          designSessionStore.replaceCurrentDesignSnapshot({ ...file, location: { lat: 48.85, lon: 2.35, altitude_m: 35 } })
          activity.value = 'Sample location set in memory.'
        }} /> : <FavoritesPanel />}
      </SidePanelDock>}
    </main>
    {compare && surface.value !== 'lens' && <ProposalSwitcher surface={surface.value} variant={variant.value} change={changeVariant} />}
    <footer className={styles.status} role="status">{activity.value}</footer>
  </div>
}
const root = document.getElementById('app')!
render(<Gallery />, root)
if (import.meta.hot) import.meta.hot.dispose(() => { render(null, root); disposeTheme() })
