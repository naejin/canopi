import { effect } from "@preact/signals";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installConsortiumSync: vi.fn(),
  autosaveDesign: vi.fn(),
  loadDesign: vi.fn(),
  message: vi.fn(),
  saveDesign: vi.fn(),
  saveDesignAs: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: mocks.message,
}));

vi.mock("../ipc/design", () => ({
  loadDesign: mocks.loadDesign,
  autosaveDesign: mocks.autosaveDesign,
  saveDesign: mocks.saveDesign,
  saveDesignAs: mocks.saveDesignAs,
  openDesignDialog: vi.fn(),
  newDesign: vi.fn(),
}));

vi.mock("../i18n", () => ({
  t: (key: string) => {
    switch (key) {
      case "canvas.file.save":
        return "Save";
      case "canvas.file.dontSave":
        return "Don't Save";
      case "canvas.file.cancel":
        return "Cancel";
      case "canvas.file.unsavedChanges":
        return "Unsaved changes";
      default:
        return key;
    }
  },
}));

vi.mock("../app/document-session/workflows", () => ({
  DESIGN_SESSION_WORKFLOWS: [{
    id: "consortium-sync",
    install: mocks.installConsortiumSync,
  }],
}));

import {
  CanvasAuthorityBusyError,
  CanvasDocumentReplacementNotAdmittedError,
  type CanvasDocumentSurface,
} from "../canvas/runtime/runtime";
import { SceneHistory } from "../canvas/runtime/scene-history";
import { SceneStore } from "../canvas/runtime/scene";
import { SceneRuntimeEditCoordinator } from "../canvas/runtime/scene-runtime/transactions";
import { setCurrentCanvasSession } from "../canvas/session";
import { createTestCanvasRuntimeSurfaces } from "./support/canvas-runtime-surfaces";
import {
  createDesignSessionStateMachine,
  type DesignSessionStateMachine,
  type DocumentTransitionLoadResult,
  type DocumentTransitionResult,
} from "../app/document-session/state-machine";
import { createDesignSessionPersistence } from "../app/document-session/persistence";
import {
  createMemoryDesignSessionStore,
  type PersistenceCapableDesignSessionStore,
} from "../app/document-session/store";
import type { CanopiFile } from "../types/design";

let store: PersistenceCapableDesignSessionStore;
let machine: DesignSessionStateMachine;

function makeFile(name: string): CanopiFile {
  return {
    version: 1,
    name,
    description: null,
    location: null,
    north_bearing_deg: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: "2026-04-28T00:00:00.000Z",
    updated_at: "2026-04-28T00:00:00.000Z",
    extra: {},
  };
}

