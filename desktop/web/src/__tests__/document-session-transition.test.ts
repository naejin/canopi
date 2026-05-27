import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installConsortiumSync: vi.fn(),
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
  installConsortiumSync: mocks.installConsortiumSync,
  disposeConsortiumSync: vi.fn(),
}));

import type { CanvasDocumentSurface } from "../canvas/runtime/runtime";
import {
  beginEmptyDocumentSession,
  consumeQueuedDocumentLoad,
  transitionDetachedDocument,
  transitionDocument,
} from "../app/document-session/transition";
import {
  currentDesign,
  designDirty,
  designName,
  designPath,
  detachedCanvasDirty,
  nonCanvasRevision,
  pendingDesignPath,
  pendingTemplateImport,
  resetDirtyBaselines,
} from "../state/design";
import type { CanopiFile } from "../types/design";

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
    replaceDocument: vi.fn(() => {
      loaded = true;
    }),
    hasLoadedDocument: vi.fn(() => loaded),
    serializeDocument: vi.fn((metadata, doc) => ({ ...doc, name: metadata.name })),
    markSaved: vi.fn(),
    clearHistory: vi.fn(),
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

beforeEach(() => {
  mocks.installConsortiumSync.mockClear();
  mocks.loadDesign.mockReset();
  mocks.message.mockReset();
  mocks.saveDesign.mockReset();
  mocks.saveDesign.mockResolvedValue("/designs/current.canopi");
  mocks.saveDesignAs.mockReset();

  currentDesign.value = makeFile("Current");
  designName.value = "Current";
  designPath.value = "/designs/current.canopi";
  pendingDesignPath.value = null;
  pendingTemplateImport.value = null;
  resetDirtyBaselines();
  nonCanvasRevision.value = 0;
  detachedCanvasDirty.value = false;
});

