import { invoke } from "@tauri-apps/api/core";
import { initShortcuts } from "../../shortcuts/manager";
import type { SubsystemHealth } from "../../types/health";
import { initTheme } from "../../utils/theme";
import { plantDbStatus } from "../health/state";
import type { SettingsPlatformAdapter } from "../settings/platform-adapter";
import { installSettingsProjection } from "../settings/projection";

export interface ShellBootstrap {
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * Construct one Desktop shell lifetime. The platform composition root owns
 * replacement and disposal when bootstrap repeats or Vite reloads the module.
 */
export function bootstrapShell(settingsAdapter: SettingsPlatformAdapter): ShellBootstrap {
  const disposeTheme = initTheme();
  initShortcuts();
  let disposed = false;

  const healthReady = invoke<SubsystemHealth>("get_health")
    .then((health) => {
      if (disposed) return;
      plantDbStatus.value = health.plant_db;
    })
    .catch((error) => {
      if (!disposed) console.error("Failed to query health:", error);
    });

  const settingsInstallation = installSettingsProjection(settingsAdapter);
  const settingsReady = settingsInstallation.ready
    .catch((error) => {
      if (!disposed) console.error("Failed to bootstrap settings:", error);
    });

  return {
    ready: Promise.all([healthReady, settingsReady]).then(() => undefined),
    dispose() {
      if (disposed) return;
      disposed = true;
      settingsInstallation.dispose();
      disposeTheme();
    },
  };
}
