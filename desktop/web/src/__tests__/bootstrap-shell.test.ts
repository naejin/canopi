import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disposeCloseGuard: vi.fn(),
  disposeSettings: vi.fn(),
  disposeTheme: vi.fn(),
  initShortcuts: vi.fn(),
  disposeShortcuts: vi.fn(),
  initTheme: vi.fn(),
  installSettingsProjection: vi.fn(),
  invoke: vi.fn(),
  registerCloseGuard: vi.fn(),
  browserSettingsAdapter: {
    load: vi.fn(),
    save: vi.fn(),
  },
  desktopSettingsAdapter: {
    load: vi.fn(),
    save: vi.fn(),
  },
  restoreLatestDraft: vi.fn(),
  installContinuousSave: vi.fn(),
  uninstallContinuousSave: vi.fn(),
  installPlaceSearchSession: vi.fn(),
  disposePlaceSearchSession: vi.fn(),
  installToolRailLearning: vi.fn(),
  disposeToolRailLearning: vi.fn(),
  setAsideDataFromBefore2_0: vi.fn(),
  showBrowserShellNotice: vi.fn(),
}));

vi.mock("../web/browser-app-data", () => ({
  browserAppDataStore: { setAsideDataFromBefore2_0: mocks.setAsideDataFromBefore2_0 },
}));

vi.mock("../web/browser-shell-notice", () => ({
  showBrowserShellNotice: mocks.showBrowserShellNotice,
}));

vi.mock("../app/tool-rail/learning", () => ({
  installToolRailLearning: mocks.installToolRailLearning,
}));

vi.mock("../web/browser-design-session", () => ({
  browserDesignSessionController: {
    restoreLatestDraft: mocks.restoreLatestDraft,
    installContinuousSave: mocks.installContinuousSave,
  },
}));

vi.mock("../app/geocoding/place-search-session", () => ({
  installPlaceSearchSession: mocks.installPlaceSearchSession,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../shortcuts/manager", () => ({
  initShortcuts: mocks.initShortcuts,
  disposeShortcuts: mocks.disposeShortcuts,
}));

vi.mock("../utils/theme", () => ({
  initTheme: mocks.initTheme,
}));

vi.mock("../app/settings/projection", () => ({
  installSettingsProjection: mocks.installSettingsProjection,
}));

vi.mock("../app/shell/close-guard", () => ({
  registerCloseGuard: mocks.registerCloseGuard,
}));

vi.mock("../platform/settings.browser", () => ({
  browserSettingsPlatformAdapter: mocks.browserSettingsAdapter,
}));

vi.mock("../platform/settings.desktop", () => ({
  desktopSettingsPlatformAdapter: mocks.desktopSettingsAdapter,
}));

