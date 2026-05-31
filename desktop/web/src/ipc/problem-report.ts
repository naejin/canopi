import { invoke } from '@tauri-apps/api/core'
import type { ProblemReportRequest, ProblemReportResult } from '../generated/contracts'

export type { ProblemReportRequest, ProblemReportResult }

export async function createProblemReport(
  request: ProblemReportRequest,
): Promise<ProblemReportResult> {
  return invoke('create_problem_report', { request })
}

export async function showProblemReportFolder(folderPath: string): Promise<void> {
  await invoke('show_problem_report_folder', { path: folderPath })
}
