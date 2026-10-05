import type { ComponentChildren, FunctionComponent, RefObject } from 'preact'
import { useFocusRegion } from '../shared/useFocusRegion'
import type { CanvasCommandProjection } from '../../app/canvas-commands'
import { phoneLayout } from '../../app/shell/phone-layout'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { storyPresentationActive } from '../../app/story-presentation'
import { toolRailShowsNamesOnMap } from '../../app/tool-rail/learning'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CanvasOverview } from './CanvasOverview'
import { DisplayLegend } from './DisplayLegend'
import { InspectionLens } from './InspectionLens'
import { PlantAppearancePopovers } from './PlantAppearancePopovers'
import { PlantLabelsChip } from './PlantLabelsChip'
import { SelectionChip } from './SelectionChip'
import { SiteOnboarding } from './SiteOnboarding'
import { SpeciesFocusChip } from './SpeciesFocusChip'
import { ToolCard, type StampChooserProps } from './ToolCard'
import { ToolRail } from './ToolRail'
import { ViewChip } from './ViewChip'
import { ZoomControls } from './ZoomControls'

/**
 * The floating chrome over the map that both editions share: tool rail, tool card, view
 * chip, zoom group, the highlight and selection status chips, right-click menu, plant appearance popovers, overview,
 * inspection and New-Design guidance. The edition
 * hands over its canvas command projection.
 */
export function CanvasChrome({ projection, canvasRef, stampChooser, children }: {
  readonly projection: CanvasCommandProjection
  readonly canvasRef: RefObject<HTMLDivElement>
  /** Place a stamp's saved-stamp chooser (Desktop, where stamps are saved). */
  readonly stampChooser?: FunctionComponent<StampChooserProps>
  /** Edition-only chrome (Desktop: raster inspection). */
  readonly children?: ComponentChildren
}) {
  useFocusRegion(canvasRef, 'map')
  // A presented story shows the map alone, under its own card.
  if (storyPresentationActive.value) return null
  return <CanvasChromeContent projection={projection} canvasRef={canvasRef} stampChooser={stampChooser}>{children}</CanvasChromeContent>
}

function CanvasChromeContent({ projection, canvasRef, stampChooser, children }: {
  readonly projection: CanvasCommandProjection
  readonly canvasRef: RefObject<HTMLDivElement>
  readonly stampChooser?: FunctionComponent<StampChooserProps>
  readonly children?: ComponentChildren
}) {
  // "Where is your site?" is the one task until it is answered or skipped.
  const locating = siteLocateOpen.value
  return (
    <>
      {!locating && <ToolRail projection={projection} showNames={toolRailShowsNamesOnMap.value} />}
      <ToolCard stampChooser={stampChooser} />
      {/* Phones leave Grid and Snap to grid to the View menu. */}
      {!phoneLayout.value && <ViewChip toggles={projection.settingsToggles} />}
      <ZoomControls viewActions={projection.viewActions} />
      <InspectionLens canvasRef={canvasRef} />
      {children}
      <SpeciesFocusChip />
      {!locating && <PlantLabelsChip />}
      {!locating && <SelectionChip />}
      {!locating && <CanvasOverview />}
      <DisplayLegend />
      <SiteOnboarding />
      <CanvasContextMenu />
      <PlantAppearancePopovers canvasRef={canvasRef} />
    </>
  )
}
