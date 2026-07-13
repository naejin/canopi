import { describe, expect, it, vi } from "vitest";
import { createDesignSessionReplacement } from "../app/document-session/replacement";
import { createMemoryDesignSessionStore } from "../app/document-session/store";
import type { DesignSessionWorkflowRunner } from "../app/document-session/workflow-runner";
import type { CanvasDocumentSurface } from "../canvas/runtime/runtime";
import type { CanopiFile } from "../types/design";

describe("Design Session replacement", () => {
  it("attaches the current Design without replacing identity or dirty baselines", () => {
    const events: string[] = [];
    const file = makeFile("Existing");
    const store = createMemoryDesignSessionStore({ file, path: "/existing.canopi", name: "Existing" });
    store.markDocumentDirty();
    const replaceState = vi.spyOn(store, "replaceCurrentDesignState");
    const resetBaselines = vi.spyOn(store, "resetDirtyBaselines");
    const canvas = makeCanvas(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });

    const receipt = replacement.attach(canvas);

    expect(receipt).toEqual({ file, canvasHydrated: true });
    expect(events).toEqual([
      "canvas.load",
      "canvas.clear-history",
      "canvas.show-chrome",
      "canvas.zoom-to-fit",
      "workflow.install",
    ]);
    expect(replaceState).not.toHaveBeenCalled();
    expect(resetBaselines).not.toHaveBeenCalled();
    expect(store.isDesignDirty()).toBe(true);
  });

  it("attaches an empty Design Session without hydrating the canvas", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore();
    const canvas = makeCanvas(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });

    const receipt = replacement.attach(canvas);

    expect(receipt).toEqual({ file: null, canvasHydrated: false });
    expect(events).toEqual(["canvas.hide-chrome", "workflow.install"]);
    expect(canvas.loadDocument).not.toHaveBeenCalled();
    expect(canvas.replaceDocument).not.toHaveBeenCalled();
  });

  it("does not install workflows when empty canvas attachment fails", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore();
    const canvas = makeCanvas(events);
    vi.mocked(canvas.hideCanvasChrome).mockImplementation(() => {
      events.push("canvas.hide-chrome");
      throw new Error("chrome unavailable");
    });
    const workflowRunner = makeWorkflowRunner(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner });

    expect(() => replacement.attach(canvas)).toThrow("chrome unavailable");
    expect(workflowRunner.install).not.toHaveBeenCalled();
  });

  it("normalizes and applies an attached new Design in authority-safe order", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    store.markDocumentDirty();
    recordStoreEvents(store, events);
    const canvas = makeCanvas(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });
    const raw = {
      ...makeFile("New"),
      extra: { shouldBeCleared: true },
      future_top_level: { shouldAlsoBeCleared: true },
    } as CanopiFile;

    const receipt = replacement.replace({
      file: raw,
      kind: "new",
      path: null,
      name: "New Display Name",
    }, canvas);

    expect(events).toEqual([
      "canvas.replace",
      "store.replace",
      "store.reset-baselines",
      "canvas.clear-history",
      "canvas.show-chrome",
      "canvas.zoom-to-fit",
      "workflow.install",
    ]);
    expect(receipt.canvasHydrated).toBe(true);
    expect(receipt.file?.extra).toEqual({});
    expect(receipt.file).not.toHaveProperty("future_top_level");
    expect(store.readCurrentDesign()).toBe(receipt.file);
    expect(store.readDesignPath()).toBeNull();
    expect(store.readDesignName()).toBe("New Display Name");
    expect(store.isDesignDirty()).toBe(false);
  });

  it("normalizes a detached loaded Design while preserving future fields", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore();
    recordStoreEvents(store, events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });
    const raw = {
      ...makeFile("Loaded"),
      extra: { existing: true },
      future_top_level: { preserved: true },
    } as CanopiFile;

    const receipt = replacement.replace({
      file: raw,
      kind: "loaded",
      path: "/loaded.canopi",
      name: "Loaded",
    });

    expect(events).toEqual([
      "store.replace",
      "store.reset-baselines",
      "workflow.install",
    ]);
    expect(receipt.canvasHydrated).toBe(false);
    expect(receipt.file?.extra).toEqual({
      existing: true,
      future_top_level: { preserved: true },
    });
    expect(receipt.file).not.toHaveProperty("future_top_level");
    expect(store.readCurrentDesign()).toBe(receipt.file);
  });
});

function recordStoreEvents(
  store: ReturnType<typeof createMemoryDesignSessionStore>,
  events: string[],
): void {
  const replace = store.replaceCurrentDesignState.bind(store);
  const reset = store.resetDirtyBaselines.bind(store);
  vi.spyOn(store, "replaceCurrentDesignState").mockImplementation((...args) => {
    events.push("store.replace");
    replace(...args);
  });
  vi.spyOn(store, "resetDirtyBaselines").mockImplementation(() => {
    events.push("store.reset-baselines");
    reset();
  });
}

function makeWorkflowRunner(events: string[]): DesignSessionWorkflowRunner {
  return {
    install: vi.fn(() => events.push("workflow.install")),
    dispose: vi.fn(),
  };
}

function makeCanvas(events: string[]): CanvasDocumentSurface {
  let loaded = false;
  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(() => events.push("canvas.show-chrome")),
    hideCanvasChrome: vi.fn(() => events.push("canvas.hide-chrome")),
    zoomToFit: vi.fn(() => events.push("canvas.zoom-to-fit")),
    loadDocument: vi.fn(() => {
      events.push("canvas.load");
      loaded = true;
    }),
    replaceDocument: vi.fn(() => {
      events.push("canvas.replace");
      loaded = true;
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    serializeDocument: vi.fn((_metadata, document) => document),
    markSaved: vi.fn(),
    clearHistory: vi.fn(() => events.push("canvas.clear-history")),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeFile(name: string): CanopiFile {
  return {
    version: 5,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: "EUR",
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    extra: {},
  };
}
