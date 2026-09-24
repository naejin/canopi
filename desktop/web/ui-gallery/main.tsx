import { render } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { effect, signal } from '@preact/signals'
import '../src/styles/global.css'
import styles from './gallery.module.css'
import { speciesCatalogWorkbench } from '../src/app/plant-browser'
import { DesktopSpeciesKeyPanel } from '../src/components/panels/DesktopSpeciesKeyPanel'
import { LayersPanel } from '../src/components/panels/LayersPanel'
import { DesignNotebookPanel } from '../src/components/panels/DesignNotebookPanel'
import { PlantDbPanel } from '../src/components/panels/PlantDbPanel'
import { LocationPanel } from '../src/components/panels/LocationPanel'
import { WebLocationPanel } from '../src/web/WebLocationPanel'
import { WebLocalRasterPanel } from '../src/web/WebLocalRasterPanel'
import { DataLibraryPanel } from '../src/components/panels/lidar/DataLibraryPanel'
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
import { t } from '../src/i18n'
import { invalidateCssVarCache } from '../src/canvas/canvas2d-utils'
import { designFixture } from './fixtures'
import { designSessionStore } from '../src/app/document-session/store'
import { activity } from './memory-backend'
import { lidarMapViewBounds } from '../src/app/lidar/camera-request'
import { GalleryCanvasSurface } from './GalleryCanvasSurface'
import { readPlanningViewState } from '../src/app/planning-view/state'
import { appCommandGraphPanelProjection } from '../src/commands/registry'
import { createBrowserShellCommandProjection } from '../src/web/browser-shell-commands'
import {
  WorkspaceComposition,
  type WorkspacePanelProjection,
  type WorkspaceSurfaces,
} from '../src/components/workspace/WorkspaceComposition'
import {
  GALLERY_SURFACES,
  parseGallerySurface,
  selectGalleryPanel,
  type GallerySurface,
} from './surface-routing'

if (!import.meta.env.DEV) throw new Error('Gallery cannot run in production.')
const params = new URLSearchParams(location.search)
const lidarPrototypeEnabled = import.meta.env.DEV && params.get('prototype') === 'lidar' && params.get('edition') !== 'web'
const LidarCanvasPrototype = lazy(() => import('./lidar-prototype/LidarPrototype').then(module => ({ default: module.LidarCanvasPrototype })))
const LidarPanelPrototype = lazy(() => import('./lidar-prototype/LidarPrototype').then(module => ({ default: module.LidarPanelPrototype })))
const fixtureState = params.get('state') ?? 'populated'
const requestedPanelWidth = Number(params.get('panelWidth'))
const edition = params.get('edition') === 'web' ? 'web' : 'desktop'
const initial = parseGallerySurface(params.get('surface'))
const selectedSurface = signal<GallerySurface>(initial)
const galleryCanvasReady = signal(false)
const file = designFixture(fixtureState)
designSessionStore.replaceCurrentDesignState(file, null, file.name)
lidarMapViewBounds.value = fixtureState === 'located'
  ? [0.02, 48.21, 0.05, 48.23]
  : null
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

const workspaceSurfaces: WorkspaceSurfaces = edition === 'web'
  ? {
      primary: { canvas: GalleryCanvasWorkspace, location: WebLocationPanel },
      side: {
        data: () => <WebLocalRasterPanel title={t('canvas.lidar.library.title')} />,
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
      primary: { canvas: GalleryCanvasWorkspace, location: LocationPanel },
      side: {
        data: DataLibraryPanel,
        'species-key': DesktopSpeciesKeyPanel,
        layers: GalleryLayersSurface,
        calendar: CalendarPanel,
        budget: BudgetPanel,
        consortium: ConsortiumPanel,
        'design-notebook': GalleryNotebookSurface,
        'plant-db': PlantDbPanel,
        favorites: FavoritesPanel,
      },
    }

function Gallery() {
  const panelProjection = galleryPanelProjection()

  return <div className={styles.gallery} data-gallery-ready={galleryCanvasReady.value}>
    <header className={styles.title}><strong>canopi</strong><span>Orchard notebook</span><span>UI gallery</span>
      <button onClick={() => { theme.value = theme.value === 'light' ? 'dark' : 'light' }}>{theme.value === 'light' ? 'Dark' : 'Light'} theme</button>
    </header>
    <nav className={styles.review} aria-label="Review surfaces">
      <a href="/library-reference.html">New Data Library reference ↗</a>
      {Object.entries(GALLERY_SURFACES)
        .filter(([key]) => edition === 'desktop' || key !== 'notebook')
        .map(([key, label]) => <button data-panel={key === 'key' ? 'species-key' : key === 'notebook' ? 'design-notebook' : key} aria-pressed={selectedSurface.value === key} onClick={() => selectGallerySurface(key as GallerySurface)}>{label}</button>)}
      <span>Edition:</span>
      {(['desktop', 'web'] as const).map((nextEdition) => <a aria-current={edition === nextEdition ? 'page' : undefined} href={editionUrl(nextEdition)}>{nextEdition}</a>)}
      <span>State:</span>{['populated', 'empty', 'mixed', 'long', 'located', 'dense', 'overview', 'overview-confirmed', 'max-zoom', 'lidar-progress'].map(state => <a aria-current={fixtureState === state ? 'page' : undefined}
        href={`?surface=${selectedSurface.value}&state=${state}&theme=${theme.value}&locale=${locale.value}${edition === 'web' ? '&edition=web' : ''}`}>{state}</a>)}
    </nav>
    {selectedSurface.value === 'workspace' ? <GalleryWorkspaceCommands panelProjection={panelProjection} /> : null}
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

function GalleryCanvasWorkspace() {
  if (lidarPrototypeEnabled) return <Suspense fallback={null}><LidarCanvasPrototype /></Suspense>
  return (
    <GalleryCanvasSurface
      activeSurface={selectedSurface}
      design={file}
      dense={fixtureState === 'dense'}
      cameraState={fixtureState === 'overview' || fixtureState === 'overview-confirmed'
        ? 'overview'
        : fixtureState === 'max-zoom' ? 'maximum' : 'site'}
      onReadyChange={setGalleryCanvasReady}
    />
  )
}

function setGalleryCanvasReady(ready: boolean): void {
  galleryCanvasReady.value = ready
}

function selectGallerySurface(next: GallerySurface): void {
  selectedSurface.value = next
  speciesCatalogWorkbench.closeSpeciesDetail()
  selectGalleryPanel(next)
  planningView.calendarExpanded.value = next === 'calendar-expanded'
  plantColorMenuOpen.value = next === 'color'
  plantSymbolMenuOpen.value = next === 'symbol'
  const url = new URL(location.href)
  url.searchParams.set('surface', next)
  history.replaceState(null, '', url)
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
  if (lidarPrototypeEnabled) return <Suspense fallback={null}><LidarPanelPrototype /></Suspense>
  return <LayersPanel onLocation={() => {
    designSessionStore.replaceCurrentDesignSnapshot({
      ...file,
      spatial_frame: {
        anchor_longitude_deg: 0.033854,
        anchor_latitude_deg: 48.220272,
        north_bearing_deg: 0,
        placement_status: 'confirmed',
        location_metadata: { altitude_m: 118 },
      },
    })
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

selectGallerySurface(initial)
const root = document.getElementById('app')!
render(<Gallery />, root)
if (import.meta.hot) import.meta.hot.dispose(() => { render(null, root); disposeTheme() })
