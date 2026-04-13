import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  flushQueuedSettingsPersist: vi.fn(),
  getCurrentWindow: vi.fn(),
  message: vi.fn(),
  onCloseRequested: vi.fn(),
  saveCurrentDesign: vi.fn(),
  unlistenA: vi.fn(),
  unlistenB: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: mocks.message,
}));

vi.mock("../app/document-session/actions", () => ({
  saveCurrentDesign: mocks.saveCurrentDesign,
}));

vi.mock("../app/shell/state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/shell/state")>();
  return {
    ...actual,
    flushQueuedSettingsPersist: mocks.flushQueuedSettingsPersist,
  };
});

vi.mock("../i18n", () => ({
  t: (key: string) => {
    switch (key) {
      case 'canvas.file.save':
        return 'Save'
      case 'canvas.file.dontSave':
        return "Don't Save"
      case 'canvas.file.cancel':
        return 'Cancel'
      case 'canvas.file.saveBeforeClose':
        return 'Save before closing?'
      case 'canvas.file.saveBeforeCloseMessage':
        return 'You have unsaved changes. Save before closing?'
      default:
        return key
    }
  },
}));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("registerCloseGuard", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.destroy.mockReset();
    mocks.flushQueuedSettingsPersist.mockReset();
    mocks.getCurrentWindow.mockReset();
    mocks.message.mockReset();
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

  it("disposes stale async listeners when register is called twice before the first promise settles", async () => {
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    registerCloseGuard();
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
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("prompts on dirty close and destroys the window after a successful save", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.message.mockResolvedValue("Save");
    mocks.saveCurrentDesign.mockResolvedValue(undefined);

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.message).toHaveBeenCalledTimes(1);
    expect(mocks.saveCurrentDesign).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys without saving when the user discards changes", async () => {
    const design = await import("../state/design");
    design.nonCanvasRevision.value = 1;

    mocks.message.mockResolvedValue("Don't Save");

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

    mocks.message.mockResolvedValue("Cancel");

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

    mocks.message.mockResolvedValue("Save");
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
