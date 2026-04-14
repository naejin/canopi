import type { ShellNoticeProps } from '../../components/shared/ShellNotice'
import { t } from '../../i18n'
import {
  dismissUpdate,
  getUpdaterBlockedReason,
  installAvailableUpdate,
  restartToApplyUpdate,
  retryUpdateAction,
} from './controller'
import { updaterEnabled } from './config'
import { updaterState } from './state'

function formatBytes(value: number | null): string | null {
  if (!Number.isFinite(value ?? NaN) || value == null) return null
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function getUpdaterShellNotice(): ShellNoticeProps | null {
  if (!updaterEnabled) return null

  const state = updaterState.value

  if (state.status === 'idle') return null

  if (state.status === 'checking') {
    return {
      noticeKey: 'updater',
      message: t('updater.checking'),
      live: 'polite',
    }
  }

  if (state.status === 'available') {
    const blockedReason = getUpdaterBlockedReason('install')

    return {
      noticeKey: 'updater',
      message: t('updater.available', { version: state.version }),
      detail: blockedReason,
      live: 'polite',
      secondaryAction: {
        label: t('updater.later'),
        onClick: () => dismissUpdate(),
      },
      primaryAction: {
        label: blockedReason ? t('updater.installAfterSaving') : t('updater.install'),
        disabled: blockedReason != null,
        title: blockedReason ?? undefined,
        onClick: () => { void installAvailableUpdate() },
      },
    }
  }

  if (state.status === 'downloading') {
    const downloaded = formatBytes(state.downloaded)
    const total = formatBytes(state.contentLength)

    return {
      noticeKey: 'updater',
      message:
        downloaded && total
          ? t('updater.downloadProgress', { downloaded, total })
          : t('updater.downloading'),
    }
  }

  if (state.status === 'installed') {
    const blockedReason = getUpdaterBlockedReason('restart')

    return {
      noticeKey: 'updater',
      message: t('updater.readyToRestart', { version: state.version }),
      detail: blockedReason,
      live: 'polite',
      primaryAction: {
        label: t('updater.restart'),
        disabled: blockedReason != null,
        title: blockedReason ?? undefined,
        onClick: () => { void restartToApplyUpdate() },
      },
    }
  }

  return {
    noticeKey: 'updater',
    tone: 'danger',
    live: 'polite',
    message: t('updater.errorPrefix'),
    detail: state.message,
    primaryAction: {
      label: t('updater.retry'),
      onClick: () => { void retryUpdateAction() },
    },
  }
}
