import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from '@tauri-apps/plugin-dialog'
import { saveCurrentDesign } from "../document-session/actions";
import { designDirty } from "../document-session/store";
import { t } from '../../i18n'
import { flushSettingsProjection } from "../settings/projection";

export interface CloseGuardLifetime {
  dispose(): void;
}

interface ActiveCloseGuard {
  disposed: boolean;
  closePromise: Promise<void> | null;
  unlisten: (() => void) | null;
}

let activeCloseGuard: ActiveCloseGuard | null = null;

export type CloseDecision = 'save' | 'discard' | 'cancel'

export async function confirmCloseWithUnsavedChanges(): Promise<CloseDecision> {
  const saveLabel = t('canvas.file.save')
  const discardLabel = t('canvas.file.dontSave')
  const cancelLabel = t('canvas.file.cancel')

  const result = await message(t('canvas.file.saveBeforeCloseMessage'), {
    title: t('canvas.file.saveBeforeClose'),
    kind: 'warning',
    buttons: {
      yes: saveLabel,
      no: discardLabel,
      cancel: cancelLabel,
    },
  })

  if (result === saveLabel) return 'save'
  if (result === discardLabel) return 'discard'
  return 'cancel'
}

async function runCloseWorkflow(
  closeGuard: ActiveCloseGuard,
  currentWindow: ReturnType<typeof getCurrentWindow>,
): Promise<void> {
  try {
    await flushSettingsProjection();
  } catch (error) {
    console.error("Failed to flush settings before close:", error);
    return;
  }
  if (closeGuard.disposed) return;

  if (!designDirty.value) {
    await currentWindow.destroy();
    return;
  }

  const decision = await confirmCloseWithUnsavedChanges();
  if (closeGuard.disposed) return;
  if (decision === "cancel") return;

  if (decision === "save") {
    try {
      const settlement = await saveCurrentDesign();
      if (settlement?.status !== 'applied' || designDirty.value) return;
    } catch {
      return;
    }
    if (closeGuard.disposed) return;
  }

  await currentWindow.destroy();
}

export function registerCloseGuard(): CloseGuardLifetime {
  if (activeCloseGuard) disposeCloseGuard(activeCloseGuard);

  const closeGuard: ActiveCloseGuard = {
    disposed: false,
    closePromise: null,
    unlisten: null,
  };
  activeCloseGuard = closeGuard;
  const currentWindow = getCurrentWindow();

  void currentWindow
    .onCloseRequested((event) => {
      event.preventDefault();
      if (closeGuard.disposed) return;
      if (closeGuard.closePromise) return closeGuard.closePromise;

      const closePromise = runCloseWorkflow(closeGuard, currentWindow).catch((error) => {
        console.error("Failed to complete close workflow:", error);
      });
      closeGuard.closePromise = closePromise;
      void closePromise.then(
        () => {
          if (closeGuard.closePromise === closePromise) closeGuard.closePromise = null;
        },
        () => {
          if (closeGuard.closePromise === closePromise) closeGuard.closePromise = null;
        },
      );
      return closePromise;
    })
    .then((nextUnlisten) => {
      if (closeGuard.disposed || activeCloseGuard !== closeGuard) {
        nextUnlisten();
        return;
      }
      closeGuard.unlisten = nextUnlisten;
    })
    .catch((error) => {
      if (!closeGuard.disposed && activeCloseGuard === closeGuard) {
        console.error("Failed to register close guard:", error);
      }
    });

  return {
    dispose: () => disposeCloseGuard(closeGuard),
  };
}

function disposeCloseGuard(closeGuard: ActiveCloseGuard): void {
  if (closeGuard.disposed) return;
  closeGuard.disposed = true;
  closeGuard.unlisten?.();
  closeGuard.unlisten = null;
  if (activeCloseGuard === closeGuard) activeCloseGuard = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (activeCloseGuard) disposeCloseGuard(activeCloseGuard);
  });
}
