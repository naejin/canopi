import type { MenuDefinition } from '../../app/shell-commands/menus'
import { flattenMenuActions } from '../../app/shell-commands/menus'
import { closeKeyboardShortcutsDialog, keyboardShortcutsDialogOpen } from '../../app/shell/dialogs'
import { t } from '../../i18n'
import { WorkspaceDialog } from './WorkspaceDialog'
import styles from './KeyboardShortcutsDialog.module.css'

/**
 * Help › Keyboard shortcuts (F1): every menu command that has a shortcut,
 * grouped by menu. Generated from the same menus, so it cannot drift.
 */
export function KeyboardShortcutsDialog({ menus }: { readonly menus: readonly MenuDefinition[] }) {
  if (!keyboardShortcutsDialogOpen.value) return null
  const sections = menus
    .map((menu) => ({
      id: menu.id,
      label: menu.id === 'tools' ? t('shortcuts.toolsHeading', { menu: menu.label }) : menu.label,
      rows: flattenMenuActions([menu]).filter((action) => action.shortcut),
    }))
    .filter((section) => section.rows.length > 0)

  return (
    <WorkspaceDialog
      title={t('shortcuts.title')}
      onClose={closeKeyboardShortcutsDialog}
      wide
      footer={(
        <>
          <span className={styles.footnote}>{t('shortcuts.footnote')}</span>
          <button type="button" className={styles.closeButton} onClick={closeKeyboardShortcutsDialog} data-dialog-initial-focus>
            {t('window.close')}
          </button>
        </>
      )}
    >
      <div className={styles.grid}>
        {sections.map((section) => (
          <section key={section.id} className={styles.section} aria-labelledby={`shortcuts-${section.id}`}>
            <h3 className={styles.heading} id={`shortcuts-${section.id}`}>{section.label}</h3>
            <dl className={styles.rows}>
              {section.rows.map((row) => (
                <div key={row.id} className={styles.row}>
                  <dt>{row.label}</dt>
                  <dd><kbd className={styles.key}>{row.shortcut}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={styles.escape}>{t('shortcuts.escape')}</p>
    </WorkspaceDialog>
  )
}
