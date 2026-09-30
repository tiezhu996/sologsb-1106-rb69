import { db } from './db'
import { inferBlockRev, reconcilePackage } from './reconcile'
import type { Block } from '../types/block'
import type { ProcessNode, ProcessStage } from '../types/node'
import type {
  ConflictRecord,
  ConflictResolution,
  HandoverPackage,
  PackageArchive,
  PackageBlock,
} from '../types/handover'

const SCHEMA_REV = 3
const STAGES: ProcessStage[] = ['起稿', '勾描', '上样', '刻版', '修版', '调色', '套印', '晾晒']

/** IndexedDB 内的带结构修订号的存储形状（与 db.ts 既有约定一致） */
type StoredBlock = Block & { schemaRev: number }
type StoredNode = ProcessNode & { schemaRev: number }

export interface PackageValidation {
  ok: boolean
  errors: string[]
  package: HandoverPackage | null
}

/** 解析并校验交接包 JSON */
export function parseHandoverPackage(text: string): PackageValidation {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['文件不是合法 JSON，请核对交接包原文。'], package: null }
  }

  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['交接包顶层应为对象。'], package: null }
  }
  const source = raw as Record<string, unknown>

  const packageNo = typeof source.packageNo === 'string' ? source.packageNo.trim() : ''
  const carver = typeof source.carver === 'string' ? source.carver.trim() : ''
  const handedAt = typeof source.handedAt === 'string' ? source.handedAt.trim() : ''
  if (!packageNo) errors.push('缺少交接包编号 packageNo。')
  if (!carver) errors.push('缺少交回刻工 carver。')
  if (!handedAt) errors.push('缺少交回时间 handedAt。')

  if (!Array.isArray(source.blocks)) errors.push('交接包缺少版片清单 blocks。')
  if (!Array.isArray(source.nodes)) errors.push('交接包缺少工序节点清单 nodes。')
  if (errors.length > 0) return { ok: false, errors, package: null }

  const blocks: PackageBlock[] = []
  const blockIds = new Set<string>()
  for (const [index, item] of (source.blocks as unknown[]).entries()) {
    const where = `版片第 ${index + 1} 条`
    if (typeof item !== 'object' || item === null) {
      errors.push(`${where}不是对象。`)
      continue
    }
    const b = item as Record<string, unknown>
    if (typeof b.id !== 'string' || !b.id.trim()) errors.push(`${where}缺少版片编号。`)
    else if (blockIds.has(b.id)) errors.push(`${where}版片编号 ${b.id} 在包内重复。`)
    else blockIds.add(b.id)

    if (typeof b.draftId !== 'string' || !b.draftId.trim()) errors.push(`${where}缺少所属画稿。`)
    if (typeof b.blockName !== 'string') errors.push(`${where}缺少版别名。`)
    if (!Number.isFinite(Number(b.colorNo))) errors.push(`${where}套色序号应为数字。`)
    if (typeof b.woodType !== 'string') errors.push(`${where}缺少木料。`)
    if (!Number.isFinite(Number(b.thicknessMm))) errors.push(`${where}版厚应为数字。`)
    if (typeof b.carvedBy !== 'string') errors.push(`${where}缺少刻工。`)
    if (typeof b.state !== 'string') errors.push(`${where}缺少版片状态。`)
    if (b.rev !== undefined && (!Number.isInteger(Number(b.rev)) || Number(b.rev) < 1)) {
      errors.push(`${where}修订号应为不小于 1 的整数。`)
    }

    blocks.push({
      id: String(b.id ?? ''),
      draftId: String(b.draftId ?? ''),
      blockName: b.blockName as PackageBlock['blockName'],
      colorNo: Number(b.colorNo),
      woodType: b.woodType as PackageBlock['woodType'],
      thicknessMm: Number(b.thicknessMm),
      carvedBy: String(b.carvedBy ?? ''),
      state: b.state as PackageBlock['state'],
      defectNote: typeof b.defectNote === 'string' ? b.defectNote : '',
      ...(b.rev !== undefined ? { rev: Number(b.rev) } : {}),
    })
  }

  const nodes: ProcessNode[] = []
  const nodeIds = new Set<string>()
  for (const [index, item] of (source.nodes as unknown[]).entries()) {
    const where = `工序节点第 ${index + 1} 条`
    if (typeof item !== 'object' || item === null) {
      errors.push(`${where}不是对象。`)
      continue
    }
    const n = item as Record<string, unknown>
    if (typeof n.id !== 'string' || !n.id.trim()) errors.push(`${where}缺少节点编号。`)
    else if (nodeIds.has(n.id)) errors.push(`${where}节点编号 ${n.id} 在包内重复。`)
    else nodeIds.add(n.id)

    if (typeof n.stage !== 'string' || !STAGES.includes(n.stage as ProcessStage)) {
      errors.push(`${where}工序阶段不合法。`)
    }
    if (!Number.isInteger(Number(n.seq)) || Number(n.seq) < 1) errors.push(`${where}节点序号应为正整数。`)
    if (n.blockId !== undefined && n.blockId !== null && typeof n.blockId !== 'string') {
      errors.push(`${where}版片编号应为字符串。`)
    }
    if (n.batchId !== undefined && n.batchId !== null && typeof n.batchId !== 'string') {
      errors.push(`${where}批次编号应为字符串。`)
    }

    nodes.push({
      id: String(n.id ?? ''),
      stage: n.stage as ProcessStage,
      seq: Number(n.seq),
      operator: typeof n.operator === 'string' ? n.operator : '',
      startedAt: typeof n.startedAt === 'string' ? n.startedAt : '',
      durationMin: Number.isFinite(Number(n.durationMin)) ? Number(n.durationMin) : 0,
      note: typeof n.note === 'string' ? n.note : '',
      ...(typeof n.blockId === 'string' ? { blockId: n.blockId } : {}),
      ...(typeof n.batchId === 'string' ? { batchId: n.batchId } : {}),
    })
  }

  if (errors.length > 0) return { ok: false, errors, package: null }

  return {
    ok: true,
    errors: [],
    package: {
      packageNo,
      carver,
      handedAt,
      note: typeof source.note === 'string' ? source.note : undefined,
      blocks,
      nodes,
    },
  }
}

