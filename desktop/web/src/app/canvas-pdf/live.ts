import { effect } from '@preact/signals'
import { createPdfDelivery, resolvePdfNames } from '#canvas-pdf-platform'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { designSessionStore } from '../document-session/store'
import { locale } from '../settings/state'
import { t } from '../../i18n'
import { createPdfWorkflow } from './workflow'

export function canExportCanvasPdf(): boolean {
  return designSessionStore.currentDesign.value !== null && currentCanvasQuerySurface.value !== null
}
export const canvasPdf = createPdfWorkflow({
  capture() {
    const query = currentCanvasQuerySurface.value
    if (!query || !designSessionStore.currentDesign.value) return null
    const identity = designSessionStore.sessionIdentity.value
    const revision = query.revision.scene.value
    const language = locale.value
    const name = designSessionStore.designName.value
    const canvas = query.capturePrintSnapshot()
    if (!canvas) return null
    return { identity, input: { name, locale: language, canvas, commonNames: {} },
      isCurrent: () => designSessionStore.sessionIdentity.value === identity && currentCanvasQuerySurface.value === query
        && query.revision.scene.value === revision && locale.value === language && designSessionStore.designName.value === name
        && query.getSettledPlacedPlants() !== null }
  },
  resolveNames: resolvePdfNames,
  prepare: async (input, signal, progress) => (await import('./job')).preparePdfJob(input, signal, progress),
  delivery: createPdfDelivery(),
  labels: () => ({ notes: t('pdf.notes'), observations: t('pdf.observations'), keyAndNotes: t('pdf.keyAndNotes'), overview: t('pdf.overview'), plants: t('pdf.plants'), actualSize: t('pdf.actualSize') }),
  namePrintArea: (number) => t('pdf.areaName', { number }),
  fontBaseUrl: () => new URL(`${import.meta.env.BASE_URL}pdf-fonts/`, document.baseURI).href,
})
const disposeObservation = effect(() => {
  const identity = designSessionStore.sessionIdentity.value
  if (canvasPdf.open.value) {
    const query = currentCanvasQuerySurface.value
    void query?.revision.scene.value
    void query?.getSettledPlacedPlants()
    void locale.value
    void designSessionStore.designName.value
  }
  canvasPdf.synchronize(identity)
})
if (import.meta.hot) import.meta.hot.dispose(() => { disposeObservation(); canvasPdf.dispose() })
