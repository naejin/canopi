import { signal } from '@preact/signals'
import { activeLayerName } from '../canvas-settings/signals'
import { sidePanel } from '../shell/state'
import { t } from '../../i18n'
import { chooseImportFiles } from './actions'

/**
 * Navigation of the data workflow (Desktop): Layers shows the Design's site
 * data, and three modal dialogs share one slot: the Data library, Import and
 * Analyze. Everything here is session view state, never Design data.
 */
export type DataDialog =
  | {
    readonly kind: 'library'
    /** An item whose details open first. */
    readonly focusId: string | null
  }
  | {
    readonly kind: 'import'
    readonly paths: readonly string[]
    /** Whether the published item joins the Design that asked (started from Layers). */
    readonly attach: boolean
    readonly returnTo: 'library' | null
  }
  | {
    readonly kind: 'analyze'
    readonly itemId: string
    readonly analysisId: string | null
    /** Whether the results join the Design that asked (started from Layers). */
    readonly attach: boolean
    /** A derived item whose run the dialog starts from ("Run again with changes"). */
    readonly from: string | null
    readonly returnTo: 'library' | null
  }

export const dataDialog = signal<DataDialog | null>(null)

/** The Data library dialog, on its list or on one item's details. */
export function openDataLibrary(focusId: string | null = null): void {
  dataDialog.value = { kind: 'library', focusId }
}

export function closeDataDialog(): void {
  dataDialog.value = null
}

/** Leave Import or Analyze: back to the library when it opened them, else closed. */
export function leaveDataDialog(): void {
  const current = dataDialog.value
  dataDialog.value = current && current.kind !== 'library' && current.returnTo === 'library'
    ? { kind: 'library', focusId: null }
    : null
}

/**
 * Add terrain or height data from files: the native picker first (cancelling
 * it creates nothing), then the Import dialog. By default the published item
 * joins the current Design, as "Add data" in Layers and File › Add data… ask;
 * from the Data library it stays in the library.
 */
export async function beginDataImport(
  options: { readonly attach?: boolean; readonly returnTo?: 'library' | null } = {},
): Promise<void> {
  const paths = await chooseImportFiles(t('canvas.lidar.import.chooseFiles'), t('canvas.lidar.import.fileFilter'))
  if (!paths) return
  dataDialog.value = {
    kind: 'import',
    paths,
    attach: options.attach ?? true,
    returnTo: options.returnTo ?? null,
  }
}

/**
 * Open Analyze for one item, optionally with one registry entry chosen.
 * Started from Layers the finished results join the Design that asked;
 * started from the library they stay in the library.
 */
export function analyzeItem(
  itemId: string,
  options: {
    readonly analysisId?: string | null
    readonly attach: boolean
    readonly from?: string | null
    readonly returnTo?: 'library' | null
  },
): void {
  dataDialog.value = {
    kind: 'analyze',
    itemId,
    analysisId: options.analysisId ?? null,
    attach: options.attach,
    from: options.from ?? null,
    returnTo: options.returnTo ?? null,
  }
}

const SITE_ROW_PREFIX = 'site:'

/** The Layers row id of one site data item; one row is active across Layers. */
function siteRowId(itemId: string): string {
  return `${SITE_ROW_PREFIX}${itemId}`
}

/** The site data item whose row is active in Layers, if any. */
export function activeSiteItemId(): string | null {
  const active = activeLayerName.value
  return active.startsWith(SITE_ROW_PREFIX) ? active.slice(SITE_ROW_PREFIX.length) : null
}

export function selectSiteRow(itemId: string): void {
  activeLayerName.value = siteRowId(itemId)
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

/**
 * Show one reference in Layers, selected, rather than calculating a result
 * the Design already has.
 */
export function showInLayers(itemId: string): void {
  dataDialog.value = null
  siteDataDetails.value = null
  selectSiteRow(itemId)
  sidePanel.value = 'layers'
}
