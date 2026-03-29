import { message } from '@tauri-apps/plugin-dialog'
import { t } from '../i18n'

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
