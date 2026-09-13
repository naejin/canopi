import { render } from 'preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { effect, useSignal } from '@preact/signals'
import '../src/styles/global.css'
import styles from './gallery.module.css'
import { SceneCanvasRuntime } from '../src/canvas/runtime/scene-runtime'
import { createSceneCanvasRuntimeHost } from '../src/canvas/runtime/host'
import { createAppCanvasRuntimeAppAdapter } from '../src/app/canvas-runtime/app-adapter'
import { setCurrentCanvasSession } from '../src/canvas/session'
import type { CanvasRuntimeHost } from '../src/canvas/runtime/runtime'
import { savedObjectStampWorkbench } from '../src/app/saved-object-stamps'
import { speciesCatalogWorkbench } from '../src/app/plant-browser'
import { WebCanvasToolbar } from '../src/web/WebCanvasToolbar'
import { InspectionLens } from '../src/components/canvas/InspectionLens'
import { SpeciesFocusChip } from '../src/components/canvas/SpeciesFocusChip'
import { ZoomControls } from '../src/components/canvas/ZoomControls'
import { DesktopSpeciesKeyPanel } from '../src/components/panels/DesktopSpeciesKeyPanel'
import { LayersPanel } from '../src/components/panels/LayersPanel'
import { DesignNotebookPanel } from '../src/components/panels/DesignNotebookPanel'
import { PlantDbPanel } from '../src/components/panels/PlantDbPanel'
import { LocationPanel } from '../src/components/panels/LocationPanel'
import { FavoritesPanel } from '../src/components/panels/FavoritesPanel'
import { BudgetPanel } from '../src/components/panels/BudgetPanel'
import { CalendarPanel } from '../src/components/panels/CalendarPanel'
import { ConsortiumPanel } from '../src/components/panels/ConsortiumPanel'
import { notebookWorkbench } from './notebook-fixture'
import { WebSpeciesCatalogPanel, WebSpeciesKeyPanel } from '../src/web/WebSpeciesCatalogPanel'
import { WebLayersPanel } from '../src/web/WebLayersPanel'
import {
  activePanel,
  navigateTo,
  sidePanel,
  sidePanelWidth,
} from '../src/app/shell/state'
import { plantColorMenuOpen } from '../src/canvas/plant-color-menu-state'
import { plantSymbolMenuOpen } from '../src/canvas/plant-symbol-menu-state'
import { plantDbStatus } from '../src/app/health/state'
import { theme, locale } from '../src/app/settings/state'
import '../src/i18n'
import { invalidateCssVarCache } from '../src/canvas/canvas2d-utils'
import { designFixture, specimens, species } from './fixtures'
import { designSessionStore } from '../src/app/document-session/store'
import { activity } from './memory-backend'
import { readPlanningViewState } from '../src/app/planning-view/state'
import { appCommandGraphPanelProjection } from '../src/commands/registry'
import { createBrowserShellCommandProjection } from '../src/web/browser-shell-commands'
import {
  WorkspaceComposition,
  type WorkspacePanelProjection,
  type WorkspaceSurfaces,
} from '../src/components/workspace/WorkspaceComposition'

if (!import.meta.env.DEV) throw new Error('Gallery cannot run in production.')
const params = new URLSearchParams(location.search)
const initial = params.get('surface') ?? 'color'
const fixtureState = params.get('state') ?? 'populated'
const requestedPanelWidth = Number(params.get('panelWidth'))
const edition = params.get('edition') === 'web' ? 'web' : 'desktop'
const surfaces = {
  workspace: 'Workspace',
  color: 'Plant color',
  symbol: 'Plant symbol',
  key: 'Species key',
  layers: 'Layers',
  calendar: 'Calendar',
  'calendar-expanded': 'Calendar expanded',
  budget: 'Budget',
  consortium: 'Consortium',
  favorites: 'Favorites',
  notebook: 'Design notebook',
  lens: 'Inspection lens',
}
const file = designFixture(fixtureState)
designSessionStore.replaceCurrentDesignState(file, null, file.name)
const planningView = readPlanningViewState()
planningView.calendarMonth.value = '2026-09-01'
planningView.calendarExpanded.value = initial === 'calendar-expanded'
if (Number.isFinite(requestedPanelWidth) && requestedPanelWidth >= 320) {
  sidePanelWidth.value = requestedPanelWidth
}
locale.value = (params.get('locale') ?? 'en') as typeof locale.value
theme.value = params.get('theme') === 'dark' ? 'dark' : 'light'
const disposeTheme = effect(() => { document.documentElement.dataset.theme = theme.value; invalidateCssVarCache() })
plantDbStatus.value = 'available'

