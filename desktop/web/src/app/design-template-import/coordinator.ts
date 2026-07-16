import type { TemplateMeta } from '../../types/community'

export type DesignTemplateImportResult = 'opened' | 'queued' | 'cancelled' | 'superseded'

export interface DesignTemplateImportCoordinatorAdapters<Resource> {
  readonly acquire: (template: TemplateMeta) => Promise<Resource>
  readonly open: (
    resource: Resource,
    template: TemplateMeta,
    isCancelled: () => boolean,
  ) => Promise<Exclude<DesignTemplateImportResult, 'superseded'>>
}

export interface DesignTemplateImportCoordinator {
  importTemplate(template: TemplateMeta): Promise<DesignTemplateImportResult>
  dispose(): void
}

export function createDesignTemplateImportCoordinator<Resource>(
  adapters: DesignTemplateImportCoordinatorAdapters<Resource>,
): DesignTemplateImportCoordinator {
  let latestIntent = 0
  let disposed = false

  return Object.freeze({
    async importTemplate(template: TemplateMeta) {
      if (disposed) throw new Error('Design Template import coordinator is disposed')

      const intent = ++latestIntent
      const isCancelled = () => disposed || intent !== latestIntent

      try {
        const resource = await adapters.acquire(template)
        if (isCancelled()) return 'superseded'

        const result = await adapters.open(resource, template, isCancelled)
        return isCancelled() ? 'superseded' : result
      } catch (error) {
        if (isCancelled()) return 'superseded'
        throw error
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      latestIntent += 1
    },
  })
}
