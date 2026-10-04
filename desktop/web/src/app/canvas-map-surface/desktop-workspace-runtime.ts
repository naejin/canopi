import { createDesktopCanvasRuntimeAppAdapter } from '../canvas-runtime/desktop-adapter'
import { createAppSceneRuntimePanelTargetAdapter } from '../canvas-runtime/panel-target-adapter'
import { createDesktopWorkspaceMapContributionAdapter } from './desktop-workspace-map-contribution-adapter'
import { persistLastView } from './last-view'
import {
  createWorkspaceRuntimeComposition,
  type WorkspaceRuntimeComposition,
  type WorkspaceRuntimeMountOptions,
} from './workspace-runtime-composition'

/** Desktop's complete shared-workspace assembly. */
export function createDesktopWorkspaceRuntimeComposition(
  options: WorkspaceRuntimeMountOptions,
): WorkspaceRuntimeComposition {
  return createWorkspaceRuntimeComposition({
    ...options,
    appAdapter: createDesktopCanvasRuntimeAppAdapter(),
    targetPresentation: createAppSceneRuntimePanelTargetAdapter(),
    mapContributions: createDesktopWorkspaceMapContributionAdapter(),
    onViewSettled: persistLastView,
  })
}
