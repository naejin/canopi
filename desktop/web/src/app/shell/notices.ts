import type { ShellNoticeProps } from '../../components/shared/ShellNotice'
import { getHealthShellNotice } from '../health/notice'
import { getUpdaterShellNotice } from '../updater/notice'

export function getShellNotices(): ShellNoticeProps[] {
  const notices = [
    getHealthShellNotice(),
    getUpdaterShellNotice(),
  ]

  return notices.filter((notice): notice is ShellNoticeProps => notice != null)
}
