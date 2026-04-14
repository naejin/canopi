import { invoke } from "@tauri-apps/api/core";
import { initShortcuts } from "../../shortcuts/manager";
import type { SubsystemHealth } from "../../types/health";
import type { Settings } from "../../types/settings";
import { initTheme } from "../../utils/theme";
import { plantDbStatus } from "../health/state";
import { setBootstrappedSettings } from "../settings/persistence";
import { bootstrapUpdater } from "../updater/controller";
import { updaterEnabled } from "../updater/config";

let shellBootstrapped = false;

/**
 * Prime shell-wide services exactly once per module lifetime.
 * The individual subsystems are HMR-safe, so a fresh bootstrap on hot reload
 * is acceptable as long as the previous module instance releases its handlers.
 */
export function bootstrapShell(): void {
  if (shellBootstrapped) return;
  shellBootstrapped = true;

  initTheme();
  initShortcuts();

  void invoke<SubsystemHealth>("get_health")
    .then((health) => {
      plantDbStatus.value = health.plant_db;
    })
    .catch((error) => console.error("Failed to query health:", error));

  void invoke<Settings>("get_settings")
    .then((settings) => {
      setBootstrappedSettings(settings);
      if (updaterEnabled) {
        bootstrapUpdater(settings.check_updates);
      }
    })
    .catch((error) => console.error("Failed to bootstrap settings:", error));
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    shellBootstrapped = false;
  });
}
