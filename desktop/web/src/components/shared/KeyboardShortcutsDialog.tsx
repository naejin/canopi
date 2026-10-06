import type { MenuDefinition } from '../../app/shell-commands/menus'
import { flattenMenuActions } from '../../app/shell-commands/menus'
import { closeKeyboardShortcutsDialog, keyboardShortcutsDialogOpen } from '../../app/shell/dialogs'
import { singleKeyShortcuts } from '../../app/settings/state'
import { t } from '../../i18n'
import { formatShortcut, modKeyName } from '../../app/shell-commands/shortcut-text'
import { WorkspaceDialog } from './WorkspaceDialog'
import styles from './KeyboardShortcutsDialog.module.css'

/** The View menu's rotation rows, which F1 shows as its two static rows instead (spec §9.1). */
const MENU_ROTATION_ROWS: ReadonlySet<string> = new Set(['view.resetNorth', 'view.turnViewLeft', 'view.turnViewRight'])

interface ShortcutRow {
  readonly id: string
  readonly label: string
  readonly shortcut: string
}

/**
 * Help › Keyboard shortcuts (F1): every menu command that has a shortcut,
 * grouped by menu, generated from the same menus so it cannot drift, then the
 * keys that are not commands (F6 between areas, arrow-key nudges, turning a
 * stamp). View shows turning the view and Reset north as two static rows with
 * every chord, in place of the menu's three rotation rows. With
 * Settings › Keyboard › Single-key shortcuts off, the menus drop those keys,
 * so the list does too (N leaves Reset north), and the footnote says how to
 * turn them back on and that Shift N still resets north.
 */
export function KeyboardShortcutsDialog({ menus }: { readonly menus: readonly MenuDefinition[] }) {
  if (!keyboardShortcutsDialogOpen.value) return null
  const key = (shortcut: string) => formatShortcut(shortcut, t)
  const rotationRows: ShortcutRow[] = [
    { id: 'turn-view', label: t('shortcuts.turnView'), shortcut: [key('Shift+ArrowLeft'), key('Shift+ArrowRight')].join(' · ') },
    {
      id: 'reset-north',
      label: t('shortcuts.resetNorth'),
      shortcut: [...singleKeyShortcuts.value ? [key('N')] : [], key('Shift+N'), key('Shift+ArrowUp')].join(' · '),
    },
  ]
  const sections = menus
    .map((menu) => ({
      id: menu.id,
      label: menu.id === 'tools' ? t('shortcuts.toolsHeading', { menu: menu.label }) : menu.label,
      rows: menu.id === 'view' ? withRotationRows(menuRows(menu), rotationRows) : menuRows(menu),
    }))
    .filter((section) => section.rows.length > 0)
  // Keys that are not menu commands: moving between areas (F6), nudging or panning on the map and turning a stamp.
  const arrows = t('shortcuts.arrowKeys')
  // The large step is mod: Ctrl, or Cmd on macOS.
  const modArrows = `${modKeyName(t)} ${arrows}`
  const workspaceRows = [
    { id: 'next-region', label: t('shortcuts.nextRegion'), shortcut: formatShortcut('F6', t) },
    { id: 'previous-region', label: t('shortcuts.previousRegion'), shortcut: formatShortcut('Shift+F6', t) },
    { id: 'nudge', label: t('shortcuts.nudge'), shortcut: arrows },
    { id: 'nudge-large', label: t('shortcuts.nudgeLarge'), shortcut: modArrows },
    { id: 'pan', label: t('shortcuts.pan'), shortcut: arrows },
    { id: 'pan-large', label: t('shortcuts.panLarge'), shortcut: modArrows },
    // Place a stamp's [ and ]: while the map has focus even with single-key shortcuts off, like the arrows.
    { id: 'rotate-stamp', label: t('shortcuts.rotateStamp'), shortcut: '[ ]' },
  ]
  const allSections = [...sections, { id: 'workspace', label: t('shortcuts.workspaceHeading'), rows: workspaceRows }]

  return (
    <WorkspaceDialog
      title={t('shortcuts.title')}
      onClose={closeKeyboardShortcutsDialog}
      wide
      footer={(
        <>
          <span className={styles.footnote} data-single-key-shortcuts={singleKeyShortcuts.value ? 'on' : 'off'}>
            {singleKeyShortcuts.value
              ? `${t('shortcuts.footnote')} ${t('shortcuts.singleKeysOn')}`
              : t('shortcuts.singleKeysOff')}
            {` ${t('shortcuts.resetNorthAlways', { shortcut: key('Shift+N') })}`}
          </span>
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

/** A menu's rows that show a key: its actions, then a submenu whose key acts on it as a whole (View › Labels, Shift L). */
function menuRows(menu: MenuDefinition): ShortcutRow[] {
  return [
    ...flattenMenuActions([menu]).flatMap((action) => action.shortcut
      ? [{ id: action.id, label: action.label, shortcut: action.shortcut }]
      : []),
    ...menu.items.flatMap((entry) => entry.type === 'submenu' && entry.shortcut
      ? [{ id: entry.id, label: entry.label, shortcut: entry.shortcut }]
      : []),
  ]
}

/** View's rows with the static rotation rows where the menu's first rotation row was (Reset north always shows a key). */
function withRotationRows(rows: readonly ShortcutRow[], rotation: readonly ShortcutRow[]): ShortcutRow[] {
  const at = rows.findIndex((row) => MENU_ROTATION_ROWS.has(row.id))
  const kept = rows.filter((row) => !MENU_ROTATION_ROWS.has(row.id))
  return [...kept.slice(0, at), ...rotation, ...kept.slice(at)]
}