describe("settings platform bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.disposeCloseGuard.mockReset();
    mocks.disposeSettings.mockReset();
    mocks.disposeTheme.mockReset();
    mocks.initShortcuts.mockReset();
    mocks.disposeShortcuts.mockReset();
    mocks.initTheme.mockReset().mockReturnValue(mocks.disposeTheme);
    mocks.installSettingsProjection.mockReset().mockReturnValue({
      ready: Promise.resolve(),
      dispose: mocks.disposeSettings,
    });
    mocks.invoke.mockReset().mockResolvedValue({
      plant_db: "missing",
      lidar_library: { kind: "recovered", items: 2, generated: 1 },
      local_data: { kind: "moved_aside" },
    });
    mocks.registerCloseGuard.mockReset().mockReturnValue({
      dispose: mocks.disposeCloseGuard,
    });
    mocks.restoreLatestDraft.mockReset().mockReturnValue(true);
    mocks.uninstallContinuousSave.mockReset();
    mocks.installContinuousSave.mockReset().mockReturnValue(mocks.uninstallContinuousSave);
    mocks.disposePlaceSearchSession.mockReset();
    mocks.installPlaceSearchSession.mockReset().mockReturnValue(mocks.disposePlaceSearchSession);
    mocks.disposeToolRailLearning.mockReset();
    mocks.installToolRailLearning.mockReset().mockReturnValue(mocks.disposeToolRailLearning);
    mocks.setAsideDataFromBefore2_0.mockReset().mockReturnValue({ movedAside: false, keptInPlace: false, error: null });
    mocks.showBrowserShellNotice.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces the Browser settings and theme lifecycle on repeated bootstrap", async () => {
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();
    bootstrapPlatform();

    expect(mocks.initTheme).toHaveBeenCalledTimes(2);
    expect(mocks.installSettingsProjection).toHaveBeenCalledTimes(2);
    expect(mocks.installSettingsProjection).toHaveBeenNthCalledWith(
      1,
      mocks.browserSettingsAdapter,
    );
    expect(mocks.initTheme.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installSettingsProjection.mock.invocationCallOrder[0]!,
    );
    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
    expect(mocks.disposeTheme).toHaveBeenCalledOnce();
  });

  it("owns the Web Design Session lifetime: restores the newest Draft, then saves continuously", async () => {
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();

    expect(mocks.restoreLatestDraft).toHaveBeenCalledOnce();
    expect(mocks.installContinuousSave).toHaveBeenCalledOnce();
    expect(mocks.installPlaceSearchSession).toHaveBeenCalledOnce();
    expect(mocks.installSettingsProjection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreLatestDraft.mock.invocationCallOrder[0]!,
    );
    expect(mocks.restoreLatestDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installContinuousSave.mock.invocationCallOrder[0]!,
    );

    bootstrapPlatform();

    expect(mocks.uninstallContinuousSave).toHaveBeenCalledOnce();
    expect(mocks.disposePlaceSearchSession).toHaveBeenCalledOnce();
    expect(mocks.installToolRailLearning).toHaveBeenCalledTimes(2);
    expect(mocks.disposeToolRailLearning).toHaveBeenCalledOnce();
    expect(mocks.installContinuousSave).toHaveBeenCalledTimes(2);
  });

  it("moves browser data from before Canopi 2.0 aside before restoring a Draft, and says so once", async () => {
    mocks.setAsideDataFromBefore2_0.mockReturnValue({ movedAside: true, keptInPlace: false, error: null });
    const { t } = await import("../i18n");
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.setAsideDataFromBefore2_0).toHaveBeenCalledOnce();
    expect(mocks.setAsideDataFromBefore2_0.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreLatestDraft.mock.invocationCallOrder[0]!,
    );
    expect(mocks.showBrowserShellNotice).toHaveBeenCalledOnce();
    expect(mocks.showBrowserShellNotice).toHaveBeenCalledWith({
      tone: "info",
      title: t("health.localDataMovedAsideTitle"),
      message: t("health.localDataMovedAside"),
    });
  });

  it("says once that earlier browser data stays in place when it could not be moved aside", async () => {
    const error = new Error("quota");
    mocks.setAsideDataFromBefore2_0.mockReturnValue({ movedAside: true, keptInPlace: true, error });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { t } = await import("../i18n");
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.showBrowserShellNotice).toHaveBeenCalledOnce();
    expect(mocks.showBrowserShellNotice).toHaveBeenCalledWith({
      tone: "info",
      title: t("health.localDataKeptInPlaceTitle"),
      message: t("health.localDataKeptInPlace"),
    });
    expect(mocks.restoreLatestDraft).toHaveBeenCalledOnce();
  });

  it("says nothing when no browser data from before Canopi 2.0 was found", async () => {
    const error = new Error("quota");
    mocks.setAsideDataFromBefore2_0.mockReturnValue({ movedAside: false, keptInPlace: false, error });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.showBrowserShellNotice).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("Failed to set aside browser data from before Canopi 2.0:", error);
    expect(mocks.restoreLatestDraft).toHaveBeenCalledOnce();
  });

  it("still saves continuously when restoring the newest Draft fails", async () => {
    const error = new Error("storage unavailable");
    mocks.restoreLatestDraft.mockImplementation(() => {
      throw error;
    });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();

    expect(logError).toHaveBeenCalledWith("Failed to restore the latest Design Draft:", error);
    expect(mocks.installContinuousSave).toHaveBeenCalledOnce();
  });

  it("does not report a Browser settings failure from a replaced bootstrap", async () => {
    let rejectFirstLoad!: (error: unknown) => void;
    const firstReady = new Promise<void>((_resolve, reject) => {
      rejectFirstLoad = reject;
    });
    mocks.installSettingsProjection
      .mockReturnValueOnce({ ready: firstReady, dispose: mocks.disposeSettings })
      .mockReturnValueOnce({ ready: Promise.resolve(), dispose: mocks.disposeSettings });
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();
    bootstrapPlatform();
    rejectFirstLoad(new Error("obsolete settings load"));
    await Promise.resolve();

    expect(logError).not.toHaveBeenCalled();
  });

  it("replaces the Desktop shell lifecycle while preserving the close guard", async () => {
    const { bootstrapPlatform } = await import("../platform/desktop");

    bootstrapPlatform();
    bootstrapPlatform();

    expect(mocks.installSettingsProjection).toHaveBeenCalledTimes(2);
    expect(mocks.installSettingsProjection).toHaveBeenNthCalledWith(
      1,
      mocks.desktopSettingsAdapter,
    );
    expect(mocks.registerCloseGuard).toHaveBeenCalledTimes(2);
    expect(mocks.disposeCloseGuard).toHaveBeenCalledOnce();
    expect(mocks.installPlaceSearchSession).toHaveBeenCalledTimes(2);
    expect(mocks.disposePlaceSearchSession).toHaveBeenCalledOnce();
    expect(mocks.installToolRailLearning).toHaveBeenCalledTimes(2);
    expect(mocks.disposeToolRailLearning).toHaveBeenCalledOnce();
    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
    expect(mocks.disposeTheme).toHaveBeenCalledOnce();
  });

  it("boots shell services and delegates settings lifecycle", async () => {
    const settingsAdapter = {
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const { bootstrapShell } = await import("../app/shell/bootstrap");
    const healthState = await import("../app/health/state");

    const bootstrap = bootstrapShell(settingsAdapter);
    await bootstrap.ready;

    expect(mocks.initTheme).toHaveBeenCalledTimes(1);
    expect(mocks.initShortcuts).toHaveBeenCalledTimes(1);
    expect(mocks.installSettingsProjection).toHaveBeenCalledWith(settingsAdapter);
    expect(mocks.initTheme.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.installSettingsProjection.mock.invocationCallOrder[0]!,
    );
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith("get_health");
    expect(healthState.plantDbStatus.value).toBe("missing");
    expect(healthState.lidarLibraryStatus.value).toEqual({ kind: "recovered", items: 2, generated: 1 });
    expect(healthState.localDataStatus.value).toEqual({ kind: "moved_aside" });

    bootstrap.dispose();

    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
    expect(mocks.disposeShortcuts).toHaveBeenCalledOnce();
    expect(mocks.disposeTheme).toHaveBeenCalledOnce();
  });

  it("reports a settings load failure without rejecting shell readiness", async () => {
    const error = new Error("settings unavailable");
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.installSettingsProjection.mockReturnValue({
      ready: Promise.reject(error),
      dispose: mocks.disposeSettings,
    });
    const { bootstrapShell } = await import("../app/shell/bootstrap");

    const bootstrap = bootstrapShell({
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    });

    await expect(bootstrap.ready).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith("Failed to bootstrap settings:", error);
    bootstrap.dispose();
  });

  it("disposes one shell lifetime at most once", async () => {
    const { bootstrapShell } = await import("../app/shell/bootstrap");
    const bootstrap = bootstrapShell({
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    });

    bootstrap.dispose();
    bootstrap.dispose();

    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
    expect(mocks.disposeTheme).toHaveBeenCalledOnce();
  });

  it("ignores health returned after its shell lifetime is disposed", async () => {
    let resolveHealth!: (health: { plant_db: "missing"; lidar_library: { kind: "unavailable" } }) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => {
      resolveHealth = resolve;
    }));
    const { bootstrapShell } = await import("../app/shell/bootstrap");
    const { lidarLibraryStatus, plantDbStatus } = await import("../app/health/state");
    plantDbStatus.value = "available";
    lidarLibraryStatus.value = { kind: "ready" };
    const bootstrap = bootstrapShell({
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    });

    bootstrap.dispose();
    resolveHealth({ plant_db: "missing", lidar_library: { kind: "unavailable" } });
    await bootstrap.ready;

    expect(plantDbStatus.value).toBe("available");
    expect(lidarLibraryStatus.value).toEqual({ kind: "ready" });
  });
});
