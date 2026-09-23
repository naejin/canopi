import { bootstrapShell, type ShellBootstrap } from "../app/shell/bootstrap";
import {
  registerCloseGuard,
  type CloseGuardLifetime,
} from "../app/shell/close-guard";
import {
  disposeLidarWorkflow,
  installLidarWorkflow,
} from "../app/lidar/workflow";
import { desktopSettingsPlatformAdapter } from "./settings.desktop";

let shellBootstrap: ShellBootstrap | null = null;
let closeGuardLifetime: CloseGuardLifetime | null = null;

export function bootstrapPlatform(): void {
  closeGuardLifetime?.dispose();
  shellBootstrap?.dispose();
  // Desktop application/workspace lifetime: one LiDAR workflow owner that
  // outlives panel navigation and Design replacement.
  installLidarWorkflow();
  shellBootstrap = bootstrapShell(desktopSettingsPlatformAdapter);
  closeGuardLifetime = registerCloseGuard();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeLidarWorkflow();
    closeGuardLifetime?.dispose();
    closeGuardLifetime = null;
    shellBootstrap?.dispose();
    shellBootstrap = null;
  });
}
