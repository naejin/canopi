import type { ComponentChildren } from 'preact'
import styles from './SpeciesIdentity.module.css'

export function SpeciesIdentity({ commonName, canonicalName, mark, detail, highlight }: {
  commonName?: string | null
  canonicalName: string
  mark?: ComponentChildren
  detail?: ComponentChildren
  /** Renders a name with its finder matches marked. */
  highlight?: (text: string) => ComponentChildren
}) {
  const show = highlight ?? ((text: string) => text)
  return <span className={styles.identity}>
    {mark && <span className={styles.mark} aria-hidden="true">{mark}</span>}
    <span className={styles.names}>
      <strong>{show(commonName || canonicalName)}</strong>
      {commonName && <em lang="la">{show(canonicalName)}</em>}
      {detail && <span className={styles.detail}>{detail}</span>}
    </span>
  </span>
}
