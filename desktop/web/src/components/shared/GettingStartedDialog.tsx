import { closeGettingStartedDialog, gettingStartedDialogOpen, openKeyboardShortcutsDialog } from '../../app/shell/dialogs'
import { formatShortcut } from '../../app/shell-commands/shortcut-text'
import { t } from '../../i18n'
import { WorkspaceDialog } from './WorkspaceDialog'
import styles from './GettingStartedDialog.module.css'

/**
 * Help › Getting started: a short in-app guide to the first steps, naming
 * tools and panels with the interface's own words. Both editions mount it
 * with the other workspace dialogs; it needs no Design.
 */
export function GettingStartedDialog() {
  if (!gettingStartedDialogOpen.value) return null
  const steps = [
    t('gettingStarted.site', { shortcut: formatShortcut('Ctrl+K', t) }),
    t('gettingStarted.zones'),
    t('gettingStarted.plants', { placePlants: t('canvas.tools.plantStamp'), plantRow: t('canvas.tools.plantSpacing') }),
    t('gettingStarted.menu', { esc: t('shortcutKeys.escape'), select: t('canvas.tools.select') }),
    t('gettingStarted.plan', { calendar: t('panelRail.calendar'), budget: t('panelRail.budget'), consortium: t('panelRail.consortium') }),
    t('gettingStarted.save', { file: t('menu.file'), export: t('menu.file.export') }),
  ]
  return (
    <WorkspaceDialog
      title={t('gettingStarted.title')}
      onClose={closeGettingStartedDialog}
      footer={(
        <>
          <button
            type="button"
            className={`${styles.button} ${styles.lead}`}
            onClick={() => {
              closeGettingStartedDialog()
              openKeyboardShortcutsDialog()
            }}
          >
            {t('menu.help.shortcuts')}
          </button>
          <button type="button" className={`${styles.button} ${styles.primary}`} data-dialog-initial-focus onClick={closeGettingStartedDialog}>
            {t('gettingStarted.done')}
          </button>
        </>
      )}
    >
      <p className={styles.intro}>{t('gettingStarted.intro')}</p>
      <ol className={styles.steps}>
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </WorkspaceDialog>
  )
}
