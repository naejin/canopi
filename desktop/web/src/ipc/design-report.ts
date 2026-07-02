import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import type { DesignReportInput } from '../app/design-report/actions'

export async function exportDesignReportPdf(
  input: DesignReportInput,
  defaultName: string,
): Promise<string> {
  const filePath = await save({
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!filePath) throw new Error('Dialog cancelled')
  return invoke('export_design_report_pdf', { input, path: filePath })
}
