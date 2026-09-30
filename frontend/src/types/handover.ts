import type { Block } from './block'
import type { ProcessNode } from './node'

/** 刻工外屋完工带回的交接包，只含版片修订号与工序节点 */
export interface HandoverPackage {
  packageNo: string
  carver: string
  handedAt: string
  note?: string
  blocks: PackageBlock[]
  nodes: PackageNode[]
}

/** 交接包里的版片记录；修订号可能缺失，由工序节点推定 */
export type PackageBlock = Omit<Block, 'schemaRev'> & {
  rev?: number
}

/** 交接包里的工序节点 */
export type PackageNode = Omit<ProcessNode, 'schemaRev'>

/** 版片对账结论 */
export type BlockDecision =
  | 'new' // 本地无此版片，直接收入
  | 'identical' // 修订号一致、内容相同，无需写入
  | 'merge-preview' // 可合并，导入前预览
  | 'conflict-rev' // 修订号不一致，保留双方并挡住覆盖
  | 'migrated-rev' // 本地缺修订号，按节点推定迁移后再对账

export interface BlockReport {
  kind: 'block'
  incoming: PackageBlock
  incomingRevInferred: boolean
  local: Block | null
  localRevInferred: boolean
  decision: BlockDecision
  /** merge-preview 时列出变化字段，供预览 */
  changedFields: Array<{ field: string; label: string; local: unknown; incoming: unknown }>
}

/** 节点对账结论 */
export type NodeDecision =
  | 'new' // 本地无此节点，收入
  | 'duplicate' // 重复工序节点，只入一条
  | 'conflict-node' // 同版同阶段同序号但内容不一致，保留双方

export interface NodeReport {
  kind: 'node'
  incoming: PackageNode
  decision: NodeDecision
  local: ProcessNode | null
}

export interface ReconcileReport {
  package: HandoverPackage
  blockReports: BlockReport[]
  nodeReports: NodeReport[]
}

/** 未决冲突的处置方式 */
export type ConflictResolution = 'keep-local' | 'take-package' | 'keep-both'
export type ConflictKind = 'block-rev' | 'node-drift'
export type PackageStatus = 'pending' | 'imported' | 'rolled-back'

/** conflicts 表：挡住覆盖的双方记录，重开后继续处理 */
export interface ConflictRecord {
  id: string
  packageId: string
  packageNo: string
  kind: ConflictKind
  blockId: string
  /** 本地原记录（版片或节点） */
  localRecord: unknown
  /** 交接包记录（版片或节点） */
  packageRecord: unknown
  localRev: number | null
  packageRev: number | null
  resolution: ConflictResolution | null
  createdAt: string
  resolvedAt: string | null
}

/** packages 表：原包归档，任何失败都不丢 */
export interface PackageArchive {
  id: string
  packageNo: string
  carver: string
  handedAt: string
  status: PackageStatus
  raw: HandoverPackage
  importedAt: string | null
  createdAt: string
}
