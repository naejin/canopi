import type { ComponentChildren } from 'preact'
import { t } from '../../i18n'
import styles from './SpeciesIdentity.module.css'

export function SpeciesIdentity({ commonName, canonicalName, englishFallback, mark, detail, highlight }: {
  commonName?: string | null
  canonicalName: string
  /** The common name is the English catalog name: the species has none in the UI language. */
  englishFallback?: boolean
  mark?: ComponentChildren
  detail?: ComponentChildren
  /** Renders a name with its finder matches marked. */
  highlight?: (text: string) => ComponentChildren
}) {
  const show = highlight ?? ((text: string) => text)
  return <span className={styles.identity}>
    {mark && <span className={styles.mark} aria-hidden="true">{mark}</span>}
    <span className={styles.names}>
      <strong>{commonName
        ? <SpeciesCommonName name={show(commonName)} englishFallback={englishFallback} />
        : show(canonicalName)}</strong>
      {commonName && <em lang="la">{show(canonicalName)}</em>}
      {detail && <span className={styles.detail}>{detail}</span>}
    </span>
  </span>
}

/**
 * A common name, marked when it is the English catalog name shown because the
 * species has no name in the UI language: `lang="en"` on the name only, a
 * visible mark hidden from assistive technology and a spoken note instead.
 */
export function SpeciesCommonName({ name, englishFallback }: {
  name: ComponentChildren
  englishFallback?: boolean
}) {
  if (!englishFallback) return <>{name}</>
  return <>
    <span lang="en">{name}</span>
    {' '}<span className={styles.englishMark} aria-hidden="true">{t('speciesName.englishMark')}</span>
    <span className={styles.srOnly}> {t('speciesName.englishFallbackNote')}</span>
  </>
}
