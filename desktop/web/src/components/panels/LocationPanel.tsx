import { locale } from '../../app/shell/state'
import { currentDesign } from '../../state/document'
import { LocationTab } from '../canvas/LocationTab'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import styles from './LocationPanel.module.css'

export function LocationPanel() {
  void locale.value
  const design = currentDesign.value

  return (
    <div className={styles.panel}>
      {design ? (
        <LocationTab />
      ) : (
        <div className={styles.emptyState}>
          <WelcomeScreen />
        </div>
      )}
    </div>
  )
}
