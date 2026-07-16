import type { CanopiFile } from '../../types/design'

export interface DesignTemplateEnvelope {
  readonly file: CanopiFile
  readonly name: string
}

export type DesignTemplateImportResult = 'opened' | 'queued' | 'cancelled' | 'superseded'
