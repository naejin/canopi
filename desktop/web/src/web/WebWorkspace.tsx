import { useMemo } from 'preact/hooks'
import type { BrowserDesignSessionController } from './browser-design-session'
import { WebCanvasWorkspace } from './WebCanvasWorkspace'
import { WebLayersPanel } from './WebLayersPanel'
import { WebSpeciesCatalogPanel, WebSpeciesKeyPanel } from './WebSpeciesCatalogPanel'
import { BudgetPanel } from '../components/panels/BudgetPanel'
import { CalendarPanel } from '../components/panels/CalendarPanel'
import { ConsortiumPanel } from '../components/panels/ConsortiumPanel'
import { StoriesPanel } from '../components/panels/StoriesPanel'
import {
  WorkspaceComposition,
  type WorkspacePanelProjection,
  type WorkspaceSurfaces,
} from '../components/workspace/WorkspaceComposition'
import { lazy } from 'preact/compat'
import type { PanelRailCommand } from '../components/shared/PanelRail'

const WorldMapPanel = lazy(async () => {
  const module = await import('../components/panels/WorldMapPanel')
  return { default: module.WorldMapPanel }
})

export function WebWorkspace({
  controller,
  panelProjection,
  phoneTabs,
  templatesEnabled,
}: {
  readonly controller: BrowserDesignSessionController
  readonly panelProjection: WorkspacePanelProjection
  /** The side panel commands, as the phone sheet's tabs. */
  readonly phoneTabs: readonly PanelRailCommand[]
  readonly templatesEnabled: boolean
}) {
  const surfaces = useMemo<WorkspaceSurfaces>(() => {
    const Canvas = () => <WebCanvasWorkspace controller={controller} />
    return {
      primary: {
        canvas: Canvas,
        ...(templatesEnabled ? { templates: WorldMapPanel } : {}),
      },
      side: {
        'species-key': WebSpeciesKeyPanel,
        layers: WebLayersPanel,
        calendar: CalendarPanel,
        budget: BudgetPanel,
        consortium: ConsortiumPanel,
        stories: StoriesPanel,
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
      phoneTabs={phoneTabs}
    />
  )
}

function WebCatalog() {
  return <WebSpeciesCatalogPanel mode="catalog" />
}

function WebFavorites() {
  return <WebSpeciesCatalogPanel mode="favorites" />
}
