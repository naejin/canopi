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

import type { CanvasDocumentSurface } from "../canvas/runtime/runtime";
import { setCurrentCanvasSession } from "../canvas/session";
import { createTestCanvasRuntimeSurfaces } from "./support/canvas-runtime-surfaces";
import {
  createDesignSessionStateMachine,
  type DesignSessionStateMachine,
  type DocumentTransitionLoadResult,
} from "../app/document-session/state-machine";
import {
  createMemoryDesignSessionStore,
  type DesignSessionStore,
} from "../app/document-session/store";
import type { CanopiFile } from "../types/design";

let store: DesignSessionStore;
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
    serializeDocument: vi.fn((metadata, doc) => ({ ...doc, name: metadata.name })),
    markSaved: vi.fn(),
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
    expect(session.markSaved).toHaveBeenCalledTimes(1);
    expect(store.readCurrentDesign()?.name).toBe("Next");
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
    expect(currentSession.serializeDocument).not.toHaveBeenCalled();
    expect(currentSession.markSaved).not.toHaveBeenCalled();
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
    const disposePersistence = vi.fn();
    machine = createDesignSessionStateMachine({
      store,
      workflowRunner,
      disposePersistence,
    });

    machine.teardownAttachedDesignSession({
      session,
      runtimeInitialized: false,
      logError: vi.fn(),
    });

    expect(workflowRunner.dispose).toHaveBeenCalledTimes(1);
    expect(disposePersistence).toHaveBeenCalledTimes(1);
  });
});
