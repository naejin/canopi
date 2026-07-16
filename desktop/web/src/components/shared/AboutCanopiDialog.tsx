import { useEffect, useRef } from 'preact/hooks'
import { aboutCanopiDialogOpen, closeAboutCanopiDialog } from '../../app/about/state'
import {
  CANOPI_COPYRIGHT,
  CANOPI_LICENSE,
  CANOPI_VERSION,
} from '../../app/about/metadata'
import { t } from '../../i18n'
import styles from './AboutCanopiDialog.module.css'

export function AboutCanopiDialog() {
  if (!aboutCanopiDialogOpen.value) return null
  return <AboutCanopiDialogContent />
}

function AboutCanopiDialogContent() {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closeAboutCanopiDialog()
  }

  return (
    <div
      className={styles.overlay}
      onPointerUp={(event) => {
        if (event.target === event.currentTarget) closeAboutCanopiDialog()
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-canopi-title"
        data-preserve-overlays="true"
        onKeyDown={onKeyDown}
      >
        <header className={styles.header}>
          <img
            src={new URL('../../assets/canopi-logo.svg', import.meta.url).href}
            className={styles.logo}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div className={styles.identity}>
            <h2 id="about-canopi-title" className={styles.title}>
              {t('about.title')}
            </h2>
            <p className={styles.version}>
              {t('about.version', { version: CANOPI_VERSION })}
            </p>
          </div>
        </header>

        <dl className={styles.meta}>
          <div>
            <dt>{t('about.licenseLabel')}</dt>
            <dd>{CANOPI_LICENSE}</dd>
          </div>
          <div>
            <dt>{t('about.copyrightLabel')}</dt>
            <dd>{CANOPI_COPYRIGHT}</dd>
          </div>
        </dl>

        <footer className={styles.footer}>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            onClick={closeAboutCanopiDialog}
          >
            {t('window.close')}
          </button>
        </footer>
      </section>
    </div>
  )
}
