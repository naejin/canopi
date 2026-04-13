import { getCurrentWindow } from "@tauri-apps/api/window";
import { saveCurrentDesign } from "../document-session/actions";
import { designDirty } from "../../state/design";
import { confirmCloseWithUnsavedChanges } from "../../state/close-guard";
import { flushQueuedSettingsPersist } from "./state";

let unlistenClose: (() => void) | null = null;

export function registerCloseGuard(): void {
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
