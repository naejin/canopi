import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'

/** Show a save dialog for a text export, then write it through the native boundary. */
export async function exportFile(
  data: string,
  defaultName: string,
  filterName: string,
  filterExt: string[],
): Promise<string> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: filterName, extensions: filterExt }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  // The native boundary accepts only the exported formats' extensions.
  const hasExtension = filterExt.some((ext) => filePath.toLowerCase().endsWith(`.${ext.toLowerCase()}`))
  return invoke('export_file', { data, path: hasExtension ? filePath : `${filePath}.${filterExt[0]}` })
}
