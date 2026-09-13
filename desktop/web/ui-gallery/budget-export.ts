import { activity } from './memory-backend'

export async function deliverBudgetCsv(data: string, defaultName: string): Promise<void> {
  activity.value = `Exported ${defaultName} (${data.length} characters) in memory.`
}
