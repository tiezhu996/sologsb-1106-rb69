import type { Block } from '../types/block'
import type { ProcessNode } from '../types/node'
import type {
  BlockReconcileEntry,
  HandoffPackage,
  NodeReconcileEntry,
  ReconcileReport,
} from '../types/handoff'

/** 参与"内容是否一致"比对的版片字段（修订号本身单独对账） */
export const BLOCK_COMPARE_FIELDS = [
  'draftId',
  'blockName',
  'colorNo',
  'woodType',
  'thicknessMm',
  'carvedBy',
  'state',
  'defectNote',
] as const

type ComparableField = (typeof BLOCK_COMPARE_FIELDS)[number]

function changedFieldsOf(local: Block, incoming: Block): string[] {
  return BLOCK_COMPARE_FIELDS.filter((field: ComparableField) => local[field] !== incoming[field])
}

/** 节点自然身份：同一版片的同一工序环节只算一条 */
export function nodeSignature(node: ProcessNode): string {
  return `${node.blockId ?? ''}::${node.stage}`
}

export interface ReconcileContext {
  localBlocks: Block[]
  localNodes: ProcessNode[]
}

/**
 * 导入前逐项对账：
 * - 本地没有的版片 -> 新增
 * - 修订号一致的版片 -> 可合并（预览字段差异）
 * - 修订号不一致的版片 -> 冲突，保留双方并挡住覆盖
 * - 节点按 (blockId, stage) 去重，本地已有或包内重复都只入一条
 */
export function reconcilePackage(pkg: HandoffPackage, context: ReconcileContext): ReconcileReport {
  const localBlocksById = new Map<string, Block>()
  for (const block of context.localBlocks) localBlocksById.set(block.id, block)

  // 包内同一版片修订号若多次出现，以最后一次为准（管事手抄留痕以最终修订为准）
  const incomingBlocksById = new Map<string, Block>()
  for (const block of pkg.blocks) incomingBlocksById.set(block.id, block)

  const blockEntries: BlockReconcileEntry[] = []
  for (const incoming of incomingBlocksById.values()) {
    const local = localBlocksById.get(incoming.id) ?? null
    if (!local) {
      blockEntries.push({
        kind: 'add',
        incoming,
        local: null,
        localRev: null,
        incomingRev: incoming.rev,
        changedFields: [],
      })
      continue
    }

    if (local.rev !== incoming.rev) {
      blockEntries.push({
        kind: 'conflict',
        incoming,
        local,
        localRev: local.rev,
        incomingRev: incoming.rev,
        changedFields: changedFieldsOf(local, incoming),
      })
      continue
    }

    blockEntries.push({
      kind: 'merge',
      incoming,
      local,
      localRev: local.rev,
      incomingRev: incoming.rev,
      changedFields: changedFieldsOf(local, incoming),
    })
  }

  // 已存在节点身份集合：本地已有 + 本包内已保留
  const seenSignatures = new Set<string>()
  for (const node of context.localNodes) {
    if (node.blockId) seenSignatures.add(nodeSignature(node))
  }

  // 本地每个版片已占用的最大节点序号，用于新增节点顺延
  const maxSeqByBlock = new Map<string, number>()
  for (const node of context.localNodes) {
    if (!node.blockId) continue
    maxSeqByBlock.set(node.blockId, Math.max(maxSeqByBlock.get(node.blockId) ?? 0, node.seq))
  }

  const nodeEntries: NodeReconcileEntry[] = []
  for (const incoming of pkg.nodes) {
    const signature = nodeSignature(incoming)
    if (seenSignatures.has(signature)) {
      const localHit = context.localNodes.find(
        (node) => node.blockId && nodeSignature(node) === signature,
      )
      nodeEntries.push({
        kind: 'skip-duplicate',
        incoming,
        duplicateOfId: localHit?.id,
      })
      continue
    }

    seenSignatures.add(signature)
    const blockId = incoming.blockId ?? ''
    const nextSeq = (maxSeqByBlock.get(blockId) ?? 0) + 1
    maxSeqByBlock.set(blockId, nextSeq)
    nodeEntries.push({
      kind: 'add',
      incoming,
      resolvedSeq: nextSeq,
    })
  }

  return {
    packageNo: pkg.packageNo,
    handedAt: pkg.handedAt,
    blockEntries,
    nodeEntries,
    blockStats: {
      add: blockEntries.filter((entry) => entry.kind === 'add').length,
      merge: blockEntries.filter((entry) => entry.kind === 'merge').length,
      conflict: blockEntries.filter((entry) => entry.kind === 'conflict').length,
    },
    nodeStats: {
      add: nodeEntries.filter((entry) => entry.kind === 'add').length,
      skipDuplicate: nodeEntries.filter((entry) => entry.kind === 'skip-duplicate').length,
    },
  }
}
