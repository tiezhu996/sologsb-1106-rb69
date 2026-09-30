import type { Block } from './block'
import type { ProcessNode } from './node'

/**
 * 刻工外屋完工带回的"交接包"。
 * - blocks：版片修订记录，必须带 rev（修订号）
 * - nodes：本包登记的工序节点（管事手抄，可能有重复）
 */
export interface HandoffPackage {
  packageNo: string
  handedAt: string
  blocks: Block[]
  nodes: ProcessNode[]
}

export type BlockReconcileKind = 'add' | 'merge' | 'conflict'

/** 版片对账条目：新增、可合并（修订号一致）或冲突（修订号不一致） */
export interface BlockReconcileEntry {
  kind: BlockReconcileKind
  incoming: Block
  local: Block | null
  localRev: number | null
  incomingRev: number
  /** 修订号一致但字段有差异时，可合并的字段名 */
  changedFields: string[]
}

export type NodeReconcileKind = 'add' | 'skip-duplicate'

/** 工序节点对账条目：本地或包内同节点重复时只入一条 */
export interface NodeReconcileEntry {
  kind: NodeReconcileKind
  incoming: ProcessNode
  /** 命中重复时，本地或本包中已保留的那一条节点 id */
  duplicateOfId?: string
  /** 新增节点落库时重新排定的节点序号（按该版片现有节点顺延） */
  resolvedSeq?: number
}

export interface ReconcileReport {
  packageNo: string
  handedAt: string
  blockEntries: BlockReconcileEntry[]
  nodeEntries: NodeReconcileEntry[]
  blockStats: {
    add: number
    merge: number
    conflict: number
  }
  nodeStats: {
    add: number
    skipDuplicate: number
  }
}

export type ConflictResolution = 'pending' | 'take-incoming' | 'keep-local'

/**
 * 修订号不一致的未决冲突：保留双方，挡住覆盖。
 * 重开页面后仍可继续裁决。
 */
export interface BlockRevisionConflict {
  id: string
  packageNo: string
  blockId: string
  incomingRev: number
  localRev: number
  incomingBlock: Block
  localBlock: Block
  status: ConflictResolution
  detectedAt: string
  resolvedAt?: string
}
