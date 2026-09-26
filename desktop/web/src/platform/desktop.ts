import { bootstrapShell, type ShellBootstrap } from "../app/shell/bootstrap";
import {
  registerCloseGuard,
  type CloseGuardLifetime,
} from "../app/shell/close-guard";
import {
  disposeLidarWorkflow,
  installLidarWorkflow,
} from "../app/lidar/workflow";
import {
  disposeLidarDisplayDescriptors,
  installLidarDisplayDescriptors,
} from "../app/lidar/display";
import { installDesignContinuousSave } from "../app/document-session/transition";
import { installPlaceSearchSession } from "../app/geocoding/place-search-session";
import { installToolRailLearning } from "../app/tool-rail/learning";
import { desktopSettingsPlatformAdapter } from "./settings.desktop";

let shellBootstrap: ShellBootstrap | null = null;
let closeGuardLifetime: CloseGuardLifetime | null = null;
let disposeContinuousSave: (() => void) | null = null;
let disposePlaceSearchSession: (() => void) | null = null;
let disposeToolRailLearning: (() => void) | null = null;

export function bootstrapPlatform(): void {
  closeGuardLifetime?.dispose();
  disposeToolRailLearning?.();
  disposePlaceSearchSession?.();
  disposeContinuousSave?.();
  shellBootstrap?.dispose();
  // Desktop application/workspace lifetime: one LiDAR workflow owner that
  // outlives panel navigation and Design replacement.
  installLidarWorkflow();
  installLidarDisplayDescriptors();
  shellBootstrap = bootstrapShell(desktopSettingsPlatformAdapter);
  disposeContinuousSave = installDesignContinuousSave();
  disposePlaceSearchSession = installPlaceSearchSession();
  disposeToolRailLearning = installToolRailLearning();
  closeGuardLifetime = registerCloseGuard();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarWorkflow();
    disposeLidarDisplayDescriptors();
    closeGuardLifetime?.dispose();
    closeGuardLifetime = null;
    disposePlaceSearchSession?.();
    disposePlaceSearchSession = null;
    disposeToolRailLearning?.();
    disposeToolRailLearning = null;
    disposeContinuousSave?.();
    disposeContinuousSave = null;
    shellBootstrap?.dispose();
    shellBootstrap = null;
  });
}
