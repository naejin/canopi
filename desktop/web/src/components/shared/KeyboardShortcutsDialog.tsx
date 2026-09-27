import type { MenuDefinition } from '../../app/shell-commands/menus'
import { flattenMenuActions } from '../../app/shell-commands/menus'
import { closeKeyboardShortcutsDialog, keyboardShortcutsDialogOpen } from '../../app/shell/dialogs'
import { t } from '../../i18n'
import { formatShortcut } from '../../app/shell-commands/shortcut-text'
import { WorkspaceDialog } from './WorkspaceDialog'
import styles from './KeyboardShortcutsDialog.module.css'

/**
 * Help › Keyboard shortcuts (F1): every menu command that has a shortcut,
 * grouped by menu, generated from the same menus so it cannot drift, then the
 * keys that are not commands (F6 between areas, arrow-key nudges).
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
  // Keys that are not menu commands: moving between areas (F6) and nudging on the map.
  const arrows = t('shortcuts.arrowKeys')
  const workspaceRows = [
    { id: 'next-region', label: t('shortcuts.nextRegion'), shortcut: formatShortcut('F6', t) },
    { id: 'previous-region', label: t('shortcuts.previousRegion'), shortcut: formatShortcut('Shift+F6', t) },
    { id: 'nudge', label: t('shortcuts.nudge'), shortcut: arrows },
    { id: 'nudge-large', label: t('shortcuts.nudgeLarge'), shortcut: `${t('shortcutKeys.shift')} ${arrows}` },
  ]
  const allSections = [...sections, { id: 'workspace', label: t('shortcuts.workspaceHeading'), rows: workspaceRows }]

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
        {allSections.map((section) => (
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
