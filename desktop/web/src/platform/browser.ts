import { installPlaceSearchSession } from "../app/geocoding/place-search-session";
import { installToolRailLearning } from "../app/tool-rail/learning";
import { installFocusRegionKeys } from "../app/shell/focus-regions";
import { installSettingsProjection } from "../app/settings/projection";
import { initTheme } from "../utils/theme";
import { registerDesignOpenFailurePresenter } from "../app/document-session/open-failure";
import { browserDesignSessionController } from "../web/browser-design-session";
import { showBrowserShellNotice } from "../web/browser-shell-notice";
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
  registerDesignOpenFailurePresenter(showBrowserShellNotice);
  const disposePlaceSearchSession = installPlaceSearchSession();
  const disposeToolRailLearning = installToolRailLearning();
  const disposeFocusRegionKeys = installFocusRegionKeys();

  disposePlatformBootstrap = () => {
    if (disposed) return;
    disposed = true;
    registerDesignOpenFailurePresenter(null);
    disposeFocusRegionKeys();
    disposeToolRailLearning();
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
