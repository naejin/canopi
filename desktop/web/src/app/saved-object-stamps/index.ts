import {
  createSavedObjectStampWorkbench,
  type SavedObjectStampLibraryView,
  type SavedObjectStampSelectionView,
  type SavedObjectStampWorkbench,
} from './workbench'

const liveSavedObjectStampWorkbench = createSavedObjectStampWorkbench()

export const savedObjectStampWorkbench: SavedObjectStampWorkbench =
  liveSavedObjectStampWorkbench

export {
  createSavedObjectStampWorkbench,
  type SavedObjectStampLibraryView,
  type SavedObjectStampSelectionView,
  type SavedObjectStampWorkbench,
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    liveSavedObjectStampWorkbench.dispose()
  })
}
