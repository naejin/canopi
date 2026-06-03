import { locale } from '../../app/settings/state'
import { useSavedLocationPresentation } from '../../app/location'
import { LocationTab } from '../canvas/LocationTab'
import { WelcomeScreen } from '../shared/WelcomeScreen'
import styles from './LocationPanel.module.css'

export function LocationPanel() {
  void locale.value
  const savedLocation = useSavedLocationPresentation()

  return (
    <div className={styles.panel}>
      {savedLocation.hasDesign ? (
        <LocationTab />
      ) : (
        <div className={styles.emptyState}>
          <WelcomeScreen />
        </div>
      )}
    </div>
  )
}
