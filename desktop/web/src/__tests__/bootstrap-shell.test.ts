import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disposeCloseGuard: vi.fn(),
  disposeSettings: vi.fn(),
  disposeTheme: vi.fn(),
  initShortcuts: vi.fn(),
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
    mocks.initTheme.mockReset().mockReturnValue(mocks.disposeTheme);
    mocks.installSettingsProjection.mockReset().mockReturnValue({
      ready: Promise.resolve(),
      dispose: mocks.disposeSettings,
    });
    mocks.invoke.mockReset().mockResolvedValue({ plant_db: "missing" });
    mocks.registerCloseGuard.mockReset().mockReturnValue({
      dispose: mocks.disposeCloseGuard,
    });
    mocks.restoreLatestDraft.mockReset().mockReturnValue(true);
    mocks.uninstallContinuousSave.mockReset();
    mocks.installContinuousSave.mockReset().mockReturnValue(mocks.uninstallContinuousSave);
    mocks.disposePlaceSearchSession.mockReset();
    mocks.installPlaceSearchSession.mockReset().mockReturnValue(mocks.disposePlaceSearchSession);
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
    expect(mocks.installContinuousSave).toHaveBeenCalledTimes(2);
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

    bootstrap.dispose();

    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
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
    let resolveHealth!: (health: { plant_db: "missing" }) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => {
      resolveHealth = resolve;
    }));
    const { bootstrapShell } = await import("../app/shell/bootstrap");
    const { plantDbStatus } = await import("../app/health/state");
    plantDbStatus.value = "available";
    const bootstrap = bootstrapShell({
      load: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    });

    bootstrap.dispose();
    resolveHealth({ plant_db: "missing" });
    await bootstrap.ready;

    expect(plantDbStatus.value).toBe("available");
  });
});