function Gallery() {
  const canvas = useRef<HTMLDivElement>(null)
  const host = useRef<CanvasRuntimeHost | null>(null)
  const ready = useSignal(false)
  const surface = useSignal(initial)
  const GalleryCanvasSurface = useMemo(() => function GalleryCanvasSurface() {
    return (
      <div className={styles.canvasWorkspace}>
        {ready.value && <WebCanvasToolbar />}
        <div className={styles.canvasArea}>
          <div ref={canvas} className={styles.canvas} />
          {ready.value ? (
            <>
              <InspectionLens key={surface.value === 'lens' ? 'lens' : 'other'} canvasRef={canvas} />
              <SpeciesFocusChip />
              <ZoomControls />
            </>
          ) : null}
        </div>
      </div>
    )
  }, [])
  const workspaceSurfaces = useMemo<WorkspaceSurfaces>(() => edition === 'web'
    ? {
        primary: { canvas: GalleryCanvasSurface },
        side: {
          'species-key': WebSpeciesKeyPanel,
          layers: WebLayersPanel,
          calendar: CalendarPanel,
          budget: BudgetPanel,
          consortium: ConsortiumPanel,
          'plant-db': WebCatalogSurface,
          favorites: WebFavoritesSurface,
        },
      }
    : {
        primary: { canvas: GalleryCanvasSurface, location: LocationPanel },
        side: {
          'species-key': DesktopSpeciesKeyPanel,
          layers: GalleryLayersSurface,
          calendar: CalendarPanel,
          budget: BudgetPanel,
          consortium: ConsortiumPanel,
          'design-notebook': GalleryNotebookSurface,
          'plant-db': PlantDbPanel,
          favorites: FavoritesPanel,
        },
      }, [GalleryCanvasSurface])
  const panelProjection = galleryPanelProjection()

  const openSurface = (next: string) => {
    surface.value = next
    speciesCatalogWorkbench.closeSpeciesDetail()
    const requestedSidePanel = next === 'key'
      ? 'species-key'
      : next === 'layers'
        ? 'layers'
        : next === 'favorites'
          ? 'favorites'
          : next === 'notebook'
            ? 'design-notebook'
            : next === 'calendar' || next === 'calendar-expanded'
              ? 'calendar'
              : next === 'budget'
                ? 'budget'
                : next === 'consortium'
                  ? 'consortium'
                  : null
    navigateTo(requestedSidePanel ?? 'canvas')
    planningView.calendarExpanded.value = next === 'calendar-expanded'
    plantColorMenuOpen.value = next === 'color'
    plantSymbolMenuOpen.value = next === 'symbol'
    const url = new URL(location.href)
    url.searchParams.set('surface', next)
    history.replaceState(null, '', url)
  }

  useEffect(() => {
    let cancelled = false
    const container = canvas.current!
    const names = new Map(file.plants.map(plant => [plant.canonical_name, plant.common_name]))
    const runtime = createSceneCanvasRuntimeHost(new SceneCanvasRuntime({
      appAdapter: createAppCanvasRuntimeAppAdapter({
        presentationData: {
          plantLabels: { getLocaleSnapshot: () => names, ensureEntries: async () => false },
          speciesCache: {
            getCache: () => new Map(species.map(plant => [plant.canonical_name, { ...plant }])),
            ensureEntries: async () => false,
            getSuggestedPlantColor: () => '#E9D28B',
          },
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
      if (fixtureState === 'dense') for (let i = 0; i < 6; i++) runtime.surfaces.commands.viewport.zoomOut()
      runtime.surfaces.commands.sceneEdits.selectSameSpecies(specimens[0][0])
      resize.observe(container)
      ready.value = true
      openSurface(initial)
    }).catch(error => {
      if (cancelled) return
      activity.value = 'Canvas could not start. See the browser console.'
      console.error('Unable to start gallery canvas:', error)
    })
    return () => {
      cancelled = true
      resize.disconnect()
      setCurrentCanvasSession(null)
      runtime.destroy()
      host.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready.value || surface.value !== 'lens') return
    canvas.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')?.click()
  }, [ready.value, surface.value])

  return <div className={styles.gallery} data-gallery-ready={ready.value}>
    <header className={styles.title}><strong>canopi</strong><span>Orchard notebook</span><span>UI gallery</span>
      <button onClick={() => { theme.value = theme.value === 'light' ? 'dark' : 'light' }}>{theme.value === 'light' ? 'Dark' : 'Light'} theme</button>
    </header>
    <nav className={styles.review} aria-label="Review surfaces">
      {Object.entries(surfaces)
        .filter(([key]) => edition === 'desktop' || key !== 'notebook')
        .map(([key, label]) => <button data-panel={key === 'key' ? 'species-key' : key === 'notebook' ? 'design-notebook' : key} aria-pressed={surface.value === key} onClick={() => openSurface(key)}>{label}</button>)}
      <span>Edition:</span>
      {(['desktop', 'web'] as const).map((nextEdition) => <a aria-current={edition === nextEdition ? 'page' : undefined} href={editionUrl(nextEdition)}>{nextEdition}</a>)}
      <span>State:</span>{['populated', 'empty', 'mixed', 'long', 'located', 'dense'].map(state => <a aria-current={fixtureState === state ? 'page' : undefined}
        href={`?surface=${surface.value}&state=${state}&theme=${theme.value}&locale=${locale.value}${edition === 'web' ? '&edition=web' : ''}`}>{state}</a>)}
    </nav>
    {surface.value === 'workspace' ? <GalleryWorkspaceCommands panelProjection={panelProjection} /> : null}
    <main className={styles.workspace} data-edition={edition}>
      <WorkspaceComposition
        panelProjection={panelProjection}
        surfaces={workspaceSurfaces}
        responsive={edition === 'web'}
      />
    </main>
    <footer className={styles.status} role="status">{activity.value}</footer>
  </div>
}

function galleryPanelProjection(): WorkspacePanelProjection {
  if (edition === 'desktop') return appCommandGraphPanelProjection.value
  return createBrowserShellCommandProjection({
    currentPanel: activePanel.value,
    currentSidePanel: sidePanel.value,
    downloadCanopiEnabled: true,
    templatesEnabled: false,
    capabilities: {
      newDesign: () => { activity.value = 'New Design stays in memory.' },
      openCanopi: () => { activity.value = 'Opened the sample Design in memory.' },
      downloadCanopi: () => { activity.value = 'Download completed in memory.' },
      navigate: navigateTo,
      toggleTheme: () => { theme.value = theme.value === 'light' ? 'dark' : 'light' },
    },
  }).panelBar
}

function GalleryWorkspaceCommands({ panelProjection }: { readonly panelProjection: WorkspacePanelProjection }) {
  return (
    <nav className={styles.workspaceCommands} aria-label="Workspace panel commands">
      {[...panelProjection.primary, ...panelProjection.design, ...panelProjection.side].map((command) => command.panel ? (
        <button type="button" data-gallery-workspace-panel={command.panel} onClick={() => navigateTo(command.panel!)}>
          {command.panel}
        </button>
      ) : null)}
    </nav>
  )
}

function GalleryLayersSurface() {
  return <LayersPanel onLocation={() => {
    designSessionStore.replaceCurrentDesignSnapshot({ ...file, location: { lat: 48.85, lon: 2.35, altitude_m: 35 } })
    activity.value = 'Sample location set in memory.'
  }} />
}

function GalleryNotebookSurface() {
  return <DesignNotebookPanel workbench={notebookWorkbench} />
}

function WebCatalogSurface() {
  return <WebSpeciesCatalogPanel mode="catalog" />
}

function WebFavoritesSurface() {
  return <WebSpeciesCatalogPanel mode="favorites" />
}

function editionUrl(nextEdition: 'desktop' | 'web'): string {
  const url = new URL(location.href)
  if (nextEdition === 'web') url.searchParams.set('edition', 'web')
  else url.searchParams.delete('edition')
  return `${url.pathname}${url.search}`
}

const root = document.getElementById('app')!
render(<Gallery />, root)
if (import.meta.hot) import.meta.hot.dispose(() => { render(null, root); disposeTheme() })
