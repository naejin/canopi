import { message } from '@tauri-apps/plugin-dialog'
import type { DesignOpenFailureNotice } from '../app/document-session/open-failure'

/** Desktop presents a Design that cannot be opened as a native error dialog. */
export async function presentDesktopDesignOpenFailure(notice: DesignOpenFailureNotice): Promise<void> {
  await message(notice.message, { title: notice.title, kind: 'error' })
}
