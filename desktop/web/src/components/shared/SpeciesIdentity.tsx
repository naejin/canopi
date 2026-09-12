import type { ComponentChildren } from 'preact'
import styles from './SpeciesIdentity.module.css'

export function SpeciesIdentity({ commonName, canonicalName, mark, detail }: {
  commonName?: string | null
  canonicalName: string
  mark?: ComponentChildren
  detail?: ComponentChildren
}) {
  return <span className={styles.identity}>
    {mark && <span className={styles.mark} aria-hidden="true">{mark}</span>}
    <span className={styles.names}>
      <strong>{commonName || canonicalName}</strong>
      {commonName && <em>{canonicalName}</em>}
      {detail && <span className={styles.detail}>{detail}</span>}
    </span>
  </span>
}
