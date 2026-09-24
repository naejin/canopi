import { useMemo } from 'preact/hooks'
import type { BrowserDesignSessionController } from './browser-design-session'
import { WebCanvasWorkspace } from './WebCanvasWorkspace'
import { WebLayersPanel } from './WebLayersPanel'
import { WebLocalRasterPanel } from './WebLocalRasterPanel'
import { WebLocationPanel } from './WebLocationPanel'
import { t } from '../i18n'
import { WebSpeciesCatalogPanel, WebSpeciesKeyPanel } from './WebSpeciesCatalogPanel'
import { BudgetPanel } from '../components/panels/BudgetPanel'
import { CalendarPanel } from '../components/panels/CalendarPanel'
import { ConsortiumPanel } from '../components/panels/ConsortiumPanel'
import {
  WorkspaceComposition,
  type WorkspacePanelProjection,
  type WorkspaceSurfaces,
} from '../components/workspace/WorkspaceComposition'
import { lazy } from 'preact/compat'

const WorldMapPanel = lazy(async () => {
  const module = await import('../components/panels/WorldMapPanel')
  return { default: module.WorldMapPanel }
})

export function WebWorkspace({
  controller,
  panelProjection,
  templatesEnabled,
}: {
  readonly controller: BrowserDesignSessionController
  readonly panelProjection: WorkspacePanelProjection
  readonly templatesEnabled: boolean
}) {
  const surfaces = useMemo<WorkspaceSurfaces>(() => {
    const Canvas = () => <WebCanvasWorkspace controller={controller} />
    // Web preserves raster references but renders and processes no local
    // assets, so the Data Library surface states that instead of offering dead controls.
    const WebData = () => <WebLocalRasterPanel title={t('canvas.lidar.library.title')} />
    return {
      primary: {
        canvas: Canvas,
        location: WebLocationPanel,
        ...(templatesEnabled ? { templates: WorldMapPanel } : {}),
      },
      side: {
        'species-key': WebSpeciesKeyPanel,
        data: WebData,
        layers: WebLayersPanel,
        calendar: CalendarPanel,
        budget: BudgetPanel,
        consortium: ConsortiumPanel,
        'plant-db': WebCatalog,
        favorites: WebFavorites,
      },
    }
  }, [controller, templatesEnabled])

  return (
    <WorkspaceComposition
      panelProjection={panelProjection}
      surfaces={surfaces}
      responsive
    />
  )
}

function WebCatalog() {
  return <WebSpeciesCatalogPanel mode="catalog" />
}

function WebFavorites() {
  return <WebSpeciesCatalogPanel mode="favorites" />
}
