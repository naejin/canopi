import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapUpdater: vi.fn(),
  invoke: vi.fn(),
  initShortcuts: vi.fn(),
  initTheme: vi.fn(),
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

vi.mock("../app/updater/controller", () => ({
  bootstrapUpdater: mocks.bootstrapUpdater,
}));

vi.mock("../app/updater/config", () => ({
  updaterEnabled: true,
}));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("bootstrapShell", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.invoke.mockReset();
    mocks.initShortcuts.mockReset();
    mocks.initTheme.mockReset();
    mocks.bootstrapUpdater.mockReset();
  });

  it("boots once and hydrates health plus settings", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_health") {
        return Promise.resolve({ plant_db: "missing" });
      }
      if (command === "get_settings") {
        return Promise.resolve({
          locale: "fr",
          theme: "dark",
          snap_to_grid: true,
          snap_to_guides: true,
          show_smart_guides: true,
          auto_save_interval_s: 15,
          confirm_destructive: true,
          default_currency: "EUR",
          measurement_units: "metric",
          show_botanical_names: true,
          debug_logging: false,
          check_updates: true,
          default_design_dir: "",
          recent_files_max: 20,
          last_active_panel: "canvas",
          bottom_panel_open: true,
          bottom_panel_height: 420,
          bottom_panel_tab: "timeline",
          map_layer_visible: true,
          map_opacity: 0.8,
          contour_visible: false,
          contour_opacity: 0.6,
          contour_interval: 5,
          hillshade_visible: true,
          hillshade_opacity: 0.4,
        });
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    const { bootstrapShell } = await import("../app/shell/bootstrap");
    const settingsState = await import("../app/settings/state");
    const healthState = await import("../app/health/state");

    bootstrapShell();
    bootstrapShell();
    await flushMicrotasks();

    expect(mocks.initTheme).toHaveBeenCalledTimes(1);
    expect(mocks.initShortcuts).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_health");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_settings");
    expect(mocks.bootstrapUpdater).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrapUpdater).toHaveBeenCalledWith(true);
    expect(healthState.plantDbStatus.value).toBe("missing");
    expect(settingsState.locale.value).toBe("fr");
    expect(settingsState.theme.value).toBe("dark");
    expect(settingsState.autoSaveIntervalMs.value).toBe(15_000);
  });
});
