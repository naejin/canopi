import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from '@tauri-apps/plugin-dialog'
import { saveCurrentDesign } from "../document-session/actions";
import { designDirty } from "../../state/design";
import { t } from '../../i18n'
import { flushQueuedSettingsPersist } from "./state";

let unlistenClose: (() => void) | null = null;
let closeGuardRegistration = 0;

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

export function registerCloseGuard(): void {
  closeGuardRegistration += 1;
  const registration = closeGuardRegistration;

  if (typeof unlistenClose === "function") {
    unlistenClose();
    unlistenClose = null;
  }

  void getCurrentWindow()
    .onCloseRequested(async (event) => {
      flushQueuedSettingsPersist();

      if (!designDirty.value) return;

      event.preventDefault();

      const decision = await confirmCloseWithUnsavedChanges();
      if (decision === "cancel") return;

      if (decision === "save") {
        try {
          await saveCurrentDesign();
        } catch {
          return;
        }
      }

      await getCurrentWindow().destroy();
    })
    .then((nextUnlisten) => {
      if (registration !== closeGuardRegistration) {
        nextUnlisten();
        return;
      }
      unlistenClose = nextUnlisten;
    });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof unlistenClose === "function") {
      unlistenClose();
      unlistenClose = null;
    }
  });
}