function packageKey(pkg: HandoverPackage): string {
  const basis = `${pkg.packageNo}|${pkg.carver}|${pkg.handedAt}`
  let hash = 0
  for (let i = 0; i < basis.length; i += 1) {
    hash = (hash * 31 + basis.charCodeAt(i)) | 0
  }
  return `pkg-${(hash >>> 0).toString(36)}-${pkg.blocks.length}b${pkg.nodes.length}n`
}

function toStoredBlock(incoming: PackageBlock, rev: number): StoredBlock {
  const { rev: _omitted, ...rest } = incoming
  return { ...rest, rev, schemaRev: SCHEMA_REV }
}

function toStoredNode(incoming: HandoverPackage['nodes'][number]): StoredNode {
  return { ...incoming, schemaRev: SCHEMA_REV }
}

export interface CommitSummary {
  packageId: string
  status: PackageArchive['status']
  addedBlocks: number
  mergedBlocks: number
  migratedBlocks: number
  addedNodes: number
  duplicateNodes: number
  conflicts: number
}

export interface CommitOptions {
  /** 演练用：累计写入达到该次数时主动失败，验证整包回滚 */
  faultAtWrite?: number
}

/**
 * 导入交接包：
 * 1. 先在独立事务归档原包（任何失败原包都不丢，状态留待处理）；
 * 2. 再开一个读写事务逐项对账写入，中途失败整包回滚，已有档案不动；
 * 3. 修订号不一致与节点漂移只入冲突账，挡住覆盖，重开后可继续处置。
 */
