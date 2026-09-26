import { render } from 'preact'
import { effect, signal } from '@preact/signals'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../src/styles/global.css'
import styles from './gallery.module.css'
import { speciesCatalogWorkbench } from '../src/app/plant-browser'
import { DesktopSpeciesKeyPanel } from '../src/components/panels/DesktopSpeciesKeyPanel'
import { LayersPanel } from '../src/components/panels/LayersPanel'
import { DesignNotebookPanel } from '../src/components/panels/DesignNotebookPanel'
import { PlantDbPanel } from '../src/components/panels/PlantDbPanel'
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
import { designFixture } from './fixtures'
import { designSessionStore } from '../src/app/document-session/store'
import { activity } from './memory-backend'
import { lidarMapViewBounds } from '../src/app/lidar/camera-request'
import { GalleryCanvasSurface } from './GalleryCanvasSurface'
import { readPlanningViewState } from '../src/app/planning-view/state'
import { appCommandGraphChromeProjection, appCommandGraphPanelProjection } from '../src/commands/registry'
import {
  createBrowserShellCapabilities,
  createBrowserShellCatalog,
  createBrowserShellCommandProjection,
} from '../src/web/browser-shell-commands'
import { workspaceCanvasCommandProjection } from '../src/app/workspace-commands/canvas-actions'
import { keyboardShortcutsDialogOpen } from '../src/app/shell/dialogs'
import { TitleBar } from '../src/components/shared/TitleBar'
import { DesktopPanelRail } from '../src/components/panels/DesktopPanelRail'
import { SettingsDialog } from '../src/components/shared/SettingsDialog'
import { KeyboardShortcutsDialog } from '../src/components/shared/KeyboardShortcutsDialog'
import { WelcomeScreen } from '../src/components/shared/WelcomeScreen'
import { PlaceSearchField } from '../src/components/canvas/PlaceSearch'
import { BrowserAppShell } from '../src/web/BrowserAppShell'
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
const fixtureState = params.get('state') ?? 'populated'
const requestedPanelWidth = Number(params.get('panelWidth'))
const edition = params.get('edition') === 'web' ? 'web' : 'desktop'
const initial = parseGallerySurface(params.get('surface'))
const selectedSurface = signal<GallerySurface>(initial)
const galleryCanvasReady = signal(false)
const file = designFixture(fixtureState)
if (initial !== 'start') designSessionStore.replaceCurrentDesignState(file, null, file.name)
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
const disposeTheme = effect(() => { document.documentElement.dataset.theme = theme.value })
plantDbStatus.value = 'available'

const workspaceSurfaces: WorkspaceSurfaces = edition === 'web'
  ? {
      primary: { canvas: GalleryCanvasWorkspace },
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
      primary: { canvas: GalleryCanvasWorkspace },
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
      {Object.entries(GALLERY_SURFACES)
        .filter(([key]) => edition === 'desktop' || key !== 'notebook')
        .map(([key, label]) => <button data-panel={key === 'key' ? 'species-key' : key === 'notebook' ? 'design-notebook' : key} aria-pressed={selectedSurface.value === key} onClick={() => selectGallerySurface(key as GallerySurface)}>{label}</button>)}
      <span>Edition:</span>
      {(['desktop', 'web'] as const).map((nextEdition) => <a aria-current={edition === nextEdition ? 'page' : undefined} href={editionUrl(nextEdition)}>{nextEdition}</a>)}
      <span>State:</span>{['populated', 'empty', 'mixed', 'long', 'located', 'dense', 'overview', 'max-zoom', 'lidar-progress'].map(state => <a aria-current={fixtureState === state ? 'page' : undefined}
        href={`?surface=${selectedSurface.value}&state=${state}&theme=${theme.value}&locale=${locale.value}${edition === 'web' ? '&edition=web' : ''}`}>{state}</a>)}
    </nav>
    {selectedSurface.value === 'workspace' && edition === 'desktop' ? <GalleryWorkspaceCommands panelProjection={panelProjection} /> : null}
    <main className={styles.workspace} data-edition={edition}>
      {selectedSurface.value === 'start' ? <GalleryStart /> : edition === 'web' ? (
        <GalleryWebFrame>
          <WorkspaceComposition panelProjection={panelProjection} surfaces={workspaceSurfaces} responsive />
        </GalleryWebFrame>
      ) : (
        <>
          <WorkspaceComposition panelProjection={panelProjection} surfaces={workspaceSurfaces} />
          <GalleryDesktopFrame />
        </>
      )}
    </main>
    <footer className={styles.status} role="status">{activity.value}</footer>
  </div>
}

