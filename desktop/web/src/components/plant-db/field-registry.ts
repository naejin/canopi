export {
  FILTER_CATEGORIES as CATEGORIES,
  PLANT_FILTER_FIELDS as FIELD_REGISTRY,
  categoryForField,
  dynamicFilterFieldsForCategory as fieldsForCategory,
  fieldDefForKey,
  isStripField,
} from '../../generated/plant-filter-fields'

export type {
  FilterCategory,
  PlantFilterCategory,
  PlantFilterFieldDef as FieldDef,
  PlantFilterFieldKind,
  PlantFilterUiPlacement,
} from '../../generated/plant-filter-fields'
