import type { ComponentType } from 'preact'
import { Suspense } from 'preact/compat'
import { useEffect, useMemo } from 'preact/hooks'
import { usePlanningViewState } from '../../app/planning-view/state'
import type { ShellPanelBarProjection } from '../../app/shell-commands'
import {
  activePanel,
  isSidePanel,
  navigateTo,
  sidePanel,
  type Panel,
  type SidePanel,
} from '../../app/shell/state'
import { CanvasPdfDialog } from '../canvas-pdf/CanvasPdfDialog'
import { SidePanelDock } from '../shared/SidePanelDock'
import styles from './WorkspaceComposition.module.css'

type PrimaryPanel = Exclude<Panel, SidePanel>
type WorkspaceSurface = ComponentType<Record<string, never>>

export type WorkspacePanelProjection = {
  readonly [Group in keyof ShellPanelBarProjection]: readonly Pick<
    ShellPanelBarProjection[Group][number],
    'panel'
  >[]
}

export interface WorkspaceSurfaces {
  readonly primary: Partial<Record<PrimaryPanel, WorkspaceSurface>>
  readonly side: Partial<Record<SidePanel, WorkspaceSurface>>
}

export function WorkspaceComposition({
  panelProjection,
  surfaces,
  responsive = false,
}: {
  readonly panelProjection: WorkspacePanelProjection
  readonly surfaces: WorkspaceSurfaces
  readonly responsive?: boolean
}) {
  const registrations = useMemo(
    () => validateWorkspaceSurfaces(panelProjection, surfaces),
    [panelProjection, surfaces],
  )
  const currentPrimary = activePanel.value
  const requestedSide = sidePanel.value
  const primary = registrations.primary.has(currentPrimary)
    ? currentPrimary as PrimaryPanel
    : 'canvas'
  const mountedSide = primary === 'canvas'
    && requestedSide
    && registrations.side.has(requestedSide)
      ? requestedSide
      : null
  const planningView = usePlanningViewState()
  const PrimarySurface = surfaces.primary[primary]
  const SideSurface = mountedSide ? surfaces.side[mountedSide] : undefined

  useEffect(() => {
    if (
      registrations.primary.has(currentPrimary)
      && (!requestedSide || registrations.side.has(requestedSide))
    ) return
    navigateTo('canvas')
  }, [currentPrimary, registrations, requestedSide])

  if (!PrimarySurface) {
    throw new Error(`Workspace is missing its '${primary}' primary surface.`)
  }

  return (
    <div
      className={`${styles.root} ${responsive ? styles.responsive : ''} ${responsive && mountedSide ? styles.responsiveOpen : ''}`}
      data-workspace-composition
      data-workspace-primary-panel={primary}
      data-workspace-sidebar-open={mountedSide ? 'true' : undefined}
    >
      <div className={styles.primary}>
        <Suspense fallback={<WorkspaceLoading />}>
          <PrimarySurface />
        </Suspense>
      </div>
      {mountedSide && SideSurface ? (
        <SidePanelDock
          responsive={responsive}
          responsiveSize={isPlanningPanel(mountedSide) ? 'large' : 'default'}
          expanded={mountedSide === 'calendar' && planningView.calendarExpanded.value}
          onManualResize={() => { planningView.calendarExpanded.value = false }}
        >
          <div className={styles.sidePanel} data-workspace-side-panel={mountedSide}>
            <Suspense fallback={<WorkspaceLoading />}>
              <SideSurface />
            </Suspense>
          </div>
        </SidePanelDock>
      ) : null}
    </div>
  )
}

export function WorkspaceDialogs() {
  return <CanvasPdfDialog />
}

export function validateWorkspaceSurfaces(
  panelProjection: WorkspacePanelProjection,
  surfaces: WorkspaceSurfaces,
): { readonly primary: ReadonlySet<Panel>; readonly side: ReadonlySet<SidePanel> } {
  const primary = projectedPanels(panelProjection.primary, 'primary')
  const side = projectedPanels(
    [...panelProjection.design, ...panelProjection.side],
    'side',
  )
  const primarySurfaces = new Set(Object.keys(surfaces.primary) as PrimaryPanel[])
  const sideSurfaces = new Set(Object.keys(surfaces.side) as SidePanel[])

  assertSamePanels('primary', primary, primarySurfaces)
  assertSamePanels('side', side, sideSurfaces)
  if (!primary.has('canvas')) {
    throw new Error("Workspace command projection must include the 'canvas' primary panel.")
  }
  return { primary, side: side as ReadonlySet<SidePanel> }
}

function projectedPanels(
  commands: WorkspacePanelProjection['primary'],
  group: 'primary' | 'side',
): Set<Panel> {
  const panels = new Set<Panel>()
  for (const command of commands) {
    const panel = command.panel
    if (!panel) throw new Error(`Workspace ${group} command is missing a panel identity.`)
    if ((group === 'side') !== isSidePanel(panel)) {
      throw new Error(`Workspace command registers '${panel}' in the wrong panel group.`)
    }
    if (panels.has(panel)) {
      throw new Error(`Workspace command projection registers '${panel}' more than once.`)
    }
    panels.add(panel)
  }
  return panels
}

function assertSamePanels(
  group: string,
  projected: ReadonlySet<Panel>,
  registered: ReadonlySet<Panel>,
): void {
  const missing = [...projected].filter((panel) => !registered.has(panel))
  const unreachable = [...registered].filter((panel) => !projected.has(panel))
  if (missing.length === 0 && unreachable.length === 0) return

  const details = [
    missing.length > 0 ? `missing surfaces: ${missing.join(', ')}` : '',
    unreachable.length > 0 ? `unreachable surfaces: ${unreachable.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  throw new Error(`Workspace ${group} registrations disagree with shell capabilities (${details}).`)
}

function isPlanningPanel(panel: SidePanel): boolean {
  return panel === 'calendar' || panel === 'budget' || panel === 'consortium'
}

function WorkspaceLoading() {
  return <div className={styles.loading} aria-hidden="true" />
}
