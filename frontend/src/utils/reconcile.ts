import type { Block } from '../types/block'
import type { ProcessNode } from '../types/node'
import type {
  BlockReport,
  HandoverPackage,
  NodeReport,
  PackageBlock,
  ReconcileReport,
} from '../types/handover'

/** 版片对账字段（修订号、结构修订号与主键不参与内容比对） */
const BLOCK_FIELDS: Array<{ field: keyof Block; label: string }> = [
  { field: 'draftId', label: '所属画稿' },
  { field: 'blockName', label: '版别名' },
  { field: 'colorNo', label: '套色序号' },
  { field: 'woodType', label: '木料' },
  { field: 'thicknessMm', label: '版厚(mm)' },
  { field: 'carvedBy', label: '刻工' },
  { field: 'state', label: '状态' },
  { field: 'defectNote', label: '崩口修补' },
]

/**
 * 已有数据缺少修订号时，按工序节点推定：
 * 每经历一次「修版」节点，修订号在初版 1 的基础上加一。
 */
export function inferBlockRev(blockId: string, nodes: Array<Pick<ProcessNode, 'blockId' | 'stage'>>): number {
  const repairCount = nodes.filter((node) => node.blockId === blockId && node.stage === '修版').length
  return 1 + repairCount
}

/** 补齐交接包内缺失的版片修订号，返回是否做过推定 */
export function withIncomingRevs(
  pkg: HandoverPackage,
): { blocks: Array<{ block: PackageBlock; inferred: boolean }> } {
  return {
    blocks: pkg.blocks.map((block) =>
      typeof block.rev === 'number' && Number.isFinite(block.rev)
        ? { block, inferred: false }
        : { block: { ...block, rev: inferBlockRev(block.id, pkg.nodes) }, inferred: true },
    ),
  }
}

/** 节点去重指纹：同一版片、同一工序阶段、同一序号即同一节点，只入一条 */
export function nodeFingerprint(node: Pick<ProcessNode, 'blockId' | 'batchId' | 'stage' | 'seq'>): string {
  return [node.blockId ?? '', node.batchId ?? '', node.stage, node.seq].join('|')
}

function nodePayloadEqual(a: ProcessNode, b: ProcessNode): boolean {
  return (
    a.operator === b.operator &&
    a.startedAt === b.startedAt &&
    a.durationMin === b.durationMin &&
    a.note === b.note
  )
}

/** 给迁移后的本地版片补出推定修订号，不改原对象 */
function withLocalRev(local: Block, inferredRev: number): Block {
  return { ...local, rev: inferredRev }
}

export function reconcilePackage(input: {
  pkg: HandoverPackage
  localBlocks: Block[]
  localNodes: ProcessNode[]
}): ReconcileReport {
  const { pkg } = input
  const localBlockById = new Map(input.localBlocks.map((block) => [block.id, block]))
  const localNodeByFp = new Map(input.localNodes.map((node) => [nodeFingerprint(node), node]))
  const incomingBlockById = new Map(withIncomingRevs(pkg).blocks.map((entry) => [entry.block.id, entry]))

  // 包内同指纹节点去重：重复节点只保留第一条
  const seenIncoming = new Set<string>()

  const blockReports: BlockReport[] = []
  for (const [, entry] of incomingBlockById) {
    const incoming = entry.block
    const localRaw = localBlockById.get(incoming.id) ?? null

    let local = localRaw
    let localRevInferred = false
    let decision: BlockReport['decision']
    let changedFields: BlockReport['changedFields'] = []

    if (!local) {
      decision = 'new'
    } else if (typeof localRaw!.rev !== 'number') {
      // 本地旧档缺修订号：按节点推定迁移，再逐项对账
      const inferredRev = inferBlockRev(local.id, input.localNodes)
      local = withLocalRev(localRaw!, inferredRev)
      localRevInferred = true
      decision = 'migrated-rev'
      if (local.rev !== incoming.rev) {
        decision = 'conflict-rev'
      } else {
        changedFields = diffFields(localRaw!, incoming)
        decision = changedFields.length > 0 ? 'merge-preview' : 'identical'
      }
    } else if (local.rev !== incoming.rev) {
      decision = 'conflict-rev'
    } else {
      changedFields = diffFields(local, incoming)
      decision = changedFields.length > 0 ? 'merge-preview' : 'identical'
    }

    blockReports.push({
      kind: 'block',
      incoming,
      incomingRevInferred: entry.inferred,
      local,
      localRevInferred,
      decision,
      changedFields,
    })
  }

  const nodeReports: NodeReport[] = []
  for (const incomingRaw of pkg.nodes) {
    const fp = nodeFingerprint(incomingRaw)
    if (seenIncoming.has(fp)) {
      // 同一交接包内重复登记的工序节点，只入一条
      nodeReports.push({ kind: 'node', incoming: incomingRaw, decision: 'duplicate', local: null })
      continue
    }
    seenIncoming.add(fp)

    const local = localNodeByFp.get(fp) ?? null
    if (!local) {
      nodeReports.push({ kind: 'node', incoming: incomingRaw, decision: 'new', local: null })
    } else if (nodePayloadEqual(local, incomingRaw)) {
      nodeReports.push({ kind: 'node', incoming: incomingRaw, decision: 'duplicate', local })
    } else {
      nodeReports.push({ kind: 'node', incoming: incomingRaw, decision: 'conflict-node', local })
    }
  }

  return { package: pkg, blockReports, nodeReports }
}

function diffFields(local: Block, incoming: PackageBlock): BlockReport['changedFields'] {
  const changed: BlockReport['changedFields'] = []
  for (const { field, label } of BLOCK_FIELDS) {
    if ((local[field] ?? '') !== (incoming[field] ?? '')) {
      changed.push({ field, label, local: local[field] ?? '', incoming: incoming[field] ?? '' })
    }
  }
  return changed
}