function makeSession(): CanvasDocumentSurface {
  let loaded = false;
  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn(() => {
      loaded = true;
    }),
    replaceDocument: vi.fn((_file, _token, finalizeReplacement) => {
      loaded = true;
      finalizeReplacement();
      return { callerFinalizerInvoked: true };
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    captureForPersistence: vi.fn((metadata, doc) => ({
      content: { ...doc, name: metadata.name },
      isCurrent: vi.fn(() => true),
      acknowledgeSaved: vi.fn(() => "applied" as const),
    })),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function makeSettledSceneSession(
  file: CanopiFile,
  history = new SceneHistory(),
): CanvasDocumentSurface {
  const sceneStore = new SceneStore(file);
  const authority = new SceneRuntimeEditCoordinator({
    sceneStore,
    history,
    setSelection: (ids) => sceneStore.setSelection(ids),
    incrementSceneRevision: () => {},
    syncCanvasSignalsFromScene: () => {},
    invalidate: () => {},
  });
  let loaded = true;
  let settling = false;

  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn((nextFile) => {
      settling = true;
      authority.hydrate(nextFile);
      loaded = true;
      settling = false;
    }),
    replaceDocument: vi.fn((nextFile, token, finalizeReplacement) => {
      settling = true;
      const callerFinalizerInvoked = authority.replaceDocument(nextFile, {
        token,
        prepare: () => {},
        finalizeReplacement,
      });
      loaded = true;
      settling = false;
      return { callerFinalizerInvoked };
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    captureForPersistence: vi.fn((metadata, document) => {
      if (settling) throw new CanvasAuthorityBusyError("document-settlement");
      const capture = authority.capturePersistence();
      return {
        content: { ...document, name: metadata.name },
        isCurrent: () => capture.isCurrent(),
        acknowledgeSaved: () => capture.acknowledgeSaved(),
      };
    }),
    resize: vi.fn(),
    destroy: vi.fn(() => authority.disposePersistence()),
  };
}

function makePostFinalizerFailureSession(): CanvasDocumentSurface {
  let settling = false;
  let acceptedToken: object | null = null;
  let retainedFinalizer: (() => void) | null = null;
  return {
    initializeViewport: vi.fn(),
    attachRulersTo: vi.fn(),
    showCanvasChrome: vi.fn(),
    hideCanvasChrome: vi.fn(),
    zoomToFit: vi.fn(),
    loadDocument: vi.fn(),
    replaceDocument: vi.fn((_file, token, finalizeReplacement) => {
      settling = true;
      if (!acceptedToken) {
        acceptedToken = token;
        retainedFinalizer = finalizeReplacement;
        finalizeReplacement();
        throw new Error("post-finalizer Scene publication failed");
      }
      expect(token).toBe(acceptedToken);
      retainedFinalizer?.();
      settling = false;
      return { callerFinalizerInvoked: false };
    }),
    hasLoadedDocument: vi.fn(() => true),
    captureForPersistence: vi.fn((metadata, document) => {
      if (settling) throw new CanvasAuthorityBusyError("document-settlement");
      return {
        content: { ...document, name: metadata.name },
        isCurrent: () => true,
        acknowledgeSaved: () => "applied" as const,
      };
    }),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function resetMachine({
  file = makeFile("Current"),
  path = "/designs/current.canopi",
  name = "Current",
}: {
  file?: CanopiFile | null;
  path?: string | null;
  name?: string;
} = {}): void {
  store = createMemoryDesignSessionStore({ file, path, name });
  machine = createDesignSessionStateMachine({ store });
}

beforeEach(() => {
  setCurrentCanvasSession(null);
  mocks.installConsortiumSync.mockClear();
  mocks.autosaveDesign.mockReset();
  mocks.autosaveDesign.mockResolvedValue(undefined);
  mocks.loadDesign.mockReset();
  mocks.message.mockReset();
  mocks.saveDesign.mockReset();
  mocks.saveDesign.mockResolvedValue("/designs/current.canopi");
  mocks.saveDesignAs.mockReset();

  resetMachine();
});

describe("document session transition", () => {
  it("applies a discarded open-path replacement through the full post-load sequence", async () => {
    const session = makeSession();
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Don't Save");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load: async () => ({
        file: makeFile("Next"),
        path: "/designs/next.canopi",
        name: "Next",
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: true });
    expect(mocks.saveDesign).not.toHaveBeenCalled();
    expect(session.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Next", extra: {} }),
      expect.any(Object),
      expect.any(Function),
    );
    expect(session.loadDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.name).toBe("Next");
    expect(store.readDesignName()).toBe("Next");
    expect(store.readDesignPath()).toBe("/designs/next.canopi");
    expect(store.designDirty.value).toBe(false);
    expect(session.showCanvasChrome).toHaveBeenCalledTimes(1);
    expect(session.zoomToFit).toHaveBeenCalledTimes(1);
    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
  });

  it("exposes loading and attached-ready states around attached transitions", async () => {
    const session = makeSession();
    const pending = deferred<DocumentTransitionLoadResult>();

    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => pending.promise,
    });

    expect(machine.getState()).toMatchObject({
      status: "loading",
      attached: true,
      documentLoaded: false,
      operation: "open-path",
    });

    pending.resolve({
      file: makeFile("Next"),
      path: "/designs/next.canopi",
      name: "Next",
    });

    await transition;

    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      attached: true,
      documentLoaded: true,
      operation: null,
    });
  });

  it("does not apply an attached transition after teardown releases its Canvas lease", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    const pending = deferred<DocumentTransitionLoadResult>();
    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => pending.promise,
    });

    machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    });
    pending.resolve({
      file: makeFile("Late replacement"),
      path: "/designs/late.canopi",
      name: "Late replacement",
    });

    await expect(transition).resolves.toMatchObject({ status: "cancelled" });
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readDesignName()).toBe("Current");
    expect(mocks.installConsortiumSync).not.toHaveBeenCalled();
    expect(machine.getState()).toMatchObject({
      status: "detached-ready",
      attached: false,
      operation: null,
    });
  });

  it("safely aborts an unpublished failed initial hydration so a later Canvas can mount", async () => {
    const firstSession = makeSession();
    const loadFirstDocument = vi.mocked(firstSession.loadDocument).getMockImplementation()!;
    vi.mocked(firstSession.loadDocument).mockImplementationOnce((file) => {
      loadFirstDocument(file);
      throw new Error("late initial hydration publication failed");
    });
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    };
    const persistence = createDesignSessionPersistence({ store });
    machine = createDesignSessionStateMachine({ store, persistence, workflowRunner });

    await expect(machine.startAttachedDesignSession(firstSession)).resolves.toMatchObject({
      status: "failed",
      documentLoaded: true,
    });
    expect(persistence.isCanvasAttached(firstSession)).toBe(true);

    machine.teardownAttachedDesignSession({
      session: firstSession,
      runtimeInitialized: false,
      logError: vi.fn(),
    });

    expect(persistence.isCanvasAttached(firstSession)).toBe(false);
    const successor = makeSession();
    await expect(machine.startAttachedDesignSession(successor)).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(successor.loadDocument).toHaveBeenCalledOnce();
  });

  it("mounts the current Scene before a same-turn non-canvas Design edit", async () => {
    const session = makeSession();

    const mounting = machine.startAttachedDesignSession(session);
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Field note published while mount returns",
    }));

    await expect(mounting).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(session.loadDocument).toHaveBeenCalledOnce();
    expect(store.readCurrentDesign()?.description).toBe(
      "Field note published while mount returns",
    );
    expect(store.isDesignDirty()).toBe(true);
  });

  it("rejects a detached replacement while a Canvas still owns the session", async () => {
    const session = makeSession();
    machine.beginEmptyDocumentSession(session);
    const load = vi.fn(async () => ({
      file: makeFile("Detached replacement"),
      path: "/designs/detached.canopi",
      name: "Detached replacement",
    }));

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session: null,
      load,
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(load).not.toHaveBeenCalled();
    expect(store.readDesignName()).toBe("Current");
  });

  it("lets only the latest attached transition replace the Design", async () => {
    const session = makeSession();
    const firstPending = deferred<DocumentTransitionLoadResult>();
    const secondPending = deferred<DocumentTransitionLoadResult>();
    const first = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => firstPending.promise,
    });
    const second = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => secondPending.promise,
    });

    secondPending.resolve({
      file: makeFile("Second"),
      path: "/designs/second.canopi",
      name: "Second",
    });
    await expect(second).resolves.toMatchObject({ status: "applied" });
    firstPending.resolve({
      file: makeFile("First"),
      path: "/designs/first.canopi",
      name: "First",
    });

    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    expect(store.readDesignName()).toBe("Second");
    expect(store.readDesignPath()).toBe("/designs/second.canopi");
    expect(session.replaceDocument).toHaveBeenCalledOnce();
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      operation: null,
    });
  });

  it("reports an applied transition when its Design publication starts a successor", async () => {
    const session = makeSession();
    const successorLoad = deferred<DocumentTransitionLoadResult>();
    let successorTransition: Promise<DocumentTransitionResult> | null = null;
    const disposeEffect = effect(() => {
      if (store.currentDesign.value?.name !== "First" || successorTransition) return;
      successorTransition = machine.transitionDocument({
        source: "open-path",
        dirtyGuard: "skip",
        session,
        load: () => successorLoad.promise,
      });
    });

    const first = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("First"),
        path: "/designs/first.canopi",
        name: "First",
      }),
    });

    expect(first).toEqual({ status: "applied", documentLoaded: true });
    expect(successorTransition).not.toBeNull();
    expect(machine.getState()).toMatchObject({
      status: "loading",
      operation: "open-path",
    });

    const successorError = new Error("Successor failed");
    successorLoad.reject(successorError);
    await expect(successorTransition!).resolves.toEqual({
      status: "failed",
      documentLoaded: true,
      error: successorError,
    });
    expect(store.readDesignName()).toBe("First");
    expect(store.readDesignPath()).toBe("/designs/first.canopi");
    disposeEffect();
  });

  it("admits a reactive successor after the predecessor Scene replacement settles", async () => {
    const session = makeSettledSceneSession(makeFile("Current"));
    const successorPending = deferred<DocumentTransitionLoadResult>();
    const successorLoad = vi.fn(() => successorPending.promise);
    let successorTransition: Promise<DocumentTransitionResult> | null = null;
    const disposeEffect = effect(() => {
      if (store.currentDesign.value?.name !== "First" || successorTransition) return;
      successorTransition = machine.transitionDocument({
        source: "open-path",
        dirtyGuard: "skip",
        session,
        load: successorLoad,
      });
    });

    try {
      await expect(machine.transitionDocument({
        source: "open-path",
        dirtyGuard: "skip",
        session,
        load: async () => ({
          file: makeFile("First"),
          path: "/designs/first.canopi",
          name: "First",
        }),
      })).resolves.toEqual({ status: "applied", documentLoaded: true });

      expect(successorTransition).not.toBeNull();
      expect(successorLoad).toHaveBeenCalledOnce();

      successorPending.resolve({
        file: makeFile("Second"),
        path: "/designs/second.canopi",
        name: "Second",
      });
      await expect(successorTransition!).resolves.toEqual({
        status: "applied",
        documentLoaded: true,
      });
      expect(store.readDesignName()).toBe("Second");
    } finally {
      disposeEffect();
    }
  });

  it("retries a retained Scene replacement after late hydration publication fails", async () => {
    let cleanStateFailures = 1;
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1;
          throw new Error("clean-state publication failed");
        }
      },
    });
    const session = makeSettledSceneSession(makeFile("Current"), history);
    const request = () => machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Recovered"),
        path: "/designs/recovered.canopi",
        name: "Recovered",
      }),
    });

    await expect(request()).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ message: "clean-state publication failed" }),
    });

    await expect(request()).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(store.readDesignName()).toBe("Recovered");
    expect(session.replaceDocument).toHaveBeenCalledTimes(2);
  });

  it("resumes retained Scene settlement after Design finalization without erasing later edits", async () => {
    const session = makePostFinalizerFailureSession();
    const replaceState = vi.spyOn(store, "replaceCurrentDesignState");
    const request = () => machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Recovered"),
        path: "/designs/recovered.canopi",
        name: "Recovered",
      }),
    });

    await expect(request()).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({
        message: "post-finalizer Scene publication failed",
      }),
    });
    expect(store.readDesignName()).toBe("Recovered");
    expect(replaceState).toHaveBeenCalledOnce();

    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit made after Design finalization",
    }));

    await expect(request()).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(replaceState).toHaveBeenCalledOnce();
    expect(store.readCurrentDesign()?.description).toBe(
      "Edit made after Design finalization",
    );
    expect(session.replaceDocument).toHaveBeenCalledTimes(2);
  });

  it("does not lend a finalized replacement authorization to a different target", async () => {
    const session = makePostFinalizerFailureSession();
    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("First Target"),
        path: "/designs/first-target.canopi",
        name: "First Target",
      }),
    })).resolves.toMatchObject({ status: "failed" });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit made after First Target finalized",
    }));
    const loadSecondTarget = vi.fn(async () => ({
      file: makeFile("Second Target"),
      path: "/designs/second-target.canopi",
      name: "Second Target",
    }));

    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: loadSecondTarget,
    })).resolves.toEqual({
      status: "cancelled",
      documentLoaded: true,
    });
    expect(loadSecondTarget).toHaveBeenCalledOnce();
    expect(store.readDesignName()).toBe("First Target");
    expect(store.readCurrentDesign()?.description).toBe(
      "Edit made after First Target finalized",
    );
    expect(session.replaceDocument).toHaveBeenCalledTimes(2);
  });

  it("prompts before a different target can supersede a finalized replacement", async () => {
    const session = makePostFinalizerFailureSession();
    await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("First Target"),
        path: "/designs/first-target.canopi",
        name: "First Target",
      }),
    });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit requiring a fresh decision",
    }));
    mocks.message.mockResolvedValueOnce("Cancel");
    const loadSecondTarget = vi.fn(async () => ({
      file: makeFile("Second Target"),
      path: "/designs/second-target.canopi",
      name: "Second Target",
    }));

    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load: loadSecondTarget,
    })).resolves.toEqual({
      status: "cancelled",
      documentLoaded: true,
    });
    expect(mocks.message).toHaveBeenCalledOnce();
    expect(loadSecondTarget).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.description).toBe(
      "Edit requiring a fresh decision",
    );
    expect(session.replaceDocument).toHaveBeenCalledOnce();
  });

  it("settles a pending replacement before teardown without erasing newer Design edits", async () => {
    let settling = false;
    let acceptedToken: object | null = null;
    let retainedFinalizer: (() => void) | null = null;
    const session: CanvasDocumentSurface = {
      initializeViewport: vi.fn(),
      attachRulersTo: vi.fn(),
      showCanvasChrome: vi.fn(),
      hideCanvasChrome: vi.fn(),
      zoomToFit: vi.fn(),
      loadDocument: vi.fn(),
      replaceDocument: vi.fn((_file, token, finalizeReplacement) => {
        settling = true;
        if (!acceptedToken) {
          acceptedToken = token;
          retainedFinalizer = finalizeReplacement;
          throw new Error("pre-finalizer Scene publication failed");
        }
        expect(token).toBe(acceptedToken);
        retainedFinalizer?.();
        settling = false;
        return { callerFinalizerInvoked: false };
      }),
      hasLoadedDocument: vi.fn(() => true),
      captureForPersistence: vi.fn((metadata, document) => {
        if (settling) throw new CanvasAuthorityBusyError("document-settlement");
        return {
          content: { ...document, name: metadata.name },
          isCurrent: () => true,
          acknowledgeSaved: () => "applied" as const,
        };
      }),
      resize: vi.fn(),
      destroy: vi.fn(),
    };

    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Replacement"),
        path: "/designs/replacement.canopi",
        name: "Replacement",
      }),
    })).resolves.toMatchObject({ status: "failed" });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Field note added after replacement failed",
    }));

    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    })).not.toThrow();
    expect(store.readDesignName()).toBe("Current");
    expect(store.readCurrentDesign()?.description).toBe(
      "Field note added after replacement failed",
    );

    const successor = makeSession();
    await expect(machine.startAttachedDesignSession(successor)).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(successor.loadDocument).toHaveBeenCalledOnce();
  });

  it("hands off the old Scene after a replacement was rejected before hydration", async () => {
    let sceneColor: string | undefined;
    const preparationError = new Error("replacement preparation failed");
    const replaceDocument = vi.fn(() => {
      throw new CanvasDocumentReplacementNotAdmittedError(preparationError);
    });
    const session: CanvasDocumentSurface = {
      initializeViewport: vi.fn(),
      attachRulersTo: vi.fn(),
      showCanvasChrome: vi.fn(),
      hideCanvasChrome: vi.fn(),
      zoomToFit: vi.fn(),
      loadDocument: vi.fn(),
      replaceDocument,
      hasLoadedDocument: vi.fn(() => true),
      captureForPersistence: vi.fn((_metadata, document) => ({
        content: {
          ...document,
          plant_species_colors: sceneColor
            ? { "Malus domestica": sceneColor }
            : {},
        },
        isCurrent: () => true,
        acknowledgeSaved: () => "applied" as const,
      })),
      resize: vi.fn(),
      destroy: vi.fn(),
    };

    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Rejected Target"),
        path: "/designs/rejected.canopi",
        name: "Rejected Target",
      }),
    })).resolves.toMatchObject({
      status: "failed",
      error: preparationError,
    });

    sceneColor = "#335577";
    store.setCanvasClean(false);
    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    })).not.toThrow();

    expect(replaceDocument).toHaveBeenCalledOnce();
    expect(store.readDesignName()).toBe("Current");
    expect(store.readCurrentDesign()?.plant_species_colors)
      .toEqual({ "Malus domestica": "#335577" });
    const successor = makeSession();
    await expect(machine.startAttachedDesignSession(successor)).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(successor.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Current",
        plant_species_colors: { "Malus domestica": "#335577" },
      }),
    );
  });

  it("settles an admitted replacement before tearing down an initially empty session", async () => {
    resetMachine({ file: null, path: null, name: "Untitled" });
    let settling = false;
    let acceptedToken: object | null = null;
    let retainedFinalizer: (() => void) | null = null;
    const session: CanvasDocumentSurface = {
      initializeViewport: vi.fn(),
      attachRulersTo: vi.fn(),
      showCanvasChrome: vi.fn(),
      hideCanvasChrome: vi.fn(),
      zoomToFit: vi.fn(),
      loadDocument: vi.fn(),
      replaceDocument: vi.fn((_file, token, finalizeReplacement) => {
        settling = true;
        if (!acceptedToken) {
          acceptedToken = token;
          retainedFinalizer = finalizeReplacement;
          throw new Error("pre-finalizer Scene publication failed");
        }
        expect(token).toBe(acceptedToken);
        retainedFinalizer?.();
        settling = false;
        return { callerFinalizerInvoked: false };
      }),
      hasLoadedDocument: vi.fn(() => true),
      captureForPersistence: vi.fn((metadata, document) => {
        if (settling) throw new CanvasAuthorityBusyError("document-settlement");
        return {
          content: { ...document, name: metadata.name },
          isCurrent: () => true,
          acknowledgeSaved: () => "applied" as const,
        };
      }),
      resize: vi.fn(),
      destroy: vi.fn(),
    };

    await expect(machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("First Document"),
        path: "/designs/first.canopi",
        name: "First Document",
      }),
    })).resolves.toMatchObject({ status: "failed" });
    expect(store.hasCurrentDesign()).toBe(false);

    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    })).not.toThrow();
    expect(store.readDesignName()).toBe("First Document");

    const successor = makeSession();
    await expect(machine.startAttachedDesignSession(successor)).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(successor.loadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "First Document" }),
    );
  });

  it("does not let a retained Scene replacement erase a newer Design edit without confirmation", async () => {
    let cleanStateFailures = 1;
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1;
          throw new Error("clean-state publication failed");
        }
      },
    });
    const session = makeSettledSceneSession(makeFile("Current"), history);
    const transition = () => machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load: async () => ({
        file: makeFile("Recovered"),
        path: "/designs/recovered.canopi",
        name: "Recovered",
      }),
    });

    await expect(transition()).resolves.toMatchObject({ status: "failed" });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit made after failed replacement",
    }));
    mocks.message.mockResolvedValueOnce("Cancel");

    await expect(transition()).resolves.toEqual({
      status: "cancelled",
      documentLoaded: true,
    });
    expect(store.readCurrentDesign()?.description).toBe(
      "Edit made after failed replacement",
    );
    expect(store.readDesignName()).toBe("Current");
    expect(session.replaceDocument).toHaveBeenCalledOnce();

    mocks.message.mockResolvedValueOnce("Don't Save");
    await expect(transition()).resolves.toEqual({
      status: "applied",
      documentLoaded: true,
    });
    expect(store.readDesignName()).toBe("Recovered");
  });

  it("cancels a retained replacement when Design changes while its retry load awaits", async () => {
    let cleanStateFailures = 1;
    const history = new SceneHistory({
      reportCleanState: () => {
        if (cleanStateFailures > 0) {
          cleanStateFailures -= 1;
          throw new Error("clean-state publication failed");
        }
      },
    });
    const session = makeSettledSceneSession(makeFile("Current"), history);
    const immediateLoad = async () => ({
      file: makeFile("Recovered"),
      path: "/designs/recovered.canopi",
      name: "Recovered",
    });
    await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: immediateLoad,
    });
    const retryLoad = deferred<DocumentTransitionLoadResult>();
    const retry = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => retryLoad.promise,
    });
    await flushMicrotasks();
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit made during retry load",
    }));
    retryLoad.resolve(await immediateLoad());

    await expect(retry).resolves.toEqual({
      status: "cancelled",
      documentLoaded: true,
    });
    expect(store.readCurrentDesign()?.description).toBe("Edit made during retry load");
    expect(session.replaceDocument).toHaveBeenCalledOnce();
  });

  it("lets only the latest detached transition replace the Design", async () => {
    const firstPending = deferred<DocumentTransitionLoadResult>();
    const secondPending = deferred<DocumentTransitionLoadResult>();
    const first = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session: null,
      load: () => firstPending.promise,
    });
    const second = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session: null,
      load: () => secondPending.promise,
    });

    secondPending.resolve({
      file: makeFile("Detached Second"),
      path: "/designs/detached-second.canopi",
      name: "Detached Second",
    });
    await expect(second).resolves.toMatchObject({ status: "applied" });
    firstPending.resolve({
      file: makeFile("Detached First"),
      path: "/designs/detached-first.canopi",
      name: "Detached First",
    });

    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    expect(store.readDesignName()).toBe("Detached Second");
    expect(store.readDesignPath()).toBe("/designs/detached-second.canopi");
    expect(machine.getState()).toMatchObject({
      status: "detached-ready",
      operation: null,
    });
  });

  it("saves a dirty current document before applying the replacement", async () => {
    const session = makeSession();
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Save");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load: async () => ({
        file: makeFile("Next"),
        path: "/designs/next.canopi",
        name: "Next",
      }),
    });

    expect(result.status).toBe("applied");
    expect(mocks.saveDesign).toHaveBeenCalledWith(
      "/designs/current.canopi",
      expect.objectContaining({ name: "Current" }),
    );
    expect(store.readCurrentDesign()?.name).toBe("Next");
  });

  it("does not let a superseded dirty prompt save the successor Design", async () => {
    const session = makeSession();
    store.markDocumentDirty();
    const prompt = deferred<string>();
    mocks.message.mockReturnValue(prompt.promise);
    const stale = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load: async () => ({
        file: makeFile("Stale"),
        path: "/designs/stale.canopi",
        name: "Stale",
      }),
    });
    await flushMicrotasks();

    const successor = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Successor"),
        path: "/designs/successor.canopi",
        name: "Successor",
      }),
    });
    prompt.resolve("Save");

    expect(successor.status).toBe("applied");
    await expect(stale).resolves.toMatchObject({ status: "cancelled" });
    expect(mocks.saveDesign).not.toHaveBeenCalled();
    expect(store.readDesignName()).toBe("Successor");
  });

  it("cancels a replacement when a Design edit lands during loading", async () => {
    const session = makeSession();
    const pending = deferred<DocumentTransitionLoadResult>();
    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => pending.promise,
    });

    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edit committed while loading",
    }));
    pending.resolve({
      file: makeFile("Replacement"),
      path: "/designs/replacement.canopi",
      name: "Replacement",
    });

    await expect(transition).resolves.toMatchObject({ status: "cancelled" });
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.description).toBe("Edit committed while loading");
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      operation: null,
    });
  });

  it("cancels replacement when final Canvas guard capture reenters a Design edit", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    let captureNumber = 0;
    vi.mocked(session.captureForPersistence).mockImplementation((metadata, document) => {
      captureNumber += 1;
      const content = { ...document, name: metadata.name };
      if (captureNumber === 3) {
        store.mutateCurrentDesign((current) => ({
          ...current,
          description: "Reentrant final-guard edit",
        }));
      }
      return {
        content,
        isCurrent: () => true,
        acknowledgeSaved: vi.fn(() => "applied" as const),
      };
    });
    const pending = deferred<DocumentTransitionLoadResult>();
    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => pending.promise,
    });

    pending.resolve({
      file: makeFile("Replacement"),
      path: "/designs/replacement.canopi",
      name: "Replacement",
    });

    await expect(transition).resolves.toMatchObject({ status: "cancelled" });
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.description).toBe("Reentrant final-guard edit");
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      operation: null,
    });
  });

  it("cancels a replacement when a committed Scene edit lands during loading", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    let committedSceneVersion = 0;
    vi.mocked(session.captureForPersistence).mockImplementation((metadata, document) => ({
      content: {
        ...document,
        name: metadata.name,
        plants: committedSceneVersion === 0
          ? []
          : [{ id: "committed-during-load" } as CanopiFile["plants"][number]],
      },
      isCurrent: () => true,
      acknowledgeSaved: vi.fn(() => "applied" as const),
    }));
    const pending = deferred<DocumentTransitionLoadResult>();
    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: () => pending.promise,
    });

    committedSceneVersion = 1;
    store.setCanvasClean(false);
    pending.resolve({
      file: makeFile("Replacement"),
      path: "/designs/replacement.canopi",
      name: "Replacement",
    });

    await expect(transition).resolves.toMatchObject({ status: "cancelled" });
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.isDesignDirty()).toBe(true);
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      operation: null,
    });
  });

  it("ignores regenerated persistence timestamps when guarding replacement", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    let captureNumber = 0;
    vi.mocked(session.captureForPersistence).mockImplementation((metadata, document) => {
      captureNumber += 1;
      return {
        content: {
          ...document,
          name: metadata.name,
          updated_at: new Date(captureNumber * 1000).toISOString(),
        },
        isCurrent: () => true,
        acknowledgeSaved: vi.fn(() => "applied" as const),
      };
    });

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Replacement"),
        path: "/designs/replacement.canopi",
        name: "Replacement",
      }),
    });

    expect(result.status).toBe("applied");
    expect(session.replaceDocument).toHaveBeenCalledOnce();
  });

  it("cancels replacement when Design changes while the requested save is pending", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Save");
    const pending = deferred<string>();
    mocks.saveDesign.mockReturnValue(pending.promise);
    const load = vi.fn(async () => ({
      file: makeFile("Next"),
      path: "/designs/next.canopi",
      name: "Next",
    }));

    const transition = machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load,
    });
    await flushMicrotasks();
    expect(mocks.saveDesign).toHaveBeenCalledTimes(1);

    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edited while save was pending",
    }));
    const currentAfterEdit = store.readCurrentDesign();
    pending.resolve("/designs/current.canopi");

    await expect(transition).resolves.toEqual({
      status: "cancelled",
      documentLoaded: true,
    });
    expect(load).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()).toBe(currentAfterEdit);
    expect(store.readCurrentDesign()?.description).toBe("Edited while save was pending");
    expect(store.isDesignDirty()).toBe(true);
  });

  it("acknowledges the captured save without replacing edits made during I/O", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    store.markDocumentDirty();
    const pending = deferred<string>();
    mocks.saveDesign.mockReturnValue(pending.promise);

    const saving = machine.saveCurrentDesign({ session });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Edited while save was pending",
    }));
    const currentAfterEdit = store.readCurrentDesign();

    pending.resolve("/designs/current.canopi");
    const settlement = await saving;

    expect(settlement).toMatchObject({
      status: "applied",
      path: "/designs/current.canopi",
      content: { name: "Current", description: null },
    });
    expect(store.readCurrentDesign()).toBe(currentAfterEdit);
    expect(store.readCurrentDesign()?.description).toBe("Edited while save was pending");
    expect(store.isDesignDirty()).toBe(true);
  });

  it("retries exact settlement without rewriting after persistence publication fails", async () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    const acknowledgeSaved = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("clean publication failed");
      })
      .mockReturnValue("applied" as const);
    vi.mocked(session.captureForPersistence).mockImplementation((metadata, doc) => ({
      content: { ...doc, name: metadata.name },
      isCurrent: () => true,
      acknowledgeSaved,
    }));
    store.markDocumentDirty();

    await expect(machine.saveCurrentDesign({ session })).resolves.toMatchObject({
      status: "applied",
    });
    expect(mocks.saveDesign).toHaveBeenCalledOnce();
    expect(acknowledgeSaved).toHaveBeenCalledTimes(2);
    expect(store.isDesignDirty()).toBe(false);
  });

  it("applies only the Save As path while preserving later Design state and name", async () => {
    const pending = deferred<string>();
    mocks.saveDesignAs.mockReturnValue(pending.promise);

    const saving = machine.saveAsCurrentDesign({ session: null });
    store.mutateCurrentDesign((design) => ({
      ...design,
      description: "Later field note",
    }));
    store.renameCurrentDesign("Later Name");
    const currentAfterEdits = store.readCurrentDesign();

    pending.resolve("/designs/saved-snapshot.canopi");
    const settlement = await saving;

    expect(settlement).toMatchObject({
      status: "applied",
      path: "/designs/saved-snapshot.canopi",
      content: { name: "Current", description: null },
    });
    expect(store.readCurrentDesign()).toBe(currentAfterEdits);
    expect(store.readCurrentDesign()).toMatchObject({
      name: "Later Name",
      description: "Later field note",
    });
    expect(store.readDesignName()).toBe("Later Name");
    expect(store.readDesignPath()).toBe("/designs/saved-snapshot.canopi");
    expect(store.isDesignDirty()).toBe(true);
  });

  it("cancels before loading and preserves dirty baselines", async () => {
    const session = makeSession();
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Cancel");
    const load = vi.fn(async () => ({
      file: makeFile("Next"),
      path: "/designs/next.canopi",
      name: "Next",
    }));

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load,
    });

    expect(result).toEqual({ status: "cancelled", documentLoaded: false });
    expect(load).not.toHaveBeenCalled();
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.name).toBe("Current");
    expect(store.designDirty.value).toBe(true);
  });

  it("cancels after an async load without replacing state or dirty baselines", async () => {
    const session = makeSession();
    store.markDocumentDirty();

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Next"),
        path: "/designs/next.canopi",
        name: "Next",
      }),
      isCancelled: () => true,
    });

    expect(result).toEqual({ status: "cancelled", documentLoaded: false });
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()?.name).toBe("Current");
    expect(store.designDirty.value).toBe(true);
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      attached: true,
      operation: null,
    });
  });

  it("records failed transition state with the failing operation", async () => {
    const session = makeSession();
    const error = new Error("Disk read failed");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "skip",
      session,
      load: async () => {
        throw error;
      },
    });

    expect(result).toEqual({
      status: "failed",
      documentLoaded: false,
      error,
    });
    expect(machine.getState()).toMatchObject({
      status: "failed",
      attached: true,
      documentLoaded: false,
      operation: "open-path",
      error,
    });
  });

  it("exposes autosaving state while autosave is in flight", async () => {
    const session = makeSession();
    const pending = deferred<void>();
    const logError = vi.fn();
    store.markDocumentDirty();
    mocks.autosaveDesign.mockReturnValue(pending.promise);

    const autosave = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    });

    expect(machine.getState()).toMatchObject({
      status: "autosaving",
      attached: true,
      operation: "autosave",
    });

    pending.resolve(undefined);
    await autosave;

    expect(mocks.autosaveDesign).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Current" }),
      "/designs/current.canopi",
    );
    expect(logError).not.toHaveBeenCalled();
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      attached: true,
      operation: null,
    });
  });

  it("lets only the latest overlapping autosave outcome publish recovery status", async () => {
    const session = makeSession();
    const firstPending = deferred<void>();
    const secondPending = deferred<void>();
    const logError = vi.fn();
    store.markDocumentDirty();
    mocks.autosaveDesign
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);

    const first = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    });
    const second = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    });

    secondPending.reject(new Error("latest autosave failed"));
    await expect(second).resolves.toBe(false);
    expect(store.autosaveFailed.value).toBe(true);

    firstPending.resolve(undefined);
    await expect(first).resolves.toBe(false);
    expect(store.autosaveFailed.value).toBe(true);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("retries recovery settlement without repeating autosave I/O", async () => {
    const session = makeSession();
    const logError = vi.fn();
    const persistence = createDesignSessionPersistence({ store });
    const recovery = {
      content: makeFile("Current"),
      destinationHint: "/designs/current.canopi",
      succeed: vi.fn()
        .mockImplementationOnce(() => {
          throw new Error("recovery publication failed");
        })
        .mockReturnValue(true),
      fail: vi.fn(),
    };
    vi.spyOn(persistence, "beginRecovery").mockReturnValue(recovery);
    machine = createDesignSessionStateMachine({ store, persistence });
    store.markDocumentDirty();

    await expect(machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    })).resolves.toBe(true);

    expect(mocks.autosaveDesign).toHaveBeenCalledOnce();
    expect(recovery.succeed).toHaveBeenCalledTimes(2);
    expect(recovery.fail).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("keeps the latest autosave operation visible when an older one settles first", async () => {
    const session = makeSession();
    const firstPending = deferred<void>();
    const secondPending = deferred<void>();
    store.markDocumentDirty();
    mocks.autosaveDesign
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);

    const first = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    });
    const second = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    });

    firstPending.resolve(undefined);
    await first;
    expect(machine.getState()).toMatchObject({
      status: "autosaving",
      operation: "autosave",
    });

    secondPending.resolve(undefined);
    await second;
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      operation: null,
    });
  });

  it("ignores an autosave failure from a replaced Design session", async () => {
    const session = makeSession();
    const pending = deferred<void>();
    const logError = vi.fn();
    store.markDocumentDirty();
    mocks.autosaveDesign.mockReturnValue(pending.promise);

    const autosave = machine.autosaveDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    });
    store.replaceCurrentDesignState(makeFile("Replacement"), null, "Replacement");
    store.resetDirtyBaselines();

    pending.reject(new Error("late autosave failure"));
    await expect(autosave).resolves.toBe(false);

    expect(store.readDesignName()).toBe("Replacement");
    expect(store.isDesignDirty()).toBe(false);
    expect(store.autosaveFailed.value).toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("applies templates as unsaved documents with their requested display name", async () => {
    const session = makeSession();

    const result = await machine.transitionDocument({
      source: "template",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: makeFile("Downloaded Template"),
        path: null,
        name: "Forest Edge",
      }),
    });

    expect(result.status).toBe("applied");
    expect(store.readCurrentDesign()?.name).toBe("Downloaded Template");
    expect(store.readDesignName()).toBe("Forest Edge");
    expect(store.readDesignPath()).toBe(null);
    expect(store.designDirty.value).toBe(false);
  });

  it("applies detached replacements without requiring a canvas session", async () => {
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Don't Save");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session: null,
      load: async () => ({
        file: makeFile("Detached Next"),
        path: "/designs/detached-next.canopi",
        name: "Detached Next",
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: false });
    expect(store.readCurrentDesign()?.name).toBe("Detached Next");
    expect(store.readDesignName()).toBe("Detached Next");
    expect(store.readDesignPath()).toBe("/designs/detached-next.canopi");
    expect(store.designDirty.value).toBe(false);
    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
  });

  it("saves dirty detached documents before applying a transition", async () => {
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Save");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session: null,
      load: async () => ({
        file: makeFile("Detached Next"),
        path: "/designs/detached-next.canopi",
        name: "Detached Next",
      }),
    });

    expect(result.status).toBe("applied");
    expect(mocks.saveDesign).toHaveBeenCalledWith(
      "/designs/current.canopi",
      expect.objectContaining({ name: "Current" }),
    );
    expect(store.readCurrentDesign()?.name).toBe("Detached Next");
  });

  it("does not use the current canvas session when a transition is explicitly detached", async () => {
    const currentSession = makeSession();
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ documents: currentSession }));
    store.markDocumentDirty();
    mocks.message.mockResolvedValue("Save");

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session: null,
      load: async () => ({
        file: makeFile("Detached Next"),
        path: "/designs/detached-next.canopi",
        name: "Detached Next",
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: false });
    expect(currentSession.captureForPersistence).not.toHaveBeenCalled();
    expect(mocks.saveDesign).toHaveBeenCalledWith(
      "/designs/current.canopi",
      expect.objectContaining({ name: "Current" }),
    );
  });

  it("queues deferrable detached transitions when no current design is loaded", async () => {
    resetMachine({ file: null, path: null, name: "Untitled" });
    const defer = vi.fn();
    const load = vi.fn(async () => ({
      file: makeFile("Queued"),
      path: "/designs/queued.canopi",
      name: "Queued",
    }));

    const result = await machine.transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session: null,
      load,
      deferWhenDetachedAndEmpty: defer,
    });

    expect(result).toEqual({ status: "queued", documentLoaded: false });
    expect(defer).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("loads an existing mounted document without replacing canonical document state", async () => {
    const session = makeSession();
    store.markDocumentDirty();
    const mounted = store.readCurrentDesign()!;

    const result = await machine.transitionDocument({
      source: "mount-existing",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: mounted,
        path: store.readDesignPath(),
        name: store.readDesignName(),
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: true });
    expect(session.loadDocument).toHaveBeenCalledWith(mounted);
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readCurrentDesign()).toBe(mounted);
    expect(store.designDirty.value).toBe(true);
    expect(session.zoomToFit).toHaveBeenCalledTimes(1);
  });

  it("consumes queued path loads, clears the queue, and reports the transition result", async () => {
    const session = makeSession();
    const results: Array<{ status: string; documentLoaded: boolean }> = [];
    store.setPendingDesignPath("/designs/queued.canopi");
    mocks.loadDesign.mockResolvedValue(makeFile("Queued"));

    const cancel = machine.consumeQueuedDocumentLoad(session, {
      onResult: (result) => results.push({ status: result.status, documentLoaded: result.documentLoaded }),
    });
    await flushMicrotasks();

    expect(mocks.loadDesign).toHaveBeenCalledWith("/designs/queued.canopi");
    expect(session.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Queued" }),
      expect.any(Object),
      expect.any(Function),
    );
    expect(store.readPendingDesignPath()).toBe(null);
    expect(results).toEqual([{ status: "applied", documentLoaded: true }]);
    cancel();
  });

  it("keeps queued failures pending and surfaces a retryable error", async () => {
    const session = makeSession();
    const queued = deferred<CanopiFile>();
    store.setPendingDesignPath("/designs/broken.canopi");
    mocks.loadDesign.mockReturnValue(queued.promise);

    machine.consumeQueuedDocumentLoad(session);
    queued.reject(new Error("Disk read failed"));
    await flushMicrotasks();

    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readPendingDesignPath()).toBe("/designs/broken.canopi");
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open broken"),
      expect.objectContaining({ title: "Open failed", kind: "error" }),
    );
  });

  it("keeps queued loads pending when teardown cancels them before apply", async () => {
    const session = makeSession();
    const queued = deferred<CanopiFile>();
    store.setPendingDesignPath("/designs/queued.canopi");
    mocks.loadDesign.mockReturnValue(queued.promise);

    const cancel = machine.consumeQueuedDocumentLoad(session);
    cancel();
    queued.resolve(makeFile("Queued"));
    await flushMicrotasks();

    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(store.readPendingDesignPath()).toBe("/designs/queued.canopi");
  });

  it("starts an empty session by installing workflows and hiding canvas chrome", () => {
    resetMachine({ file: null, path: null, name: "Untitled" });
    const session = makeSession();

    machine.beginEmptyDocumentSession(session);

    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
    expect(session.hideCanvasChrome).toHaveBeenCalledTimes(1);
    expect(session.showCanvasChrome).not.toHaveBeenCalled();
  });

  it("disposes workflow runner and persistence during attached teardown", () => {
    const session = makeSession();
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    };
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(session);
    const disposePersistence = vi.spyOn(persistence, "dispose");
    machine = createDesignSessionStateMachine({
      store,
      workflowRunner,
      persistence,
    });

    machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: false,
      logError: vi.fn(),
    });

    expect(workflowRunner.dispose).toHaveBeenCalledTimes(1);
    expect(disposePersistence).toHaveBeenCalledTimes(1);
  });

  it("keeps attached state while workflow cleanup remains retryable", () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    const cleanupFailure = new Error("workflow cleanup failed");
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn()
        .mockImplementationOnce(() => {
          throw cleanupFailure;
        })
        .mockImplementation(() => undefined),
    };
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(session);
    machine = createDesignSessionStateMachine({ store, workflowRunner, persistence });

    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: false,
      logError: vi.fn(),
    })).toThrow(cleanupFailure);

    expect(persistence.isCanvasAttached(session)).toBe(true);
    expect(machine.getState()).toMatchObject({
      status: "attached-ready",
      attached: true,
      operation: null,
    });

    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: false,
      logError: vi.fn(),
    })).not.toThrow();
    expect(machine.getState()).toMatchObject({
      status: "detached-ready",
      attached: false,
      operation: null,
    });
  });

  it("ignores stale teardown from a Canvas that no longer owns the session lease", () => {
    const staleSession = makeSession();
    const currentSession = makeSession();
    staleSession.loadDocument(makeFile("Stale"));
    currentSession.loadDocument(makeFile("Current"));
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    };
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(staleSession);
    persistence.detachCanvas(staleSession);
    persistence.attachCanvas(currentSession);
    const settleCanvasHandoff = vi.spyOn(persistence, "settleCanvasHandoff");
    const disposePersistence = vi.spyOn(persistence, "dispose");
    machine = createDesignSessionStateMachine({
      store,
      workflowRunner,
      persistence,
    });

    machine.teardownAttachedDesignSession({
      session: staleSession,
      runtimeInitialized: true,
      logError: vi.fn(),
    });

    expect(settleCanvasHandoff).not.toHaveBeenCalled();
    expect(workflowRunner.dispose).not.toHaveBeenCalled();
    expect(disposePersistence).not.toHaveBeenCalled();
  });

  it("blocks teardown when the live Canvas handoff cannot be captured", () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    };
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(session);
    vi.spyOn(persistence, "settleCanvasHandoff").mockImplementation(() => {
      throw new Error("handoff capture failed");
    });
    const disposePersistence = vi.spyOn(persistence, "dispose");
    const logError = vi.fn();
    machine = createDesignSessionStateMachine({
      store,
      workflowRunner,
      persistence,
    });

    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError,
    })).toThrow("handoff capture failed");

    expect(logError).toHaveBeenCalledWith(
      "Failed to snapshot canvas before teardown:",
      expect.any(Error),
    );
    expect(workflowRunner.dispose).not.toHaveBeenCalled();
    expect(disposePersistence).not.toHaveBeenCalled();
  });

  it("does not dispose a successor Canvas attached during handoff publication", () => {
    const session = makeSession();
    const successor = makeSession();
    session.loadDocument(makeFile("Current"));
    successor.loadDocument(makeFile("Successor"));
    const workflowRunner = {
      install: vi.fn(),
      dispose: vi.fn(),
    };
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(session);
    machine = createDesignSessionStateMachine({ store, workflowRunner, persistence });
    let replaceLeaseDuringHandoff = false;
    const disposeEffect = effect(() => {
      void store.currentDesign.value;
      if (!replaceLeaseDuringHandoff) return;
      replaceLeaseDuringHandoff = false;
      persistence.detachCanvas(session);
      persistence.attachCanvas(successor);
    });

    replaceLeaseDuringHandoff = true;
    expect(() => machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: true,
      logError: vi.fn(),
    })).toThrow("Canvas persistence lease");

    expect(persistence.isCanvasAttached(successor)).toBe(true);
    expect(workflowRunner.dispose).not.toHaveBeenCalled();
    disposeEffect();
  });

  it("recaptures Canvas handoff when snapshot publication commits a newer Scene", () => {
    const session = makeSession();
    session.loadDocument(makeFile("Current"));
    let sceneVersion = 0;
    vi.mocked(session.captureForPersistence).mockImplementation((metadata, document) => {
      const capturedVersion = sceneVersion;
      return {
        content: {
          ...document,
          name: metadata.name,
          description: `Scene version ${capturedVersion}`,
        },
        isCurrent: () => capturedVersion === sceneVersion,
        acknowledgeSaved: vi.fn(() => "applied" as const),
      };
    });
    const persistence = createDesignSessionPersistence({ store });
    persistence.attachCanvas(session);
    machine = createDesignSessionStateMachine({ store, persistence });
    let commitDuringPublication = false;
    const disposeEffect = effect(() => {
      void store.currentDesign.value;
      if (!commitDuringPublication) return;
      commitDuringPublication = false;
      sceneVersion += 1;
      store.setCanvasClean(false);
    });

    try {
      commitDuringPublication = true;
      machine.teardownAttachedDesignSession({
        session,
        runtimeInitialized: true,
        logError: vi.fn(),
      });

      expect(session.captureForPersistence).toHaveBeenCalledTimes(2);
      expect(store.readCurrentDesign()?.description).toBe("Scene version 1");
      expect(store.isDesignDirty()).toBe(true);
      expect(persistence.isCanvasAttached(session)).toBe(false);
    } finally {
      disposeEffect();
    }
  });
});
