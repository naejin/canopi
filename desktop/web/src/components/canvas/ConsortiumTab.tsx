import { t } from '../../i18n'
import { locale } from '../../state/app'
import styles from './ConsortiumTab.module.css'

/**
 * Consortium tab — will become a Strata-Succession Matrix:
 * - Left axis: syntropic strata (Emergent → Root)
 * - Top axis: succession stages (Pioneer → Climax)
 * - Cells: plants from canvas matching each strata × succession slot
 *
 * Placeholder until proper matrix design is implemented.
 */
export function ConsortiumTab() {
  void locale.value

  return (
    <div className={styles.container}>
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>{t('canvas.consortium.matrixTitle')}</p>
        <p className={styles.emptyHint}>{t('canvas.consortium.matrixHint')}</p>
      </div>
    </div>
  )
}