describe("document session transition", () => {
  it("applies a discarded open-path replacement through the full post-load sequence", async () => {
    const session = makeSession();
    nonCanvasRevision.value = 1;
    mocks.message.mockResolvedValue("Don't Save");

    const result = await transitionDocument({
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
    expect(session.replaceDocument).toHaveBeenCalledWith(expect.objectContaining({ name: "Next", extra: {} }));
    expect(session.loadDocument).not.toHaveBeenCalled();
    expect(currentDesign.value?.name).toBe("Next");
    expect(designName.value).toBe("Next");
    expect(designPath.value).toBe("/designs/next.canopi");
    expect(designDirty.value).toBe(false);
    expect(session.clearHistory).toHaveBeenCalledTimes(1);
    expect(session.showCanvasChrome).toHaveBeenCalledTimes(1);
    expect(session.zoomToFit).toHaveBeenCalledTimes(1);
    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
  });

  it("saves a dirty current document before applying the replacement", async () => {
    const session = makeSession();
    nonCanvasRevision.value = 1;
    mocks.message.mockResolvedValue("Save");

    const result = await transitionDocument({
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
    expect(currentDesign.value?.name).toBe("Next");
  });

  it("cancels before loading and preserves dirty baselines", async () => {
    const session = makeSession();
    nonCanvasRevision.value = 1;
    mocks.message.mockResolvedValue("Cancel");
    const load = vi.fn(async () => ({
      file: makeFile("Next"),
      path: "/designs/next.canopi",
      name: "Next",
    }));

    const result = await transitionDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      session,
      load,
    });

    expect(result).toEqual({ status: "cancelled", documentLoaded: false });
    expect(load).not.toHaveBeenCalled();
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(currentDesign.value?.name).toBe("Current");
    expect(designDirty.value).toBe(true);
  });

  it("cancels after an async load without replacing state or dirty baselines", async () => {
    const session = makeSession();
    nonCanvasRevision.value = 1;

    const result = await transitionDocument({
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
    expect(currentDesign.value?.name).toBe("Current");
    expect(designDirty.value).toBe(true);
  });

  it("applies templates as unsaved documents with their requested display name", async () => {
    const session = makeSession();

    const result = await transitionDocument({
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
    expect(currentDesign.value?.name).toBe("Downloaded Template");
    expect(designName.value).toBe("Forest Edge");
    expect(designPath.value).toBe(null);
    expect(designDirty.value).toBe(false);
  });

  it("applies detached replacements without requiring a canvas session", async () => {
    nonCanvasRevision.value = 1;
    mocks.message.mockResolvedValue("Don't Save");

    const result = await transitionDetachedDocument({
      source: "open-path",
      dirtyGuard: "confirm",
      load: async () => ({
        file: makeFile("Detached Next"),
        path: "/designs/detached-next.canopi",
        name: "Detached Next",
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: false });
    expect(currentDesign.value?.name).toBe("Detached Next");
    expect(designName.value).toBe("Detached Next");
    expect(designPath.value).toBe("/designs/detached-next.canopi");
    expect(designDirty.value).toBe(false);
    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
  });

  it("saves dirty detached documents through the document snapshot", async () => {
    nonCanvasRevision.value = 1;
    mocks.message.mockResolvedValue("Save");

    const result = await transitionDetachedDocument({
      source: "open-path",
      dirtyGuard: "confirm",
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
    expect(currentDesign.value?.name).toBe("Detached Next");
  });

  it("loads an existing mounted document without replacing canonical document state", async () => {
    const session = makeSession();
    nonCanvasRevision.value = 1;
    const mounted = currentDesign.value!;

    const result = await transitionDocument({
      source: "mount-existing",
      dirtyGuard: "skip",
      session,
      load: async () => ({
        file: mounted,
        path: designPath.value,
        name: designName.value,
      }),
    });

    expect(result).toEqual({ status: "applied", documentLoaded: true });
    expect(session.loadDocument).toHaveBeenCalledWith(mounted);
    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(currentDesign.value).toBe(mounted);
    expect(designDirty.value).toBe(true);
    expect(session.clearHistory).toHaveBeenCalledTimes(1);
    expect(session.zoomToFit).toHaveBeenCalledTimes(1);
  });

  it("consumes queued path loads, clears the queue, and reports the transition result", async () => {
    const session = makeSession();
    const results: Array<{ status: string; documentLoaded: boolean }> = [];
    pendingDesignPath.value = "/designs/queued.canopi";
    mocks.loadDesign.mockResolvedValue(makeFile("Queued"));

    const cancel = consumeQueuedDocumentLoad(session, {
      onResult: (result) => results.push({ status: result.status, documentLoaded: result.documentLoaded }),
    });
    await flushMicrotasks();

    expect(mocks.loadDesign).toHaveBeenCalledWith("/designs/queued.canopi");
    expect(session.replaceDocument).toHaveBeenCalledWith(expect.objectContaining({ name: "Queued" }));
    expect(pendingDesignPath.value).toBe(null);
    expect(results).toEqual([{ status: "applied", documentLoaded: true }]);
    cancel();
  });

  it("keeps queued failures pending and surfaces a retryable error", async () => {
    const session = makeSession();
    const queued = deferred<CanopiFile>();
    pendingDesignPath.value = "/designs/broken.canopi";
    mocks.loadDesign.mockReturnValue(queued.promise);

    consumeQueuedDocumentLoad(session);
    queued.reject(new Error("Disk read failed"));
    await flushMicrotasks();

    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(pendingDesignPath.value).toBe("/designs/broken.canopi");
    expect(mocks.message).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open broken"),
      expect.objectContaining({ title: "Open failed", kind: "error" }),
    );
  });

  it("keeps queued loads pending when teardown cancels them before apply", async () => {
    const session = makeSession();
    const queued = deferred<CanopiFile>();
    pendingDesignPath.value = "/designs/queued.canopi";
    mocks.loadDesign.mockReturnValue(queued.promise);

    const cancel = consumeQueuedDocumentLoad(session);
    cancel();
    queued.resolve(makeFile("Queued"));
    await flushMicrotasks();

    expect(session.replaceDocument).not.toHaveBeenCalled();
    expect(pendingDesignPath.value).toBe("/designs/queued.canopi");
  });

  it("starts an empty session by installing workflows and hiding canvas chrome", () => {
    const session = makeSession();

    beginEmptyDocumentSession(session);

    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
    expect(session.hideCanvasChrome).toHaveBeenCalledTimes(1);
    expect(session.showCanvasChrome).not.toHaveBeenCalled();
  });
});
