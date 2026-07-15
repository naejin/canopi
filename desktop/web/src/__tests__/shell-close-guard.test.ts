import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  flushSettingsProjection: vi.fn(),
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

vi.mock("../app/settings/projection", () => ({
  flushSettingsProjection: mocks.flushSettingsProjection,
}));

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
    mocks.flushSettingsProjection.mockReset().mockResolvedValue(undefined);
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

    const design = await import("./support/design-session-state");
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

  it("disposes a listener that settles after its close-guard lifetime ends", async () => {
    let resolveRegistration!: (unlisten: () => void) => void;
    mocks.onCloseRequested.mockReset().mockReturnValue(new Promise<() => void>((resolve) => {
      resolveRegistration = resolve;
    }));
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    const lifetime = registerCloseGuard();
    lifetime.dispose();
    resolveRegistration(mocks.unlistenA);
    await flushMicrotasks();

    expect(mocks.unlistenA).toHaveBeenCalledTimes(1);
  });

  it("disposes a settled close-guard listener at most once", async () => {
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    const lifetime = registerCloseGuard();
    await flushMicrotasks();
    lifetime.dispose();
    lifetime.dispose();

    expect(mocks.unlistenA).toHaveBeenCalledTimes(1);
  });

  it("does not report a listener registration failure after its lifetime ends", async () => {
    let rejectRegistration!: (error: unknown) => void;
    mocks.onCloseRequested.mockReset().mockReturnValue(new Promise<() => void>((_resolve, reject) => {
      rejectRegistration = reject;
    }));
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    const lifetime = registerCloseGuard();
    lifetime.dispose();
    rejectRegistration(new Error("obsolete registration"));
    await flushMicrotasks();

    expect(logError).not.toHaveBeenCalled();
    logError.mockRestore();
  });

  it("reports a listener registration failure for the active lifetime", async () => {
    const error = new Error("listener unavailable");
    mocks.onCloseRequested.mockReset().mockRejectedValue(error);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerCloseGuard } = await import("../app/shell/close-guard");

    registerCloseGuard();
    await flushMicrotasks();

    expect(logError).toHaveBeenCalledWith("Failed to register close guard:", error);
    logError.mockRestore();
  });

  it("prevents a clean close until settings finish flushing, then destroys the window", async () => {
    let resolveFlush!: () => void;
    mocks.flushSettingsProjection.mockReturnValue(new Promise<void>((resolve) => {
      resolveFlush = resolve;
    }));
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    const close = handler(event);

    expect(mocks.flushSettingsProjection).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();

    resolveFlush();
    await close;

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("coalesces close requests while the close workflow is in flight", async () => {
    let resolveFlush!: () => void;
    mocks.flushSettingsProjection.mockReturnValue(new Promise<void>((resolve) => {
      resolveFlush = resolve;
    }));
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };
    const firstClose = handler(firstEvent);
    const secondClose = handler(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.flushSettingsProjection).toHaveBeenCalledTimes(1);

    resolveFlush();
    await Promise.all([firstClose, secondClose]);

    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not finish a close after its guard lifetime is disposed during flush", async () => {
    let resolveFlush!: () => void;
    mocks.flushSettingsProjection.mockReturnValue(new Promise<void>((resolve) => {
      resolveFlush = resolve;
    }));
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    const lifetime = registerCloseGuard();
    await flushMicrotasks();
    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };

    const close = handler(event);
    lifetime.dispose();
    resolveFlush();
    await close;

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("keeps the window open when settings cannot be flushed", async () => {
    const error = new Error("settings unavailable");
    mocks.flushSettingsProjection.mockRejectedValue(error);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    const event = { preventDefault: vi.fn() };
    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("Failed to flush settings before close:", error);
    logError.mockRestore();
  });

  it("contains and reports a dirty-close dialog failure", async () => {
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;
    const error = new Error("dialog unavailable");
    mocks.message.mockRejectedValue(error);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    await expect(handler({ preventDefault: vi.fn() })).resolves.toBeUndefined();

    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("Failed to complete close workflow:", error);
    logError.mockRestore();
  });

  it("contains and reports a window-destroy failure", async () => {
    const error = new Error("window unavailable");
    mocks.destroy.mockRejectedValue(error);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();

    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => Promise<void>;
    await expect(handler({ preventDefault: vi.fn() })).resolves.toBeUndefined();

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Failed to complete close workflow:", error);
    logError.mockRestore();
  });

  it("prompts on dirty close and destroys the window after a successful save", async () => {
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;

    mocks.message.mockResolvedValue("Save");
    mocks.saveCurrentDesign.mockImplementation(async () => {
      design.designSessionFixture.nonCanvasSavedRevision = design.nonCanvasRevision.value;
      return { status: "applied" };
    });

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
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;

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
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;

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
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;

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

  it("keeps the window open when save settlement is stale", async () => {
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;
    mocks.message.mockResolvedValue("Save");
    mocks.saveCurrentDesign.mockResolvedValue({ status: "stale" });

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();
    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (
      event: { preventDefault: () => void },
    ) => Promise<void>;

    await handler({ preventDefault: vi.fn() });

    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("keeps the window open when edits made during save remain dirty", async () => {
    const design = await import("./support/design-session-state");
    design.designSessionFixture.nonCanvasRevision = 1;
    mocks.message.mockResolvedValue("Save");
    mocks.saveCurrentDesign.mockResolvedValue({ status: "applied" });

    const { registerCloseGuard } = await import("../app/shell/close-guard");
    registerCloseGuard();
    await flushMicrotasks();
    const handler = mocks.onCloseRequested.mock.calls[0]?.[0] as (
      event: { preventDefault: () => void },
    ) => Promise<void>;

    await handler({ preventDefault: vi.fn() });

    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});
