import type { Block } from '../types/block'
import type { ProcessNode } from '../types/node'
import type { BlockRevisionConflict, ConflictResolution, HandoffPackage, ReconcileReport } from '../types/handoff'
import { reconcilePackage } from './reconcile'
import { db } from './db'

/** 取本地档案并生成对账预览（不落库，供"导入前预览"） */
export async function previewHandoff(pkg: HandoffPackage): Promise<ReconcileReport> {
  const [localBlocks, localNodes] = await Promise.all([db.blocks.toArray(), db.nodes.toArray()])
  return reconcilePackage(pkg, { localBlocks, localNodes })
}

function stripInternal<T extends object>(record: T): T {
  const { schemaRev: _schemaRev, ...rest } = record as Record<string, unknown>
  return rest as T
}

/**
 * 按对账预览整包提交：
 * - 新增 / 可合并版片写入 blocks
 * - 修订号冲突版片双方存入 conflicts，本地块原样保留（挡住覆盖）
 * - 节点去重后只入新增的一条
 * 全部在同一个 rw 事务内完成，中途任一步失败则整包回滚，
 * 原交接包与已有档案都不会缺。
 */
export async function commitHandoff(pkg: HandoffPackage): Promise<{ conflictsCreated: number; nodesAdded: number }> {
  const nowIso = new Date().toISOString()
  let conflictsCreated = 0
  let nodesAdded = 0

  await db.transaction('rw', db.blocks, db.nodes, db.conflicts, async () => {
    // 事务内重新读取，保证预览与提交之间的状态一致
    const [localBlocks, localNodes] = await Promise.all([db.blocks.toArray(), db.nodes.toArray()])
    const liveReport = reconcilePackage(pkg, { localBlocks, localNodes })

    for (const entry of liveReport.blockEntries) {
      if (entry.kind === 'add' || entry.kind === 'merge') {
        const block: Block = { ...stripInternal(entry.incoming) }
        await db.blocks.put(block)
      } else {
        // 修订号不一致：保留双方，挡住覆盖
        const existing = await db.conflicts
          .where('blockId')
          .equals(entry.incoming.id)
          .filter((item) => item.status === 'pending')
          .first()
        if (existing) continue

        const conflict: BlockRevisionConflict = {
          id: `conflict-${crypto.randomUUID()}`,
          packageNo: pkg.packageNo,
          blockId: entry.incoming.id,
          incomingRev: entry.incomingRev,
          localRev: entry.localRev ?? entry.local?.rev ?? 0,
          incomingBlock: stripInternal(entry.incoming),
          localBlock: entry.local ? stripInternal(entry.local) : ({} as Block),
          status: 'pending',
          detectedAt: nowIso,
        }
        await db.conflicts.add(conflict)
        conflictsCreated += 1
      }
    }

    for (const entry of liveReport.nodeEntries) {
      if (entry.kind !== 'add') continue
      const node: ProcessNode = {
        ...stripInternal(entry.incoming),
        seq: entry.resolvedSeq ?? entry.incoming.seq,
      }
      await db.nodes.add(node)
      nodesAdded += 1
    }
  })

  return { conflictsCreated, nodesAdded }
}

export async function loadPendingConflicts(): Promise<BlockRevisionConflict[]> {
  const records = await db.conflicts.where('status').equals('pending').toArray()
  records.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
  return records
}

export async function loadResolvedConflicts(): Promise<BlockRevisionConflict[]> {
  const records = await db.conflicts.toArray()
  return records
    .filter((item) => item.status !== 'pending')
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
}

/**
 * 重开后继续处理未决冲突。
 * - take-incoming：用交接包那一方覆盖本地，并记录修订号
 * - keep-local：维持本地，仅结案
 * 与冲突结案在同一事务内提交，失败回滚。
 */
export async function resolveConflict(conflictId: string, resolution: Exclude<ConflictResolution, 'pending'>): Promise<void> {
  await db.transaction('rw', db.blocks, db.conflicts, async () => {
    const conflict = await db.conflicts.get(conflictId)
    if (!conflict || conflict.status !== 'pending') return

    if (resolution === 'take-incoming') {
      await db.blocks.put({ ...stripInternal(conflict.incomingBlock) })
    }
    await db.conflicts.update(conflictId, {
      status: resolution,
      resolvedAt: new Date().toISOString(),
    })
  })
}
