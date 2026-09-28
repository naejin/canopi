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
import { installFocusRegionKeys } from "../app/shell/focus-regions";
import { registerDesignOpenFailurePresenter } from "../app/document-session/open-failure";
import { presentDesktopDesignOpenFailure } from "./open-failure.desktop";
import { desktopSettingsPlatformAdapter } from "./settings.desktop";

let shellBootstrap: ShellBootstrap | null = null;
let closeGuardLifetime: CloseGuardLifetime | null = null;
let disposeContinuousSave: (() => void) | null = null;
let disposePlaceSearchSession: (() => void) | null = null;
let disposeToolRailLearning: (() => void) | null = null;
let disposeFocusRegionKeys: (() => void) | null = null;

export function bootstrapPlatform(): void {
  closeGuardLifetime?.dispose();
  disposeFocusRegionKeys?.();
  disposeToolRailLearning?.();
  disposePlaceSearchSession?.();
  disposeContinuousSave?.();
  registerDesignOpenFailurePresenter(null);
  shellBootstrap?.dispose();
  // Desktop application/workspace lifetime: one LiDAR workflow owner that
  // outlives panel navigation and Design replacement.
  installLidarWorkflow();
  installLidarDisplayDescriptors();
  shellBootstrap = bootstrapShell(desktopSettingsPlatformAdapter);
  registerDesignOpenFailurePresenter(presentDesktopDesignOpenFailure);
  disposeContinuousSave = installDesignContinuousSave();
  disposePlaceSearchSession = installPlaceSearchSession();
  disposeToolRailLearning = installToolRailLearning();
  disposeFocusRegionKeys = installFocusRegionKeys();
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
    disposeFocusRegionKeys?.();
    disposeFocusRegionKeys = null;
    disposeContinuousSave?.();
    disposeContinuousSave = null;
    registerDesignOpenFailurePresenter(null);
    shellBootstrap?.dispose();
    shellBootstrap = null;
  });
}
