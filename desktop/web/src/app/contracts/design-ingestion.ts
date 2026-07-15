import {
  CANOPI_FILE_SCHEMA,
  CURRENT_CANOPI_FILE_VERSION,
} from '../../generated/canopi-design-format'
import type { CanopiFile } from '../../types/design'
import { normalizeLoadedDocument } from './document'
import { migrateCanopiDesignValue } from './canopi-design-migrations'
import { decodeCanopiFileSchema } from './canopi-design-schema-decoder'

export function decodeCanopiDesign(value: unknown): CanopiFile {
  const migrated = migrateCanopiDesignValue(value, CURRENT_CANOPI_FILE_VERSION)
  const decoded = decodeCanopiFileSchema(migrated, CANOPI_FILE_SCHEMA) as CanopiFile
  return normalizeLoadedDocument(decoded)
}
