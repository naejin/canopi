import { t } from '../../i18n'
import type { SpeciesFact } from './species-facts'
import styles from './SpeciesDetail.module.css'

/** The key facts: every cell shows its label and either the value or "Not recorded". */
export function FactsGrid({ facts }: { readonly facts: readonly SpeciesFact[] }) {
  return (
    <dl className={styles.facts} aria-label={t('plantDetail.keyFacts')}>
      {facts.map(fact => (
        <div key={fact.id} className={styles.fact} data-fact={fact.id}>
          <dt className={styles.factLabel}>{fact.label}</dt>
          <dd className={fact.value === null ? styles.factMissing : styles.factValue}>
            {fact.value ?? t('plantDetail.notRecorded')}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Read-only tags ("Edible fruit", "Timber"): not chips, nothing to press. */
export function DetailTags({ label, tags }: { readonly label: string; readonly tags: readonly string[] }) {
  if (tags.length === 0) return null
  return (
    <div className={styles.tagGroup}>
      <h3 className={styles.groupLabel}>{label}</h3>
      <ul className={styles.tags}>
        {tags.map(tag => <li key={tag} className={styles.tag}>{tag}</li>)}
      </ul>
    </div>
  )
}

/** Other names in the interface language; long lists fold behind "Show all", never cut silently. */
export function OtherNames({ names, expanded, onToggle }: {
  readonly names: readonly string[]
  readonly expanded: boolean
  readonly onToggle: () => void
}) {
  if (names.length === 0) return null
  const folded = names.length > OTHER_NAMES_SHOWN && !expanded
  const shown = folded ? names.slice(0, OTHER_NAMES_SHOWN) : names
  return (
    <p className={styles.otherNames}>
      <span className={styles.groupLabelInline}>{t('plantDetail.otherNames')}</span>{' '}
      {shown.join(' · ')}
      {names.length > OTHER_NAMES_SHOWN && (
        <>
          {' '}
          <button type="button" className={styles.linkButton} aria-expanded={expanded} onClick={onToggle}>
            {expanded ? t('plantDetail.showFewerNames') : t('plantDetail.showAllNames', { count: names.length })}
          </button>
        </>
      )}
    </p>
  )
}

const OTHER_NAMES_SHOWN = 4
