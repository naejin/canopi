import type { ShellNoticeProps } from '../../components/shared/ShellNotice'
import { t } from '../../i18n'
import { plantDbStatus } from './state'

export function getHealthShellNotice(): ShellNoticeProps | null {
  const status = plantDbStatus.value
  if (status === 'available') return null

  const message = status === 'missing'
    ? t('health.plantDbMissing')
    : t('health.plantDbCorrupt')

  return {
    noticeKey: 'health',
    tone: 'warning',
    role: 'alert',
    live: 'assertive',
    message,
  }
}
