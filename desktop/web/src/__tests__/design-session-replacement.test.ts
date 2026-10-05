import { describe, expect, it, vi } from "vitest";
import { effect, signal } from "@preact/signals";
import { createDesignSessionReplacement } from "../app/document-session/replacement";
import { createMemoryDesignSessionStore } from "../app/document-session/store";
import type { DesignSessionWorkflowRunner } from "../app/document-session/workflow-runner";
import {
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentSurface,
} from "../canvas/runtime/runtime";
import { SceneHistory } from "../canvas/runtime/scene-history";
import { SceneStore } from "../canvas/runtime/scene";
import { SceneRuntimeEditCoordinator } from "../canvas/runtime/scene-runtime/transactions";
import type { CanopiFile } from "../types/design";
import {
  editDesignSessionForTest,
  markDesignSessionDirtyForTest,
} from "./support/design-session-edit";

describe("Design Session replacement", () => {
  it.each(["resumePendingCanvasReplacement", "settlePendingCanvasReplacementForHandoff"] as const)(
    "%s preserves newer Design edits using the retained authorization", (settle) => {
      const events: string[] = [];
      const store = createMemoryDesignSessionStore({ file: makeFile("Previous"), path: null, name: "Previous" });
      const canvas = makeCanvas(events);
      const finalized = vi.fn();
      let baselineCurrent = true;
      vi.mocked(canvas.replaceDocument).mockImplementationOnce(() => { throw new Error("hydration interrupted"); });
      const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });
      const input = { file: makeFile("Requested"), kind: "loaded" as const, path: null, name: "Requested", onDesignFinalized: finalized };
      expect(() => replacement.replace(input, canvas, () => baselineCurrent)).toThrow("hydration interrupted");
      const identity = replacement.pendingCanvasReplacement(canvas)!.identity;
      editDesignSessionForTest(store, file => ({ ...file, description: "Keep this later edit" }));
      baselineCurrent = false;

      expect(replacement[settle](canvas, identity)).toEqual({ preservedCurrentDesign: true });

      expect(store.readCurrentDesign()?.description).toBe("Keep this later edit");
      expect(store.readDesignName()).toBe("Previous");
      expect(store.isDesignDirty()).toBe(true);
      expect(finalized).not.toHaveBeenCalled();
      expect(vi.mocked(canvas.replaceDocument).mock.calls[1]?.[1])
        .toBe(vi.mocked(canvas.replaceDocument).mock.calls[0]?.[1]);
      expect(canvas.showCanvasChrome).toHaveBeenCalledTimes(settle === "resumePendingCanvasReplacement" ? 1 : 0);
      expect(replacement.pendingCanvasReplacement(canvas)).toBeNull();
    },
  );

  it.each(["resumePendingCanvasReplacement", "settlePendingCanvasReplacementForHandoff"] as const)(
    "%s retains applied finalization and refuses another Canvas identity", (settle) => {
      const store = createMemoryDesignSessionStore({ file: makeFile("Previous"), path: null, name: "Previous" });
      const canvas = makeCanvas([]);
      const finalized = vi.fn();
      let baselineCurrent = true;
      vi.mocked(canvas.replaceDocument).mockImplementationOnce((_file, _token, finalize) => {
        finalize();
        throw new Error("publication interrupted after finalization");
      });
      const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner([]) });
      const input = { file: makeFile("Requested"), kind: "loaded" as const, path: null, name: "Requested", onDesignFinalized: finalized };
      expect(() => replacement.replace(input, canvas, () => baselineCurrent)).toThrow("publication interrupted");
      const pending = replacement.pendingCanvasReplacement(canvas)!;
      expect(pending.designWasApplied).toBe(true);
      editDesignSessionForTest(store, file => ({ ...file, description: "Edit after finalization" }));
      baselineCurrent = false;
      const otherCanvas = makeCanvas([]);
      expect(replacement.pendingCanvasReplacement(otherCanvas)).toBeNull();
      expect(replacement[settle](otherCanvas, pending.identity)).toBeNull();
      expect(canvas.replaceDocument).toHaveBeenCalledOnce();
      expect(replacement[settle](canvas, pending.identity)).toEqual({ preservedCurrentDesign: false });
      expect(store.readDesignName()).toBe("Requested");
      expect(store.readCurrentDesign()?.description).toBe("Edit after finalization");
      expect(store.isDesignDirty()).toBe(true);
      expect(finalized).toHaveBeenCalledOnce();
      expect(replacement[settle](canvas, pending.identity)).toBeNull();
    },
  );

  it("retains renewed explicit authorization after a second interrupted attempt", () => {
    const store = createMemoryDesignSessionStore({ file: makeFile("Previous"), path: null, name: "Previous" });
    const canvas = makeCanvas([]);
    vi.mocked(canvas.replaceDocument)
      .mockImplementationOnce(() => { throw new Error("interrupted"); })
      .mockImplementationOnce(() => { throw new Error("interrupted again"); });
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner([]) });
    const input = { file: makeFile("Requested"), kind: "loaded" as const, path: null, name: "Requested" };
    let originalCurrent = true;
    expect(() => replacement.replace(input, canvas, () => originalCurrent)).toThrow("interrupted");
    const identity = replacement.pendingCanvasReplacement(canvas)!.identity;
    originalCurrent = false;
    expect(replacement.pendingCanvasReplacement(canvas)?.isDesignBaselineCurrent).toBe(false);
    expect(() => replacement.replace(input, canvas, () => true)).toThrow("interrupted again");
    expect(replacement.pendingCanvasReplacement(canvas)?.identity).toBe(identity);
    expect(replacement.pendingCanvasReplacement(canvas)?.isDesignBaselineCurrent).toBe(true);
    expect(replacement.resumePendingCanvasReplacement(canvas, identity)).toEqual({ preservedCurrentDesign: false });
    expect(store.readDesignName()).toBe("Requested");
  });

  it("changes the public session identity only when the Design is replaced", () => {
    const store = createMemoryDesignSessionStore({ file: makeFile("Garden"), path: null, name: "Garden" });
    const identity = store.sessionIdentity.value;
    editDesignSessionForTest(store, (file) => ({ ...file, description: "Changed" }));
    expect(store.isDesignDirty()).toBe(true);
    expect(store.sessionIdentity.value).toBe(identity);
    store.replaceCurrentDesignState(makeFile("Other"), null, "Other");
    expect(store.sessionIdentity.value).not.toBe(identity);
  });

  it("attaches the current Design without replacing identity or dirty baselines", () => {
    const events: string[] = [];
    const file = makeFile("Existing");
    const store = createMemoryDesignSessionStore({ file, path: "/existing.canopi", name: "Existing" });
    store.markCanvasDetachedDirty(true);
    const replaceState = vi.spyOn(store, "replaceCurrentDesignState");
    const resetBaselines = vi.spyOn(store, "resetDirtyBaselines");
    const canvas = makeCanvas(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });

    const receipt = replacement.attach(canvas);

    expect(receipt).toEqual({ file, canvasHydrated: true });
    expect(events).toEqual([
      "canvas.load",
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
    markDesignSessionDirtyForTest(store);
    recordStoreEvents(store, events);
    const canvas = makeCanvas(events);
    const replacement = createDesignSessionReplacement({ store, workflowRunner: makeWorkflowRunner(events) });
    const raw = {
      ...makeFile("New"),
      extra: { shouldBeCleared: true, plant_display: { labels: "codes" } },
      future_top_level: { shouldAlsoBeCleared: true },
    } as CanopiFile;

    const receipt = replacement.replace({
      file: raw,
      kind: "new",
      path: null,
      name: "New Display Name",
    }, canvas, () => true);

    expect(events).toEqual([
      "canvas.replace",
      "store.reset-baselines",
      "store.replace",
      "canvas.show-chrome",
      "canvas.zoom-to-fit",
      "workflow.install",
    ]);
    expect(receipt.canvasHydrated).toBe(true);
    // Only the Settings › New Designs display options survive into a new Design.
    expect(receipt.file?.extra).toEqual({ plant_display: { labels: "codes" } });
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
    }, null, () => true);

    expect(events).toEqual([
      "store.reset-baselines",
      "store.replace",
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

  it("resumes an equivalent normalized replacement after Scene hydration publication fails", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    let cleanStateFailures = 1;
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1;
          throw new Error("clean-state publication failed");
        }
      },
    });
    const sceneStore = new SceneStore().hydrate(makeFile("Previous"));
    const authority = new SceneRuntimeEditCoordinator({
      sceneStore,
      history,
      setSelection: (ids) => sceneStore.setSelection(ids),
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    });
    const canvas = makeCanvas(events);
    vi.mocked(canvas.replaceDocument).mockImplementation((file, token, finalizeReplacement) => {
      events.push("canvas.replace");
      const callerFinalizerInvoked = authority.replaceDocument(file, {
        token,
        prepare: () => {},
        finalizeReplacement,
      });
      return { callerFinalizerInvoked };
    });
    const replacement = createDesignSessionReplacement({
      store,
      workflowRunner: makeWorkflowRunner(events),
    });
    const input = {
      file: {
        ...makeFile("Recovered"),
        layers: [{ name: "plants", visible: true, locked: false, opacity: 1 }],
      },
      kind: "loaded" as const,
      path: "/recovered.canopi",
      name: "Recovered",
    };

    expect(() => replacement.replace(input, canvas, () => true))
      .toThrow("clean-state publication failed");
    expect(store.readDesignName()).toBe("Previous");

    const receipt = replacement.replace(input, canvas, () => true);

    expect(receipt.file?.name).toBe("Recovered");
    expect(sceneStore.persisted.layers).toEqual([
      expect.objectContaining(input.file.layers[0]),
    ]);
    expect(store.readDesignName()).toBe("Recovered");
    expect(canvas.replaceDocument).toHaveBeenCalledTimes(2);
    expect(canvas.replaceDocument).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );
    expect(canvas.replaceDocument).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );
    expect(vi.mocked(canvas.replaceDocument).mock.calls[0]?.[0])
      .not.toBe(vi.mocked(canvas.replaceDocument).mock.calls[1]?.[0]);
    expect(vi.mocked(canvas.replaceDocument).mock.calls[0]?.[1])
      .toBe(vi.mocked(canvas.replaceDocument).mock.calls[1]?.[1]);
  });

  it("drops a replacement the Canvas did not admit to hydration", () => {
    const events: string[] = [];
    const previous = makeFile("Previous");
    const store = createMemoryDesignSessionStore({
      file: previous,
      path: "/previous.canopi",
      name: "Previous",
    });
    const canvas = makeCanvas(events);
    const preparationError = new Error("replacement preparation failed");
    vi.mocked(canvas.replaceDocument).mockImplementationOnce(() => {
      throw new CanvasDocumentReplacementNotAdmittedError(preparationError);
    });
    const replacement = createDesignSessionReplacement({
      store,
      workflowRunner: makeWorkflowRunner(events),
    });
    const rejected = {
      file: makeFile("Rejected"),
      kind: "loaded" as const,
      path: "/rejected.canopi",
      name: "Rejected",
    };

    expect(() => replacement.replace(rejected, canvas, () => true)).toThrow(preparationError);
    expect(replacement.pendingCanvasReplacement(canvas)).toBeNull();

    replacement.replace({
      file: makeFile("Later"),
      kind: "loaded",
      path: "/later.canopi",
      name: "Later",
    }, canvas, () => true);

    expect(vi.mocked(canvas.replaceDocument).mock.calls[0]?.[1])
      .not.toBe(vi.mocked(canvas.replaceDocument).mock.calls[1]?.[1]);
    expect(store.readDesignName()).toBe("Later");
  });

  it("preserves edits made after Design identity applied but its publication threw", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    const applyReplacementState = store.replaceCurrentDesignState.bind(store);
    const replaceState = vi.spyOn(store, "replaceCurrentDesignState");
    let replacementPublicationFailures = 1;
    replaceState.mockImplementation((...args) => {
      applyReplacementState(...args);
      if (replacementPublicationFailures > 0) {
        replacementPublicationFailures -= 1;
        throw new Error("Design identity publication failed");
      }
    });
    const resetBaselines = vi.spyOn(store, "resetDirtyBaselines");
    const sceneStore = new SceneStore().hydrate(makeFile("Previous"));
    const authority = new SceneRuntimeEditCoordinator({
      sceneStore,
      history: new SceneHistory(),
      setSelection: (ids) => sceneStore.setSelection(ids),
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    });
    const canvas = makeCanvas(events);
    vi.mocked(canvas.replaceDocument).mockImplementation((file, token, finalizeReplacement) => {
      const callerFinalizerInvoked = authority.replaceDocument(file, {
        token,
        prepare: () => {},
        finalizeReplacement,
      });
      return { callerFinalizerInvoked };
    });
    const replacement = createDesignSessionReplacement({
      store,
      workflowRunner: makeWorkflowRunner(events),
    });
    const input = {
      file: makeFile("Recovered"),
      kind: "loaded" as const,
      path: "/recovered.canopi",
      name: "Recovered",
    };

    expect(() => replacement.replace(input, canvas, () => true))
      .toThrow("Design identity publication failed");
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: "Intervening field note",
    }));

    const receipt = replacement.replace(input, canvas, () => true);

    expect(replaceState).toHaveBeenCalledOnce();
    expect(resetBaselines).toHaveBeenCalledOnce();
    expect(receipt.file?.description).toBe("Intervening field note");
    expect(store.readCurrentDesign()?.description).toBe("Intervening field note");
    expect(store.isDesignDirty()).toBe(true);
  });

  it.each([
    "canvas chrome",
    "canvas zoom",
    "workflow installation",
  ] as const)("resumes after %s fails without replacing the applied Design", (failureStage) => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    const canvas = makeCanvas(events);
    const workflowRunner = makeWorkflowRunner(events);
    let failures = 1;
    if (failureStage === "canvas chrome") {
      vi.mocked(canvas.showCanvasChrome).mockImplementation(() => {
        events.push("canvas.show-chrome");
        if (failures > 0) {
          failures -= 1;
          throw new Error("canvas chrome publication failed");
        }
      });
    } else if (failureStage === "canvas zoom") {
      vi.mocked(canvas.zoomToFit).mockImplementation(() => {
        events.push("canvas.zoom-to-fit");
        if (failures > 0) {
          failures -= 1;
          throw new Error("canvas zoom publication failed");
        }
      });
    } else {
      vi.mocked(workflowRunner.install).mockImplementation(() => {
        events.push("workflow.install");
        if (failures > 0) {
          failures -= 1;
          throw new Error("workflow installation failed");
        }
      });
    }
    const replacement = createDesignSessionReplacement({ store, workflowRunner });
    const input = {
      file: makeFile("Recovered"),
      kind: "loaded" as const,
      path: "/recovered.canopi",
      name: "Recovered",
    };

    expect(() => replacement.replace(input, canvas, () => true)).toThrow("failed");
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: "Intervening field note",
    }));

    const receipt = replacement.replace(input, canvas, () => true);

    expect(canvas.replaceDocument).toHaveBeenCalledOnce();
    expect(canvas.showCanvasChrome).toHaveBeenCalledTimes(
      failureStage === "canvas chrome" ? 2 : 1,
    );
    expect(canvas.zoomToFit).toHaveBeenCalledTimes(
      failureStage === "canvas zoom" ? 2 : 1,
    );
    expect(workflowRunner.install).toHaveBeenCalledTimes(
      failureStage === "workflow installation" ? 2 : 1,
    );
    expect(receipt.file?.description).toBe("Intervening field note");
    expect(store.readCurrentDesign()?.description).toBe("Intervening field note");
    expect(store.isDesignDirty()).toBe(true);
  });

  it("resumes detached workflow installation without replacing the applied Design", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    const replaceState = vi.spyOn(store, "replaceCurrentDesignState");
    const resetBaselines = vi.spyOn(store, "resetDirtyBaselines");
    const workflowRunner = makeWorkflowRunner(events);
    let workflowFailures = 1;
    vi.mocked(workflowRunner.install).mockImplementation(() => {
      events.push("workflow.install");
      if (workflowFailures > 0) {
        workflowFailures -= 1;
        throw new Error("workflow installation failed");
      }
    });
    const replacement = createDesignSessionReplacement({ store, workflowRunner });
    const input = {
      file: makeFile("Recovered"),
      kind: "loaded" as const,
      path: "/recovered.canopi",
      name: "Recovered",
    };

    expect(() => replacement.replace(input, null, () => true)).toThrow("workflow installation failed");
    editDesignSessionForTest(store, (design) => ({
      ...design,
      description: "Intervening field note",
    }));

    const receipt = replacement.replace(input, null, () => true);

    expect(replaceState).toHaveBeenCalledOnce();
    expect(resetBaselines).toHaveBeenCalledOnce();
    expect(workflowRunner.install).toHaveBeenCalledTimes(2);
    expect(receipt.file?.description).toBe("Intervening field note");
    expect(store.readCurrentDesign()?.description).toBe("Intervening field note");
    expect(store.isDesignDirty()).toBe(true);
  });

  it("preserves a Scene command admitted when hydration releases", () => {
    const events: string[] = [];
    const store = createMemoryDesignSessionStore({
      file: makeFile("Previous"),
      path: "/previous.canopi",
      name: "Previous",
    });
    const sceneStore = new SceneStore().hydrate(makeFile("Previous"));
    const authority = new SceneRuntimeEditCoordinator({
      sceneStore,
      history: new SceneHistory({
        reportCleanState: (clean) => store.setCanvasClean(clean),
      }),
      setSelection: (ids) => sceneStore.setSelection(ids),
      incrementSceneRevision: () => {},
      syncCanvasSignalsFromScene: () => {},
      invalidate: () => {},
    });
    const canvas = makeCanvas(events);
    vi.mocked(canvas.replaceDocument).mockImplementation((file, token, finalizeReplacement) => {
      events.push("canvas.replace");
      const callerFinalizerInvoked = authority.replaceDocument(file, {
        token,
        prepare: () => {},
        finalizeReplacement,
      });
      return { callerFinalizerInvoked };
    });
    let admitOnRelease = false;
    let attemptingAdmission = false;
    const dispose = effect(() => {
      void authority.revision.value;
      if (!admitOnRelease || attemptingAdmission) return;
      attemptingAdmission = true;
      try {
        const committed = authority.run("release-observer-edit", (tx) => {
          tx.mutate((draft) => {
            draft.plantSpeciesColors["Malus domestica"] = "#335577";
          });
        });
        if (committed) admitOnRelease = false;
      } finally {
        attemptingAdmission = false;
      }
    });
    const replacement = createDesignSessionReplacement({
      store,
      workflowRunner: makeWorkflowRunner(events),
    });
    admitOnRelease = true;

    try {
      replacement.replace({
        file: makeFile("Next"),
        kind: "loaded",
        path: "/next.canopi",
        name: "Next",
      }, canvas, () => true);

      expect(authority.canUndo.value).toBe(true);
      expect(store.isCanvasDirty()).toBe(true);
      expect(store.isDesignDirty()).toBe(true);
      expect(sceneStore.persisted.plantSpeciesColors["Malus domestica"])
        .toBe("#335577");
      expect(authority.undo()).toBe(true);
      expect(store.isCanvasDirty()).toBe(false);
      expect(sceneStore.persisted.plantSpeciesColors["Malus domestica"])
        .toBeUndefined();
    } finally {
      dispose();
    }
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
    presented: signal(true),
    attachInspectionTo: () => { throw new Error('Inspection is not used by this fixture.') },
    showCanvasChrome: vi.fn(() => events.push("canvas.show-chrome")),
    hideCanvasChrome: vi.fn(() => events.push("canvas.hide-chrome")),
    zoomToFit: vi.fn(() => events.push("canvas.zoom-to-fit")),
    loadDocument: vi.fn(() => {
      events.push("canvas.load");
      loaded = true;
    }),
    replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
      events.push("canvas.replace");
      loaded = true;
      finalizeReplacement();
      return { callerFinalizerInvoked: true };
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    captureForPersistence: vi.fn((_metadata, document) => ({
      content: document,
      isCurrent: () => true,
      acknowledgeSaved: () => "applied" as const,
    })),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeFile(name: string): CanopiFile {
  return {
    version: 9,
    name,
    description: null,
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
