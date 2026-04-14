import { getShellNotices } from '../../app/shell/notices'
import { ShellNotice } from './ShellNotice'
import styles from './ShellNotices.module.css'

export function ShellNotices() {
  const notices = getShellNotices()
  if (notices.length === 0) return null

  return (
    <div className={styles.stack}>
      {notices.map((notice) => (
        <ShellNotice key={notice.noticeKey ?? notice.message} {...notice} />
      ))}
    </div>
  )
}
