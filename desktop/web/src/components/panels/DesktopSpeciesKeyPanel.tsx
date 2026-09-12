import { SpeciesKeyPanel } from './SpeciesKeyPanel'
import { PlantDetailCard } from '../plant-detail/PlantDetailCard'

export function DesktopSpeciesKeyPanel() {
  return <SpeciesKeyPanel renderDetail={canonicalName => <PlantDetailCard canonicalName={canonicalName} />} />
}
