import { lazy } from 'preact/compat'
import { appCommandGraphPanelProjection } from '../../commands/registry'
import { CanvasPanel } from '../panels/CanvasPanel'
import {
  WorkspaceComposition,
  type WorkspaceSurfaces,
} from './WorkspaceComposition'

const PlantDbPanel = lazy(async () => {
  const module = await import('../panels/PlantDbPanel')
  return { default: module.PlantDbPanel }
})

const FavoritesPanel = lazy(async () => {
  const module = await import('../panels/FavoritesPanel')
  return { default: module.FavoritesPanel }
})

const DesignNotebookPanel = lazy(async () => {
  const module = await import('../panels/DesignNotebookPanel')
  return { default: module.DesignNotebookPanel }
})

const SpeciesKeyPanel = lazy(async () => {
  const module = await import('../panels/DesktopSpeciesKeyPanel')
  return { default: module.DesktopSpeciesKeyPanel }
})

const LayersPanel = lazy(async () => {
  const module = await import('../panels/LayersPanel')
  return { default: module.LayersPanel }
})

const DataLibraryPanel = lazy(async () => {
  const module = await import('../panels/lidar/DataLibraryPanel')
  return { default: module.DataLibraryPanel }
})

const BudgetPanel = lazy(async () => {
  const module = await import('../panels/BudgetPanel')
  return { default: module.BudgetPanel }
})

const CalendarPanel = lazy(async () => {
  const module = await import('../panels/CalendarPanel')
  return { default: module.CalendarPanel }
})

const ConsortiumPanel = lazy(async () => {
  const module = await import('../panels/ConsortiumPanel')
  return { default: module.ConsortiumPanel }
})

function DesignNotebookSurface() {
  return <DesignNotebookPanel />
}

function LayersSurface() {
  return <LayersPanel />
}

function DataSurface() {
  return <DataLibraryPanel />
}

const DESKTOP_WORKSPACE_SURFACES: WorkspaceSurfaces = {
  primary: {
    canvas: CanvasPanel,
  },
  side: {
    'plant-db': PlantDbPanel,
    favorites: FavoritesPanel,
    'design-notebook': DesignNotebookSurface,
    'species-key': SpeciesKeyPanel,
    data: DataSurface,
    layers: LayersSurface,
    calendar: CalendarPanel,
    budget: BudgetPanel,
    consortium: ConsortiumPanel,
  },
}

export function DesktopWorkspace() {
  return (
    <WorkspaceComposition
      panelProjection={appCommandGraphPanelProjection.value}
      surfaces={DESKTOP_WORKSPACE_SURFACES}
    />
  )
}