export async function commitHandoverPackage(pkg: HandoverPackage, options: CommitOptions = {}): Promise<CommitSummary> {
  const packageId = packageKey(pkg)
  const now = new Date().toISOString()

  // 第一步：原包先落账（独立事务，不受后续回滚影响）
  await db.transaction('rw', db.packages, async () => {
    const existing = await db.packages.get(packageId)
    await db.packages.put({
      id: packageId,
      packageNo: pkg.packageNo,
      carver: pkg.carver,
      handedAt: pkg.handedAt,
      status: 'pending',
      raw: pkg,
      importedAt: null,
      createdAt: existing?.createdAt ?? now,
    })
  })

  const summary: CommitSummary = {
    packageId,
    status: 'pending',
    addedBlocks: 0,
    mergedBlocks: 0,
    migratedBlocks: 0,
    addedNodes: 0,
    duplicateNodes: 0,
    conflicts: 0,
  }

  // 第二步：对账写入，单事务原子提交
  let writeCount = 0
  const gate = async (): Promise<void> => {
    writeCount += 1
    if (options.faultAtWrite !== undefined && writeCount >= options.faultAtWrite) {
      throw new Error(`演练故障：第 ${writeCount} 次写入中断，整包回滚。`)
    }
  }

  try {
    await db.transaction('rw', db.blocks, db.nodes, db.conflicts, db.packages, async () => {
      const [localBlocks, localNodes, openConflicts] = await Promise.all([
        db.blocks.toArray(),
        db.nodes.toArray(),
        db.conflicts.where('packageId').equals(packageId).toArray(),
      ])

      const report = reconcilePackage({ pkg, localBlocks, localNodes })
      const conflictExists = (kind: ConflictRecord['kind'], recordId: string): boolean =>
        openConflicts.some((item) => item.kind === kind && (item.packageRecord as { id?: string })?.id === recordId)
      const persistConflict = async (record: Omit<ConflictRecord, 'id' | 'createdAt' | 'resolvedAt' | 'resolution'>): Promise<void> => {
        const recordId = (record.packageRecord as { id?: string }).id ?? record.blockId
        if (conflictExists(record.kind, recordId)) return
        await gate()
        await db.conflicts.add({
          ...record,
          id: `conflict-${crypto.randomUUID()}`,
          resolution: null,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
        })
        summary.conflicts += 1
      }

      // 版片逐项对账
      for (const item of report.blockReports) {
        const incomingRev = item.incoming.rev ?? inferBlockRev(item.incoming.id, pkg.nodes)

        if (item.decision === 'new') {
          await gate()
          await db.blocks.put(toStoredBlock(item.incoming, incomingRev))
          summary.addedBlocks += 1
          continue
        }

        // 本地旧档迁移：无论后续是否挡住覆盖，推定修订号都先落库
        if (item.localRevInferred && item.local && typeof item.local.rev === 'number') {
          await gate()
          await db.blocks.update(item.incoming.id, { rev: item.local.rev })
          summary.migratedBlocks += 1
        }

        if (item.decision === 'identical') {
          continue
        }
        if (item.decision === 'merge-preview') {
          await gate()
          await db.blocks.put(toStoredBlock(item.incoming, incomingRev))
          summary.mergedBlocks += 1
          continue
        }
        if (item.decision === 'conflict-rev') {
          await persistConflict({
            packageId,
            packageNo: pkg.packageNo,
            kind: 'block-rev',
            blockId: item.incoming.id,
            localRecord: item.local,
            packageRecord: item.incoming,
            localRev: item.local?.rev ?? null,
            packageRev: incomingRev,
          })
        }
      }

      // 工序节点逐项对账
      for (const item of report.nodeReports) {
        if (item.decision === 'new') {
          await gate()
          await db.nodes.add(toStoredNode(item.incoming))
          summary.addedNodes += 1
        } else if (item.decision === 'duplicate') {
          summary.duplicateNodes += 1
        } else {
          await persistConflict({
            packageId,
            packageNo: pkg.packageNo,
            kind: 'node-drift',
            blockId: item.incoming.blockId ?? '',
            localRecord: item.local,
            packageRecord: item.incoming,
            localRev: null,
            packageRev: null,
          })
        }
      }

      // 全部写入成功：原包标记已导入；若本事务失败，此行随事务回滚，原包保留 pending
      await gate()
      await db.packages.update(packageId, { status: 'imported', importedAt: new Date().toISOString() })
      summary.status = 'imported'
    })
  } catch (error) {
    // 写入事务已整包回滚：原包仍在，标记回滚态，重开后可再次提交
    await db.transaction('rw', db.packages, async () => {
      await db.packages.update(packageId, { status: 'rolled-back' })
    })
    summary.status = 'rolled-back'
    throw error
  }

  return summary
}

export async function listPackages(): Promise<PackageArchive[]> {
  const records = await db.packages.toArray()
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return records
}

export async function listOpenConflicts(): Promise<ConflictRecord[]> {
  const records = await db.conflicts.toArray()
  return records
    .filter((record) => record.resolution === null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 处置未决冲突（重开后继续处理）：
 * - block-rev / node-drift 均可保留本地、采用交接包或双方并存；
 * - 处置在独立事务内完成，失败不影响冲突账与已有档案。
 */
export async function resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void> {
  await db.transaction('rw', db.blocks, db.nodes, db.conflicts, async () => {
    const conflict = await db.conflicts.get(conflictId)
    if (!conflict || conflict.resolution !== null) return

    const pkgRecord = conflict.packageRecord as Record<string, unknown>

    if (resolution === 'take-package') {
      if (conflict.kind === 'block-rev') {
        const incoming = pkgRecord as unknown as PackageBlock
        const rev = conflict.packageRev ?? inferBlockRev(incoming.id, [])
        await db.blocks.put(toStoredBlock(incoming, rev))
      } else {
        const incoming = pkgRecord as unknown as ProcessNode
        await db.nodes.put(toStoredNode(incoming))
      }
    } else if (resolution === 'keep-both' && conflict.kind === 'node-drift') {
      // 节点双方并存：交接包一侧换号补入，时间线两条都在
      const incoming = pkgRecord as unknown as ProcessNode
      await db.nodes.add({ ...toStoredNode(incoming), id: `${incoming.id}--pkg-${conflict.packageId}` })
    }
    // keep-local：档案不动；block-rev 的 keep-both：双方版本留在冲突账中，不覆盖档案

    await db.conflicts.update(conflictId, { resolution, resolvedAt: new Date().toISOString() })
  })
}
