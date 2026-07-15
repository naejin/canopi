import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("settings bootstrap theme lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a disposer that stops theme synchronization", async () => {
    localStorage.setItem("canopi-theme", "dark");
    const { theme } = await import("../app/settings/state");
    const { initTheme } = await import("../utils/theme");

    const dispose = initTheme();

    expect(theme.value).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    dispose();
    theme.value = "light";

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("keeps applying the theme when the first-paint cache is unavailable", async () => {
    const cacheError = new Error("storage denied");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw cacheError;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw cacheError;
    });
    const { initTheme } = await import("../utils/theme");

    expect(() => initTheme()).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  });

  it("hydrates Browser settings and replaces the first-paint cache before render", async () => {
    localStorage.setItem("canopi-theme", "light");
    const { browserAppDataStore } = await import("../web/browser-app-data");
    browserAppDataStore.saveSettings({ locale: "fr", theme: "dark" });
    const { locale, theme } = await import("../app/settings/state");
    const { bootstrapPlatform } = await import("../platform/browser");

    bootstrapPlatform();

    expect(locale.value).toBe("fr");
    expect(theme.value).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("canopi-theme")).toBe("dark");
  });
});
