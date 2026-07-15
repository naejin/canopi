import { bootstrapShell, type ShellBootstrap } from "../app/shell/bootstrap";
import {
  registerCloseGuard,
  type CloseGuardLifetime,
} from "../app/shell/close-guard";
import { desktopSettingsPlatformAdapter } from "./settings.desktop";

let shellBootstrap: ShellBootstrap | null = null;
let closeGuardLifetime: CloseGuardLifetime | null = null;

export function bootstrapPlatform(): void {
  closeGuardLifetime?.dispose();
  shellBootstrap?.dispose();
  shellBootstrap = bootstrapShell(desktopSettingsPlatformAdapter);
  closeGuardLifetime = registerCloseGuard();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    closeGuardLifetime?.dispose();
    closeGuardLifetime = null;
    shellBootstrap?.dispose();
    shellBootstrap = null;
  });
}
