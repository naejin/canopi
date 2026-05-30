import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autosaveDesign: vi.fn(async () => undefined),
  beginEmptyDocumentSession: vi.fn((session: any) => {
    session.hideCanvasChrome();
  }),
  cancelQueuedLoad: vi.fn(),
  consumeQueuedDocumentLoad: vi.fn((_session?: unknown) => () => {}),
  disposeDesignSessionPersistence: vi.fn(),
  flushSettingsProjection: vi.fn(),
  runtimeInitImpl: vi.fn(async (_container?: HTMLElement) => undefined),
  runtimeInstances: [] as Array<Record<string, unknown>>,
  snapshotCanvasIntoDesignSession: vi.fn(),
  startAttachedDesignSession: vi.fn(),
  transitionDocument: vi.fn((request: any) => {
    request.session.loadDocument({ name: "Mounted" });
    request.session.showCanvasChrome();
    return Promise.resolve({ status: "applied", documentLoaded: request.session.hasLoadedDocument() });
  }),
  buildPersistedDesignSessionContent: vi.fn(() => ({ name: "Autosaved" })),
}));

vi.mock("../canvas/runtime/scene-runtime", () => ({
  SceneCanvasRuntime: class {
    private loaded = false
    init = vi.fn((container) => mocks.runtimeInitImpl(container))
    loadDocument = vi.fn(() => {
      this.loaded = true
    })
    replaceDocument = vi.fn(() => {
      this.loaded = true
    })
    hasLoadedDocument = vi.fn(() => this.loaded)
    initializeViewport = vi.fn()
    attachRulersTo = vi.fn()
    showCanvasChrome = vi.fn()
    hideCanvasChrome = vi.fn()
    resize = vi.fn()
    destroy = vi.fn()

    constructor() {
      ;(this as unknown as Record<string, unknown>).originalLoadDocument = this.loadDocument
      ;(this as unknown as Record<string, unknown>).originalReplaceDocument = this.replaceDocument
      mocks.runtimeInstances.push(this as unknown as Record<string, unknown>)
    }
  },
}));

vi.mock("../ipc/design", () => ({
  autosaveDesign: mocks.autosaveDesign,
}));

vi.mock("../app/document-session/transition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/document-session/transition")>();
  return {
    ...actual,
    beginEmptyDocumentSession: mocks.beginEmptyDocumentSession,
    consumeQueuedDocumentLoad: mocks.consumeQueuedDocumentLoad,
    startAttachedDesignSession: mocks.startAttachedDesignSession,
    transitionDocument: mocks.transitionDocument,
  };
});

vi.mock("../app/document-session/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/document-session/persistence")>();
  return {
    ...actual,
    buildPersistedDesignSessionContent: mocks.buildPersistedDesignSessionContent,
    disposeDesignSessionPersistence: mocks.disposeDesignSessionPersistence,
    snapshotCanvasIntoDesignSession: mocks.snapshotCanvasIntoDesignSession,
  };
});

vi.mock("../app/settings/projection", () => ({
  flushSettingsProjection: mocks.flushSettingsProjection,
}));

import { useCanvasDocumentSession } from "../app/document-session/use-canvas-document-session";
import { currentCanvasDocumentSurface, currentCanvasSession } from "../canvas/session";
import { autoSaveIntervalMs } from "../app/settings/state";
import {
  autosaveFailed,
  currentDesign,
  designName,
  designPath,
  detachedCanvasDirty,
  resetDirtyBaselines,
} from "../state/design";

