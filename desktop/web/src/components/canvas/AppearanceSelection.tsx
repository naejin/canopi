import type { ComponentChildren } from 'preact'
import { SpeciesIdentity } from '../shared/SpeciesIdentity'
import styles from './appearance.module.css'

export function AppearanceSelection({ commonName, canonicalName, summary, count, countLabel, preview, detail }: {
  commonName: string | null
  canonicalName: string | null
  summary: string
  count: number
  countLabel: string
  preview: ComponentChildren
  detail?: ComponentChildren
}) {
  return <div className={styles.selection}>
    <SpeciesIdentity commonName={commonName} canonicalName={canonicalName ?? summary} mark={preview} detail={detail} />
    {canonicalName && <span className={styles.count} aria-label={countLabel}>{count}</span>}
  </div>
}
