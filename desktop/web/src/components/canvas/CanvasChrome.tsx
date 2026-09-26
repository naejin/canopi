import type { ComponentChildren, RefObject } from 'preact'
import type { CanvasCommandProjection } from '../../app/canvas-commands'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { toolRailShowsNames } from '../../app/tool-rail/learning'
import { CanvasOverview } from './CanvasOverview'
import { DisplayLegend } from './DisplayLegend'
import { InspectionLens } from './InspectionLens'
import { SiteOnboarding } from './SiteOnboarding'
import { SpeciesFocusChip } from './SpeciesFocusChip'
import { ToolRail } from './ToolRail'
import { ViewChip } from './ViewChip'
import { ZoomControls } from './ZoomControls'

/**
 * The floating chrome over the map that both editions share: tool rail, view
 * chip, zoom group, overview, inspection and New-Design guidance. The edition
 * hands over its canvas command projection.
 */
export function CanvasChrome({ projection, canvasRef, children }: {
  readonly projection: CanvasCommandProjection
  readonly canvasRef: RefObject<HTMLDivElement>
  /** Edition-only chrome (Desktop: raster inspection). */
  readonly children?: ComponentChildren
}) {
  // "Where is your site?" is the one task until it is answered or skipped.
  const locating = siteLocateOpen.value
  return (
    <>
      {!locating && <ToolRail projection={projection} showNames={toolRailShowsNames.value} />}
      <ViewChip toggles={projection.settingsToggles} />
      <ZoomControls viewActions={projection.viewActions} />
      <InspectionLens canvasRef={canvasRef} />
      {children}
      <SpeciesFocusChip />
      {!locating && <CanvasOverview />}
      <DisplayLegend />
      <SiteOnboarding />
    </>
  )
}
