import type { CanvasCommandEngine, Command } from '../contracts'
import { DEFAULT_RENDER_PASSES } from '../runtime/render-passes'

/**
 * BatchCommand — wraps multiple commands for atomic multi-select operations.
 * execute: execute all sub-commands in order.
 * undo: undo all sub-commands in reverse order.
 *
 * Used for multi-delete, multi-move, duplicateSelected, etc.
 */
export class BatchCommand implements Command {
  readonly type = 'batch'
  readonly dirtyPasses

  private _commands: Command[]

  constructor(commands: Command[]) {
    this._commands = commands
    this.dirtyPasses = [...new Set(commands.flatMap((command) => command.dirtyPasses ?? DEFAULT_RENDER_PASSES))]
  }

  execute(engine: CanvasCommandEngine): void {
    for (const cmd of this._commands) {
      cmd.execute(engine)
    }
  }

  undo(engine: CanvasCommandEngine): void {
    for (let i = this._commands.length - 1; i >= 0; i--) {
      this._commands[i]!.undo(engine)
    }
  }

  get isEmpty(): boolean {
    return this._commands.length === 0
  }
}
