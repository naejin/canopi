import { installPlaceSearchSession } from "../app/geocoding/place-search-session";
import { installToolRailLearning } from "../app/tool-rail/learning";
import { installSettingsProjection } from "../app/settings/projection";
import { initTheme } from "../utils/theme";
import { registerDesignOpenFailurePresenter } from "../app/document-session/open-failure";
import { browserDesignSessionController } from "../web/browser-design-session";
import { showBrowserShellNotice } from "../web/browser-shell-notice";
import { browserAppDataStore } from "../web/browser-app-data";
import { t } from "../i18n";
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
  // Browser data from before Canopi 2.0 moves to dated backup keys before any
  // Draft is read (ADR 0021); the notice waits for the user's locale.
  const setAside = browserAppDataStore.setAsideDataFromBefore2_0(new Date().toISOString());
  if (setAside.error !== null) {
    console.error("Failed to set aside browser data from before Canopi 2.0:", setAside.error);
  }
  // Earlier data whose copy did not fit stays in place, hidden; saying so
  // (once) takes precedence over saying the rest moved.
  if (setAside.keptInPlace || setAside.movedAside) {
    void settingsInstallation.ready.catch(() => undefined).then(() => {
      if (disposed) return;
      showBrowserShellNotice(setAside.keptInPlace
        ? {
          tone: "info",
          title: t("health.localDataKeptInPlaceTitle"),
          message: t("health.localDataKeptInPlace"),
        }
        : {
          tone: "info",
          title: t("health.localDataMovedAsideTitle"),
          message: t("health.localDataMovedAside"),
        });
    });
  }
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

  disposePlatformBootstrap = () => {
    if (disposed) return;
    disposed = true;
    registerDesignOpenFailurePresenter(null);
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
