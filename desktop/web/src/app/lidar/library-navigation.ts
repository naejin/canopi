import { signal } from '@preact/signals'
import { openLayerRow } from '../canvas-layer-presentation/open-row'
import { selectPanel, sidePanel } from '../shell/state'
import { t } from '../../i18n'
import { chooseImportFiles } from './actions'
import { showInSiteData } from './site-data-view'

/**
 * Navigation of the data workflow (Desktop): the Data library sheet, and Import
 * and Analyze, which open stacked over it when it is open, so its search,
 * filter, scroll and selection survive and it returns unchanged. Everything
 * here is session view state, never Design data.
 */
interface LibraryView {
  /** The item selected when the sheet opens; null selects the first row. */
  readonly focusId: string | null
}

export type DataDialog =
  | {
    readonly kind: 'import'
    readonly paths: readonly string[]
  }
  | {
    readonly kind: 'analyze'
    /** The item Analyze starts from (the open Site data item); null starts from the first eligible one. */
    readonly itemId: string | null
    readonly analysisId: string | null
    /** A derived item whose run the dialog starts from ("Run again with changes…"); its input is the fixed source. */
    readonly from: string | null
  }

/** The Data library sheet, when it is open. */
export const libraryView = signal<LibraryView | null>(null)
/** Import or Analyze, over the library when it is open. */
export const dataDialog = signal<DataDialog | null>(null)

/** The Data library sheet, with one item selected (the first row when none is given). */
export function openDataLibrary(focusId: string | null = null): void {
  libraryView.value = { focusId }
}

export function closeDataLibrary(): void {
  libraryView.value = null
}

/** Closes Import or Analyze; the library under it, if open, returns as it was. */
export function closeDataDialog(): void {
  dataDialog.value = null
}

/**
 * Opens the Site data panel from Layers (the summary row's name and ›) and moves
 * focus into its header once the dock has drawn it, so the keyboard continues
 * there. The panel is a Design panel: without a Design nothing opens.
 */
export function openSiteDataPanel(): void {
  selectPanel('site-data')
  const label = t('canvas.layers.siteData')
  let frames = 0
  const focusHeader = () => {
    const panel = Array.from(document.querySelectorAll<HTMLElement>('aside[aria-label]'))
      .find((candidate) => candidate.getAttribute('aria-label') === label)
    const target = panel?.querySelector<HTMLElement>('header button:not([disabled])')
    if (target) target.focus()
    else if (frames++ < 60) requestAnimationFrame(focusHeader)
  }
  requestAnimationFrame(focusHeader)
}

/**
 * Shows one of this Design's items in Site data, open under its row (Site
 * data's own view state, `site-data-view.ts`); the library sheet and any
 * dialog over it close first. The base Site data panel still reads the shared
 * open row and its details page, so both are set here until stream B's panel
 * replaces it; commit Z deletes them, leaving Layers' open row alone.
 */
export function revealInSiteData(itemId: string): void {
  dataDialog.value = null
  libraryView.value = null
  siteDataDetails.value = null
  showInSiteData(itemId)
  selectSiteRow(itemId)
}

/**
 * Import terrain or height data from files: the native picker first
 * (cancelling it creates nothing), then the Import dialog. The item joins the
 * current Design once it is published (the one attach rule in `actions.ts`).
 */
export async function beginDataImport(): Promise<void> {
  const paths = await chooseImportFiles(t('canvas.lidar.import.chooseFiles'), t('canvas.lidar.import.fileFilter'))
  if (!paths) return
  dataDialog.value = { kind: 'import', paths }
}

/**
 * Opens Analyze from one item (the open Site data item; null starts from the
 * first eligible one), optionally with one registry entry chosen; `from` is the
 * result whose run "Run again with changes…" starts from. Whether results join
 * the Design is the one attach rule (`runAnalysis`).
 */
export function analyzeItem(
  itemId: string | null,
  options: {
    readonly analysisId?: string | null
    readonly from?: string | null
  } = {},
): void {
  dataDialog.value = {
    kind: 'analyze',
    itemId,
    analysisId: options.analysisId ?? null,
    from: options.from ?? null,
  }
}

const SITE_ROW_PREFIX = 'site:'

/** The Layers row id of one site data item; one row is active across Layers. */
function siteRowId(itemId: string): string {
  return `${SITE_ROW_PREFIX}${itemId}`
}

/** The site data item whose row is active in Layers, if any. */
export function activeSiteItemId(): string | null {
  const active = openLayerRow.value
  return active?.startsWith(SITE_ROW_PREFIX) ? active.slice(SITE_ROW_PREFIX.length) : null
}

export function selectSiteRow(itemId: string): void {
  openLayerRow.value = siteRowId(itemId)
}

/** The site data item whose details Layers shows instead of its list. */
export const siteDataDetails = signal<string | null>(null)

export function openSiteDataDetails(itemId: string): void {
  siteDataDetails.value = itemId
  sidePanel.value = 'layers'
}

export function closeSiteDataDetails(): void {
  siteDataDetails.value = null
}
