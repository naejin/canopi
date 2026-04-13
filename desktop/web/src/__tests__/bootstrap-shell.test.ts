import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  });

  it("boots once and hydrates health plus settings", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "get_health") {
        return Promise.resolve({ plant_db: "degraded" });
      }
      if (command === "get_settings") {
        return Promise.resolve({
          locale: "fr",
          theme: "dark",
          snap_to_grid: true,
          snap_to_guides: true,
          auto_save_interval_s: 15,
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
    const state = await import("../app/shell/state");

    bootstrapShell();
    bootstrapShell();
    await flushMicrotasks();

    expect(mocks.initTheme).toHaveBeenCalledTimes(1);
    expect(mocks.initShortcuts).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_health");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_settings");
    expect(state.plantDbStatus.value).toBe("degraded");
    expect(state.locale.value).toBe("fr");
    expect(state.theme.value).toBe("dark");
    expect(state.autoSaveIntervalMs.value).toBe(15_000);
  });
});
