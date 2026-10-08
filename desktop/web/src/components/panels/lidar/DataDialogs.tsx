import { useMemo, useState } from 'preact/hooks'
import { currentDesign } from '../../../app/document-session/store'
import { addToDesign, runAnalysis } from '../../../app/lidar/actions'
import { formFromProvenance, type AnalysisContext, type AnalysisForm } from '../../../app/analyses/model'
import { findAnalysis } from '../../../app/analyses/registry'
import { libraryItems } from '../../../app/lidar/library-items'
import { lidarLibrary } from '../../../app/lidar/library-store'
import {
  dataDialog,
  leaveDataDialog,
  selectSiteRow,
  showInLayers,
  type DataDialog,
} from '../../../app/lidar/library-navigation'
import { locale } from '../../../app/settings/state'
import { t } from '../../../i18n'
import { AnalyzeDialog } from '../analyze/AnalyzeDialog'
import { DataLibraryView } from './DataLibraryView'
import { ImportDataDialog } from './ImportDataDialog'

/**
 * The Desktop data workflow's modal slot: the Data library, Import or
 * Analyze, one at a time. Import and Analyze opened from the library return
 * to it; opened from Layers or a menu they close back to the workspace.
 */
export function DataDialogs() {
  const dialog = dataDialog.value
  if (!dialog) return null
  switch (dialog.kind) {
    case 'library':
      return <DataLibraryView key={`library-${dialog.focusId ?? ''}`} focusId={dialog.focusId} />
    case 'import':
      return <ImportDataDialog paths={dialog.paths} attach={dialog.attach} onClose={leaveDataDialog} />
    case 'analyze':
      return <AnalyzeRequest key={`${dialog.itemId}-${dialog.from ?? ''}`} request={dialog} />
  }
}

function AnalyzeRequest({ request }: { readonly request: Extract<DataDialog, { kind: 'analyze' }> }) {
  const snapshot = lidarLibrary.value
  const items = useMemo(() => libraryItems(snapshot), [snapshot, locale.value])
  const references = currentDesign.value?.lidar?.entries ?? []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const context = useMemo<AnalysisContext>(() => ({
    edition: 'desktop',
    results: items.filter((candidate) => candidate.role === 'Derived'),
    inDesign: new Set(references.map((entry) => entry.id)),
  }), [items, references])
  const item = items.find((candidate) => candidate.id === request.itemId) ?? null
  // "Run again with changes" starts from the settings and outputs of the run
  // that produced the result.
  const prefill = useMemo((): AnalysisForm | null => {
    const from = request.from ? items.find((candidate) => candidate.id === request.from) : undefined
    const provenance = from?.provenance
    const entry = provenance ? findAnalysis(provenance.analysis_id) : null
    if (!provenance || !entry || !item) return null
    const outputs = items
      .filter((candidate) => candidate.provenance?.definition_id === provenance.definition_id)
      .map((candidate) => candidate.provenance!.output_key)
    return formFromProvenance(entry, provenance, outputs, item.name, t(entry.titleKey), locale.value)
    // The prefill is read once, when the dialog opens.
  }, [])
  if (!item) return null
  return (
    <AnalyzeDialog
      item={item}
      context={context}
      attach={request.attach}
      canAddToDesign={currentDesign.value !== null}
      initialAnalysisId={request.analysisId}
      prefill={prefill}
      busy={busy}
      error={error}
      onCancel={leaveDataDialog}
      onRun={(analysis) => {
        setBusy(true)
        setError(null)
        void runAnalysis(analysis, request.attach)
          .then(() => leaveDataDialog())
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
          .finally(() => setBusy(false))
      }}
      onShowInLayers={showInLayers}
      onAddExisting={(id) => {
        addToDesign('Derived', id)
        selectSiteRow(id)
        leaveDataDialog()
      }}
    />
  )
}