function Harness() {
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerOverlayRef = useRef<HTMLDivElement>(null);

  useCanvasDocumentSession({ canvasAreaRef, containerRef, rulerOverlayRef });

  return (
    <div>
      <div ref={canvasAreaRef}>
        <div ref={containerRef} />
      </div>
      <div ref={rulerOverlayRef} />
    </div>
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeDesign(name = "Demo") {
  return {
    version: 2,
    name,
    description: null,
    location: null,
    north_bearing_deg: 0,
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
    created_at: "2026-04-13T00:00:00.000Z",
    updated_at: "2026-04-13T00:00:00.000Z",
    extra: {},
  };
}

describe("useCanvasDocumentSession", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.autosaveDesign.mockClear();
    mocks.beginEmptyDocumentSession.mockClear();
    mocks.cancelQueuedLoad.mockReset();
    mocks.cancelQueuedLoad.mockImplementation(() => {});
    mocks.consumeQueuedDocumentLoad.mockClear();
    mocks.consumeQueuedDocumentLoad.mockImplementation(() => mocks.cancelQueuedLoad);
    mocks.disposeDesignSessionPersistence.mockClear();
    mocks.flushSettingsProjection.mockClear();
    mocks.runtimeInitImpl.mockReset();
    mocks.runtimeInitImpl.mockResolvedValue(undefined);
    mocks.runtimeInstances.length = 0;
    mocks.snapshotCanvasIntoDesignSession.mockClear();
    mocks.startAttachedDesignSession.mockReset();
    mocks.startAttachedDesignSession.mockImplementation((session: any) => {
      if (currentDesign.value) {
        session.loadDocument({ name: "Mounted" });
        session.showCanvasChrome();
        return Promise.resolve({ status: "applied", documentLoaded: session.hasLoadedDocument() });
      }
      mocks.beginEmptyDocumentSession(session);
      return Promise.resolve(null);
    });
    mocks.transitionDocument.mockClear();
    mocks.transitionDocument.mockImplementation((request: any) => {
      request.session.loadDocument({ name: "Mounted" });
      request.session.showCanvasChrome();
      return Promise.resolve({ status: "applied", documentLoaded: request.session.hasLoadedDocument() });
    });
    mocks.buildPersistedDesignSessionContent.mockClear();
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    currentCanvasSession.value = null;
    currentDesign.value = null;
    designName.value = "Demo";
    designPath.value = "/designs/demo.canopi";
    autoSaveIntervalMs.value = 100;
    resetDirtyBaselines();
    autosaveFailed.value = false;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    render(null, container);
    container.remove();
  });

  it("mounts an empty session by installing workflows and hiding canvas chrome", async () => {
    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    const runtime = mocks.runtimeInstances[0] as {
      hideCanvasChrome: ReturnType<typeof vi.fn>;
      initializeViewport: ReturnType<typeof vi.fn>;
    };

    expect(runtime).toBeDefined();
    expect(runtime.initializeViewport).toHaveBeenCalledTimes(1);
    expect(mocks.startAttachedDesignSession).toHaveBeenCalledWith(currentCanvasDocumentSurface.value);
    expect(runtime.hideCanvasChrome).toHaveBeenCalledTimes(1);
    expect(mocks.consumeQueuedDocumentLoad).toHaveBeenCalledWith(currentCanvasDocumentSurface.value);
  });

  it("loads the current design on mount and snapshots before teardown", async () => {
    currentDesign.value = makeDesign();

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    const runtime = mocks.runtimeInstances[0] as {
      destroy: ReturnType<typeof vi.fn>;
      loadDocument: ReturnType<typeof vi.fn>;
      replaceDocument: ReturnType<typeof vi.fn>;
      showCanvasChrome: ReturnType<typeof vi.fn>;
    };

    expect(mocks.startAttachedDesignSession).toHaveBeenCalledWith(currentCanvasDocumentSurface.value);
    expect(runtime.showCanvasChrome).toHaveBeenCalledTimes(1);
    expect(runtime.loadDocument).toBe((runtime as any).originalLoadDocument);
    expect((runtime as any).replaceDocument).toBe((runtime as any).originalReplaceDocument);

    await act(async () => {
      render(null, container);
    });

    expect(mocks.snapshotCanvasIntoDesignSession).toHaveBeenCalledTimes(1);
    expect(mocks.disposeDesignSessionPersistence).toHaveBeenCalledTimes(1);
    expect(mocks.cancelQueuedLoad).toHaveBeenCalledTimes(1);
    expect(mocks.flushSettingsProjection).toHaveBeenCalledTimes(1);
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(currentCanvasSession.value).toBe(null);
    const snapshotOrder = mocks.snapshotCanvasIntoDesignSession.mock.invocationCallOrder[0];
    const destroyOrder = runtime.destroy.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(destroyOrder ?? Number.POSITIVE_INFINITY);
  });

  it("does not snapshot when runtime init rejects", async () => {
    currentDesign.value = makeDesign();
    mocks.runtimeInitImpl.mockRejectedValueOnce(new Error("init failed"));

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    await act(async () => {
      render(null, container);
      await flushMicrotasks();
    });

    const runtime = mocks.runtimeInstances[0] as { destroy: ReturnType<typeof vi.fn> };

    expect(mocks.transitionDocument).not.toHaveBeenCalled();
    expect(mocks.snapshotCanvasIntoDesignSession).not.toHaveBeenCalled();
    expect(mocks.disposeDesignSessionPersistence).toHaveBeenCalledTimes(1);
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(currentCanvasSession.value).toBe(null);
  });

  it("does not snapshot before the runtime has loaded a document", async () => {
    currentDesign.value = makeDesign();
    let resolveInit: (() => void) | null = null;
    mocks.runtimeInitImpl.mockImplementation(
      () => new Promise<undefined>((resolve) => {
        resolveInit = () => resolve(undefined);
      }),
    );

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    await act(async () => {
      render(null, container);
      await flushMicrotasks();
    });

    await act(async () => {
      resolveInit?.();
      await flushMicrotasks();
    });

    const runtime = mocks.runtimeInstances[0] as { destroy: ReturnType<typeof vi.fn> };

    expect(mocks.transitionDocument).not.toHaveBeenCalled();
    expect(mocks.snapshotCanvasIntoDesignSession).not.toHaveBeenCalled();
    expect(mocks.disposeDesignSessionPersistence).toHaveBeenCalledTimes(1);
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(currentCanvasSession.value).toBe(null);
  });

  it("snapshots after a queued document replacement loads through replaceDocument", async () => {
    const queuedDesign = makeDesign("Queued");
    mocks.consumeQueuedDocumentLoad.mockImplementation((session: any) => {
      session.replaceDocument(queuedDesign);
      currentDesign.value = queuedDesign;
      return mocks.cancelQueuedLoad;
    });

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    await act(async () => {
      render(null, container);
    });

    const runtime = mocks.runtimeInstances[0] as {
      destroy: ReturnType<typeof vi.fn>;
    };

    expect(mocks.snapshotCanvasIntoDesignSession).toHaveBeenCalledTimes(1);
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
  });

  it("recreates autosave on interval changes", async () => {
    currentDesign.value = makeDesign();
    detachedCanvasDirty.value = true;

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await flushMicrotasks();
    });

    expect(mocks.buildPersistedDesignSessionContent).toHaveBeenCalledTimes(1);
    expect(mocks.autosaveDesign).toHaveBeenCalledTimes(1);

    await act(async () => {
      autoSaveIntervalMs.value = 250;
      await flushMicrotasks();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await flushMicrotasks();
    });

    expect(mocks.autosaveDesign).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(150);
      await flushMicrotasks();
    });

    expect(mocks.autosaveDesign).toHaveBeenCalledTimes(2);
    expect(autosaveFailed.value).toBe(false);
  });
});
