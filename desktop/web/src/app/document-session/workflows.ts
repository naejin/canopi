import { consortiumSyncWorkflow } from '../consortium/workflow'
import type { DesignSessionWorkflow } from './workflow-runner'

export const DESIGN_SESSION_WORKFLOWS: readonly DesignSessionWorkflow[] = [
  consortiumSyncWorkflow,
]
