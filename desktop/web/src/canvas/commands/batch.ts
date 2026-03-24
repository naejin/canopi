import type { Command } from '../history'
import type { CanvasEngine } from '../engine'

/**
 * BatchCommand — wraps multiple commands for atomic multi-select operations.
 * execute: execute all sub-commands in order.
 * undo: undo all sub-commands in reverse order.
 *
 * Used for multi-delete, multi-move, duplicateSelected, etc.
 */
export class BatchCommand implements Command {
  readonly type = 'batch'

  private _commands: Command[]

  constructor(commands: Command[]) {
    this._commands = commands
  }

  execute(engine: CanvasEngine): void {
    for (const cmd of this._commands) {
      cmd.execute(engine)
    }
  }

  undo(engine: CanvasEngine): void {
    for (let i = this._commands.length - 1; i >= 0; i--) {
      this._commands[i]!.undo(engine)
    }
  }

  get isEmpty(): boolean {
    return this._commands.length === 0
  }
}
