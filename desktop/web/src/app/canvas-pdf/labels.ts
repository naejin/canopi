import type { PdfLabels } from './types'

export const fieldLabelDefaults = {
  detail: 'Detail', measurementSummary: 'Dimensions and spacing', zone: 'Zone', longSide: 'Length', width: 'Width', guides: 'Guides',
  metres: 'Measurements in metres', diameters: 'Diameters', outerSides: 'Exterior sides', quantity: 'Qty', species: 'species', plantKey: 'Plant key',
}
export function fieldLabels(labels: PdfLabels) { return { ...fieldLabelDefaults, ...labels } }
