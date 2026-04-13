import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmCloseWithUnsavedChanges: vi.fn(),
  destroy: vi.fn(),
  flushQueuedSettingsPersist: vi.fn(),
  getCurrentWindow: vi.fn(),
  onCloseRequested: vi.fn(),
  saveCurrentDesign: vi.fn(),
  unlistenA: vi.fn(),
  unlistenB: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock("../app/document-session/actions", () => ({
  saveCurrentDesign: mocks.saveCurrentDesign,
}));

vi.mock("../state/close-guard", () => ({
  confirmCloseWithUnsavedChanges: mocks.confirmCloseWithUnsavedChanges,
}));

vi.mock("../app/shell/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/shell/state")>();
  return {
    ...actual,
    flushQueuedSettingsPersist: mocks.flushQueuedSettingsPersist,
  };
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerCloseGuard", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.confirmCloseWithUnsavedChanges.mockReset();
    mocks.destroy.mockReset();
    mocks.flushQueuedSettingsPersist.mockReset();
    mocks.getCurrentWindow.mockReset();
    mocks.onCloseRequested.mockReset();
    mocks.saveCurrentDesign.mockReset();
    mocks.unlistenA.mockReset();
    mocks.unlistenB.mockReset();
    mocks.getCurrentWindow.mockReturnValue({
      onCloseRequested: mocks.onCloseRequested,
      destroy: mocks.destroy,
    });
    mocks.onCloseRequested
      .mockResolvedValueOnce(mocks.unlistenA)
      .mockResolvedValueOnce(mocks.unlistenB);

    const design = await import("../state/design");
    design.resetDirtyBaselines();
  });

  it("cleans up the previous listener when re-registering", async () => {
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    registerCloseGuard();
    await flushMicrotasks();
    registerCloseGuard();
    await flushMicrotasks();

    expect(mocks.onCloseRequested).toHaveBeenCalledTimes(2);
    expect(mocks.unlistenA).toHaveBeenCalledTimes(1);
  });

  it("flushes settings and allows clean closes without prompting", async () => {
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(mocks.flushQueuedSettingsPersist).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mocks.confirmCloseWithUnsavedChanges).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("prompts on dirty close and destroys the window after a successful save", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.confirmCloseWithUnsavedChanges.mockResolvedValue("save");
    mocks.saveCurrentDesign.mockResolvedValue(undefined);

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.confirmCloseWithUnsavedChanges).toHaveBeenCalledTimes(1);
    expect(mocks.saveCurrentDesign).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys without saving when the user discards changes", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.confirmCloseWithUnsavedChanges.mockResolvedValue("discard");

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.saveCurrentDesign).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open when the user cancels the dirty-close prompt", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.confirmCloseWithUnsavedChanges.mockResolvedValue("cancel");

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.saveCurrentDesign).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("keeps the window open when save fails", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.confirmCloseWithUnsavedChanges.mockResolvedValue("save");
    mocks.saveCurrentDesign.mockRejectedValue(new Error("disk full"));

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});