function GalleryCanvasWorkspace() {
  return (
    <GalleryCanvasSurface
      activeSurface={selectedSurface}
      design={file}
      dense={fixtureState === 'dense'}
      cameraState={fixtureState === 'overview'
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

const galleryWebCatalog = createBrowserShellCatalog(createBrowserShellCapabilities({
  newDesign: async () => { activity.value = 'New Design stays in memory.' },
  openCanopi: async () => { activity.value = 'Opened the sample Design in memory.'; return true },
  downloadCanopi: async () => { activity.value = 'Download completed in memory.' },
  revertDesign: async () => { activity.value = 'Reverted the sample Design in memory.' },
}, (error) => console.error(error), {
  importGeoJson: async () => { activity.value = 'GeoJSON import stays in memory.'; return { status: 'cancelled' as const } },
  exportGeoJson: async () => { activity.value = 'GeoJSON export completed in memory.'; return { status: 'cancelled' as const } },
}), { templatesEnabled: false, canvasReady: () => true })

function galleryWebProjection() {
  return createBrowserShellCommandProjection({
    catalog: galleryWebCatalog,
    state: { hasDesign: true, revertAvailable: false, activePanel: activePanel.value, sidePanel: sidePanel.value },
    canvas: workspaceCanvasCommandProjection.value,
  })
}

function galleryPanelProjection(): WorkspacePanelProjection {
  if (edition === 'desktop') return appCommandGraphPanelProjection.value
  return galleryWebProjection().panelBar
}

/** The Desktop frame over the gallery workspace: the production title bar, rail and dialogs. */
function GalleryDesktopFrame() {
  if (selectedSurface.value !== 'workspace' && selectedSurface.value !== 'start') return null
  return <>
    <TitleBar />
    {selectedSurface.value === 'workspace' && <DesktopPanelRail />}
    <SettingsDialog />
    {keyboardShortcutsDialogOpen.value && <KeyboardShortcutsDialog menus={appCommandGraphChromeProjection.value.menus} />}
  </>
}

function GalleryWebFrame({ children }: { readonly children: preact.ComponentChildren }) {
  const projection = galleryWebProjection()
  return <>
    <BrowserAppShell
      commandProjection={projection}
      designIdentity={{ name: file.name, saveStatus: 'draft', saveFailureReason: null }}
      search={<PlaceSearchField compact />}
    >
      {children}
    </BrowserAppShell>
    <SettingsDialog />
    {keyboardShortcutsDialogOpen.value && <KeyboardShortcutsDialog menus={projection.workspaceMenus} />}
  </>
}

function GalleryStart() {
  return <>
    <WelcomeScreen />
    <GalleryDesktopFrame />
  </>
}

function GalleryWorkspaceCommands({ panelProjection }: { readonly panelProjection: WorkspacePanelProjection }) {
  return (
    <nav className={styles.workspaceCommands} aria-label="Workspace panel commands">
      {[...panelProjection.primary, ...panelProjection.design, ...panelProjection.planning].map((command) => command.panel ? (
        <button type="button" data-gallery-workspace-panel={command.panel} onClick={() => navigateTo(command.panel!)}>
          {command.panel}
        </button>
      ) : null)}
    </nav>
  )
}

function GalleryLayersSurface() {
  return <LayersPanel />
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
