import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import { cloneSpatialFrame } from '../../spatial-frame'
import type { SpatialFrame } from '../../types/design'

const MAX_HISTORY = 500

interface SpatialFrameHistoryEntry {
  readonly type: string
  readonly sequence: number
  readonly before: SpatialFrame
  readonly after: SpatialFrame
}

export interface DesignHistoryParticipant {
  readonly revision: ReadonlySignal<number>
  readonly canUndo: ReadonlySignal<boolean>
  readonly canRedo: ReadonlySignal<boolean>
  readonly nextUndoSequence: ReadonlySignal<number | null>
  readonly nextRedoSequence: ReadonlySignal<number | null>
  reserveSequence(): number
  announceBranch(): void
  subscribeToBranches(onBranch: () => void): () => void
  undo(): boolean
  redo(): boolean
}

interface DesignHistoryOptions {
  readonly applySpatialFrame: (frame: SpatialFrame) => void
}

export class DesignHistory implements DesignHistoryParticipant {
  private readonly applySpatialFrame: DesignHistoryOptions['applySpatialFrame']
  private readonly changeRevision = signal(0)
  private past: SpatialFrameHistoryEntry[] = []
  private future: SpatialFrameHistoryEntry[] = []
  private sequence = 0
  private readonly branchSubscribers = new Set<() => void>()

  readonly revision: ReadonlySignal<number> = this.changeRevision
  readonly canUndo = computed(() => {
    void this.changeRevision.value
    return this.past.length > 0
  })
  readonly canRedo = computed(() => {
    void this.changeRevision.value
    return this.future.length > 0
  })
  readonly nextUndoSequence = computed(() => {
    void this.changeRevision.value
    return this.past.at(-1)?.sequence ?? null
  })
  readonly nextRedoSequence = computed(() => {
    void this.changeRevision.value
    return this.future.at(-1)?.sequence ?? null
  })

  constructor(options: DesignHistoryOptions) {
    this.applySpatialFrame = options.applySpatialFrame
  }

  reserveSequence(): number {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Design history sequence exhausted')
    }
    this.sequence += 1
    return this.sequence
  }

  recordSpatialFrame(type: string, before: SpatialFrame, after: SpatialFrame): void {
    this.past.push({
      type,
      sequence: this.reserveSequence(),
      before: cloneSpatialFrame(before),
      after: cloneSpatialFrame(after),
    })
    this.future = []
    if (this.past.length > MAX_HISTORY) this.past.shift()
    batch(() => {
      this.announceBranch()
      this.publish()
    })
  }

  announceBranch(): void {
    if (this.future.length > 0) {
      this.future = []
      this.publish()
    }
    for (const subscriber of this.branchSubscribers) subscriber()
  }

  subscribeToBranches(onBranch: () => void): () => void {
    this.branchSubscribers.add(onBranch)
    return () => {
      this.branchSubscribers.delete(onBranch)
    }
  }

  undo(): boolean {
    const entry = this.past.at(-1)
    if (!entry) return false
    this.applySpatialFrame(cloneSpatialFrame(entry.before))
    this.past.pop()
    this.future.push(entry)
    this.publish()
    return true
  }

  redo(): boolean {
    const entry = this.future.at(-1)
    if (!entry) return false
    this.applySpatialFrame(cloneSpatialFrame(entry.after))
    this.future.pop()
    this.past.push(entry)
    this.publish()
    return true
  }

  clear(): void {
    this.past = []
    this.future = []
    this.publish()
  }

  private publish(): void {
    this.changeRevision.value += 1
  }
}
