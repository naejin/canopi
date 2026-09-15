import { cloneSpatialFrame } from '../../spatial-frame'
import type { SpatialFrame } from '../../types/design'
import { designSessionStore } from '../document-session/store'
import {
  beginDesignPreview,
  type DesignPreviewOutcome,
  type DesignPreviewTransaction,
} from './core'

export interface DesignPlacementEditTransaction {
  readonly original: SpatialFrame
  readonly hasMutated: boolean
  preview(frame: SpatialFrame): void
  commit(): DesignPreviewOutcome
  abort(): DesignPreviewOutcome
}

class StoreDesignPlacementEditTransaction implements DesignPlacementEditTransaction {
  readonly original: SpatialFrame
  private readonly transaction: DesignPreviewTransaction

  constructor() {
    const design = designSessionStore.readCurrentDesign()
    this.original = cloneSpatialFrame(design?.spatial_frame ?? missingSpatialFrame())
    this.transaction = beginDesignPreview(
      'Design spatial placement preview',
      { history: { type: 'design-spatial-placement', field: 'spatial_frame' } },
    )
  }

  get hasMutated(): boolean {
    return this.transaction.hasMutated
  }

  preview(frame: SpatialFrame): void {
    const candidate = cloneSpatialFrame(frame)
    this.transaction.preview((design) => spatialFramesEqual(design.spatial_frame, candidate)
      ? design
      : { ...design, spatial_frame: cloneSpatialFrame(candidate) })
  }

  commit(): DesignPreviewOutcome {
    return this.transaction.commit()
  }

  abort(): DesignPreviewOutcome {
    return this.transaction.abort()
  }
}

export function beginDesignPlacementEdit(): DesignPlacementEditTransaction {
  return new StoreDesignPlacementEditTransaction()
}

function spatialFramesEqual(left: SpatialFrame, right: SpatialFrame): boolean {
  return left.anchor_longitude_deg === right.anchor_longitude_deg
    && left.anchor_latitude_deg === right.anchor_latitude_deg
    && left.north_bearing_deg === right.north_bearing_deg
    && left.placement_status === right.placement_status
    && left.location_metadata.altitude_m === right.location_metadata.altitude_m
}

function missingSpatialFrame(): never {
  throw new Error('Cannot begin spatial placement without an active Design')
}
