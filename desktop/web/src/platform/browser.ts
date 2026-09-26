import { installPlaceSearchSession } from "../app/geocoding/place-search-session";
import { installSettingsProjection } from "../app/settings/projection";
import { initTheme } from "../utils/theme";
import { browserDesignSessionController } from "../web/browser-design-session";
import { browserSettingsPlatformAdapter } from "./settings.browser";

let disposePlatformBootstrap: (() => void) | null = null;

export function bootstrapPlatform(): void {
  disposePlatformBootstrap?.();

  const disposeTheme = initTheme();
  const settingsInstallation = installSettingsProjection(browserSettingsPlatformAdapter);
  let disposed = false;
  void settingsInstallation.ready.catch((error) => {
    if (!disposed) console.error("Failed to bootstrap settings:", error);
  });
  // Web application lifetime: the newest Draft reopens before first render,
  // and continuous save outlives every view.
  try {
    browserDesignSessionController.restoreLatestDraft();
  } catch (error) {
    console.error("Failed to restore the latest Design Draft:", error);
  }
  const uninstallContinuousSave = browserDesignSessionController.installContinuousSave();
  const disposePlaceSearchSession = installPlaceSearchSession();

  disposePlatformBootstrap = () => {
    if (disposed) return;
    disposed = true;
    disposePlaceSearchSession();
    uninstallContinuousSave();
    settingsInstallation.dispose();
    disposeTheme();
  };
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposePlatformBootstrap?.();
    disposePlatformBootstrap = null;
  });
}
