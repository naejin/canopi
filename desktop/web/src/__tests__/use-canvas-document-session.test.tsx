import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autosaveDesign: vi.fn(async () => undefined),
  cancelQueuedLoad: vi.fn(),
  consumeQueuedDocumentLoad: vi.fn((_session?: unknown) => () => {}),
  disposeDocumentWorkflows: vi.fn(),
  flushQueuedSettingsPersist: vi.fn(),
  installConsortiumSync: vi.fn(),
  loadCanvasFromDocument: vi.fn(),
  runtimeInitImpl: vi.fn(async (_container?: HTMLElement) => undefined),
  runtimeInstances: [] as Array<Record<string, unknown>>,
  snapshotCanvasIntoCurrentDocument: vi.fn(),
  writeCanvasIntoDocument: vi.fn(() => ({ name: "Autosaved" })),
}));

vi.mock("../canvas/runtime/scene-runtime", () => ({
  SceneCanvasRuntime: class {
    init = vi.fn((container) => mocks.runtimeInitImpl(container))
    loadDocument = vi.fn()
    replaceDocument = vi.fn()
    initializeViewport = vi.fn()
    attachRulersTo = vi.fn()
    showCanvasChrome = vi.fn()
    hideCanvasChrome = vi.fn()
    resize = vi.fn()
    destroy = vi.fn()

    constructor() {
      mocks.runtimeInstances.push(this as unknown as Record<string, unknown>)
    }
  },
}));

vi.mock("../ipc/design", () => ({
  autosaveDesign: mocks.autosaveDesign,
}));

vi.mock("../app/document-session/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/document-session/actions")>();
  return {
    ...actual,
    consumeQueuedDocumentLoad: mocks.consumeQueuedDocumentLoad,
  };
});

vi.mock("../app/document-session/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/document-session/runtime")>();
  return {
    ...actual,
    disposeDocumentWorkflows: mocks.disposeDocumentWorkflows,
    installConsortiumSync: mocks.installConsortiumSync,
    loadCanvasFromDocument: vi.fn((file, session) => {
      mocks.loadCanvasFromDocument(file, session);
      session.loadDocument(file);
      mocks.installConsortiumSync();
    }),
    snapshotCanvasIntoCurrentDocument: mocks.snapshotCanvasIntoCurrentDocument,
    writeCanvasIntoDocument: mocks.writeCanvasIntoDocument,
  };
});

vi.mock("../app/settings/persistence", () => ({
  flushQueuedSettingsPersist: mocks.flushQueuedSettingsPersist,
}));

import { useCanvasDocumentSession } from "../app/document-session/use-canvas-document-session";
import { currentCanvasSession } from "../canvas/session";
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
    mocks.cancelQueuedLoad.mockReset();
    mocks.cancelQueuedLoad.mockImplementation(() => {});
    mocks.consumeQueuedDocumentLoad.mockClear();
    mocks.consumeQueuedDocumentLoad.mockImplementation(() => mocks.cancelQueuedLoad);
    mocks.disposeDocumentWorkflows.mockClear();
    mocks.flushQueuedSettingsPersist.mockClear();
    mocks.installConsortiumSync.mockClear();
    mocks.loadCanvasFromDocument.mockClear();
    mocks.runtimeInitImpl.mockReset();
    mocks.runtimeInitImpl.mockResolvedValue(undefined);
    mocks.runtimeInstances.length = 0;
    mocks.snapshotCanvasIntoCurrentDocument.mockClear();
    mocks.writeCanvasIntoDocument.mockClear();
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
    expect(runtime.hideCanvasChrome).toHaveBeenCalledTimes(1);
    expect(mocks.installConsortiumSync).toHaveBeenCalledTimes(1);
    expect(mocks.consumeQueuedDocumentLoad).toHaveBeenCalledWith(currentCanvasSession.value);
  });

  it("loads the current design on mount and snapshots before teardown", async () => {
    currentDesign.value = makeDesign();

    await act(async () => {
      render(<Harness />, container);
      await flushMicrotasks();
    });

    const runtime = mocks.runtimeInstances[0] as {
      destroy: ReturnType<typeof vi.fn>;
      showCanvasChrome: ReturnType<typeof vi.fn>;
    };

    expect(mocks.loadCanvasFromDocument).toHaveBeenCalledWith(currentDesign.value, currentCanvasSession.value);
    expect(runtime.showCanvasChrome).toHaveBeenCalledTimes(1);

    await act(async () => {
      render(null, container);
    });

    expect(mocks.snapshotCanvasIntoCurrentDocument).toHaveBeenCalledTimes(1);
    expect(mocks.disposeDocumentWorkflows).toHaveBeenCalledTimes(1);
    expect(mocks.cancelQueuedLoad).toHaveBeenCalledTimes(1);
    expect(mocks.flushQueuedSettingsPersist).toHaveBeenCalledTimes(1);
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(currentCanvasSession.value).toBe(null);
    const snapshotOrder = mocks.snapshotCanvasIntoCurrentDocument.mock.invocationCallOrder[0];
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

    expect(mocks.loadCanvasFromDocument).not.toHaveBeenCalled();
    expect(mocks.snapshotCanvasIntoCurrentDocument).not.toHaveBeenCalled();
    expect(mocks.disposeDocumentWorkflows).toHaveBeenCalledTimes(1);
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

    expect(mocks.loadCanvasFromDocument).not.toHaveBeenCalled();
    expect(mocks.snapshotCanvasIntoCurrentDocument).not.toHaveBeenCalled();
    expect(mocks.disposeDocumentWorkflows).toHaveBeenCalledTimes(1);
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

    expect(mocks.snapshotCanvasIntoCurrentDocument).toHaveBeenCalledTimes(1);
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

    expect(mocks.writeCanvasIntoDocument).toHaveBeenCalledTimes(1);
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
