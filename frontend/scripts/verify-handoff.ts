/**
 * 交接包对账端到端验证（Node + fake-indexeddb）：
 *   npx tsx scripts/verify-handoff.ts
 * 覆盖：v2→v3 迁移推定、新增/合并/冲突、节点去重、原子提交、失败整包回滚、重开后续裁。
 */
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

const DB_NAME = 'gbwoodprint-db'

interface MiniBlock {
  id: string
  draftId: string
  blockName: string
  colorNo: number
  woodType: string
  thicknessMm: number
  carvedBy: string
  state: string
  defectNote: string
  rev?: number
  schemaRev?: number
}
interface MiniNode {
  id: string
  blockId?: string
  stage: string
  seq: number
  operator: string
  startedAt: string
  durationMin: number
  note: string
  schemaRev?: number
}

async function seedVersionTwo(): Promise<void> {
  const legacy = new Dexie(DB_NAME)
  legacy.version(2).stores({
    drafts: 'id, genre, status, title, schemaRev',
    blocks: 'id, draftId, colorNo, carvedBy, state, schemaRev',
    carvers: 'id, specialty, skillLevel, name, schemaRev',
    batches: 'id, draftId, batchNo, printedAt, schemaRev',
    nodes: 'id, batchId, blockId, stage, seq, operator, schemaRev',
  })

  const blocks: MiniBlock[] = [
    { id: 'b-merge', draftId: 'd1', blockName: '红版', colorNo: 3, woodType: '梨木', thicknessMm: 20, carvedBy: '陈', state: '在刻', defectNote: '', schemaRev: 2 },
    { id: 'b-conflict', draftId: 'd1', blockName: '黄版', colorNo: 2, woodType: '梨木', thicknessMm: 20, carvedBy: '周', state: '在刻', defectNote: '', schemaRev: 2 },
    { id: 'b-repair2', draftId: 'd1', blockName: '墨线版', colorNo: 1, woodType: '黄杨', thicknessMm: 18, carvedBy: '齐', state: '已修版', defectNote: '', schemaRev: 2 },
  ]
  const nodes: MiniNode[] = [
    { id: 'n1', blockId: 'b-repair2', stage: '修版', seq: 1, operator: '秦', startedAt: '2026-01-01T08:00', durationMin: 60, note: '修', schemaRev: 2 },
    { id: 'n2', blockId: 'b-repair2', stage: '修版', seq: 2, operator: '秦', startedAt: '2026-01-02T08:00', durationMin: 60, note: '再修', schemaRev: 2 },
    { id: 'n3', blockId: 'b-merge', stage: '刻版', seq: 1, operator: '陈', startedAt: '2026-01-03T08:00', durationMin: 60, note: '刻', schemaRev: 2 },
  ]
  await legacy.table('blocks').bulkAdd(blocks)
  await legacy.table('nodes').bulkAdd(nodes)
  await legacy.close()
}

async function main(): Promise<void> {
  await seedVersionTwo()

  const { db } = await import('../src/utils/db.ts')
  await db.open()

  // 1) 迁移推定：无修订号按修版节点数 +1
  const bRepair = await db.blocks.get('b-repair2')
  assert.equal(bRepair?.rev, 3, '两次修版节点应推定 rev=3')
  const bMerge = await db.blocks.get('b-merge')
  assert.equal(bMerge?.rev, 1, '无修版节点应推定 rev=1')

  const { reconcilePackage } = await import('../src/utils/reconcile.ts')
  const { commitHandoff, previewHandoff, loadPendingConflicts, resolveConflict } = await import('../src/utils/handoff.ts')

  // 2) 对账预览：新增 / 合并(rev一致内容改) / 冲突(rev不一致) / 节点去重
  const pkg = {
    packageNo: 'pkg-A',
    handedAt: '2026-09-30T12:00',
    blocks: [
      { id: 'b-merge', draftId: 'd1', blockName: '红版', colorNo: 3, woodType: '梨木', thicknessMm: 20, carvedBy: '陈', state: '已刻成', defectNote: '崩口嵌补', rev: 1 },
      { id: 'b-conflict', draftId: 'd1', blockName: '黄版', colorNo: 2, woodType: '梨木', thicknessMm: 20, carvedBy: '周', state: '已刻成', defectNote: '加深一刀', rev: 2 },
      { id: 'b-new', draftId: 'd1', blockName: '副版', colorNo: 5, woodType: '梨木', thicknessMm: 17, carvedBy: '秦', state: '在刻', defectNote: '新增副版', rev: 1 },
    ],
    nodes: [
      { id: 'p1', blockId: 'b-merge', stage: '修版', seq: 9, operator: '秦', startedAt: '2026-09-30T10:00', durationMin: 40, note: '修' },
      { id: 'p2', blockId: 'b-merge', stage: '刻版', seq: 9, operator: '陈', startedAt: '2026-09-30T11:00', durationMin: 40, note: '与本地同身份->重复' },
      { id: 'p3', blockId: 'b-merge', stage: '修版', seq: 9, operator: '秦', startedAt: '2026-09-30T10:30', durationMin: 40, note: '包内重复' },
    ],
  }

  const report = await previewHandoff(pkg)
  assert.equal(report.blockStats.add, 1)
  assert.equal(report.blockStats.merge, 1)
  assert.equal(report.blockStats.conflict, 1)
  assert.equal(report.nodeStats.add, 1, '仅修版节点为新增')
  assert.equal(report.nodeStats.skipDuplicate, 2, '本地重复 + 包内重复都跳过')
  const addedNode = report.nodeEntries.find((e) => e.kind === 'add')
  assert.equal(addedNode?.resolvedSeq, 2, '新增节点按该版片现有 seq 顺延为 2')
  assert.ok(report.blockEntries.find((e) => e.kind === 'merge')?.changedFields.includes('state'))

  await commitHandoff(pkg)

  // 3) 合并已覆盖、新增已入；冲突块本地未被覆盖
  const merged = await db.blocks.get('b-merge')
  assert.equal(merged?.state, '已刻成')
  assert.equal(merged?.defectNote, '崩口嵌补')
  const added = await db.blocks.get('b-new')
  assert.equal(added?.rev, 1)
  const conflictLocal = await db.blocks.get('b-conflict')
  assert.equal(conflictLocal?.state, '在刻', '冲突块本地必须原样保留，挡住覆盖')
  const conflictNodes = await db.nodes.where('blockId').equals('b-merge').toArray()
  assert.equal(conflictNodes.length, 2, '仅新增 1 条节点（本地刻版 + 新修版）')
  assert.equal([...conflictNodes].sort((a, b) => a.seq - b.seq)[1]?.seq, 2)

  // 4) 未决冲突持久化，"重开"可继续处理
  const conflicts = await loadPendingConflicts()
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0]?.incomingBlock.state, '已刻成')

  // 5) 失败整包回滚：写入中途抛错（模拟 IndexedDB 写失败），已有档案与原包都不能少
  const beforeBlockCount = await db.blocks.count()
  const beforeNodeCount = await db.nodes.count()
  const badPkg = {
    packageNo: 'pkg-BAD',
    handedAt: '2026-09-30T13:00',
    blocks: [{ id: 'b-tmp', draftId: 'd1', blockName: '副版', colorNo: 6, woodType: '梨木', thicknessMm: 17, carvedBy: '秦', state: '在刻', defectNote: '应回滚', rev: 1 }],
    nodes: [{ id: 'p-bad', blockId: 'b-tmp', stage: '刻版', seq: 1, operator: '秦', startedAt: '2026-09-30T13:00', durationMin: 10, note: '写入中途失败' }],
  }
  const originalAdd = db.nodes.add.bind(db.nodes)
  db.nodes.add = (() => {
    throw new Error('模拟写入中途失败')
  }) as typeof db.nodes.add
  await assert.rejects(() => commitHandoff(badPkg))
  db.nodes.add = originalAdd
  assert.equal(await db.nodes.count(), beforeNodeCount, '节点数不变')
  assert.equal(await db.blocks.count(), beforeBlockCount, '版片数不变')
  assert.equal(await db.blocks.get('b-tmp'), undefined, '回滚后临时版片不得残留')
  assert.equal((await loadPendingConflicts()).length, 1, '冲突数不变')

  // 6) 重开后续裁：采用交接包修订 -> 本地被覆盖且结案
  await resolveConflict(conflicts[0]!.id, 'take-incoming')
  const resolvedLocal = await db.blocks.get('b-conflict')
  assert.equal(resolvedLocal?.state, '已刻成')
  assert.equal(resolvedLocal?.rev, 2)
  assert.equal((await loadPendingConflicts()).length, 0, '未决冲突已清零')

  db.close()
  console.log('✅ 交接包对账全部断言通过：迁移推定 / 新增合并冲突 / 节点去重 / 原子回滚 / 重开续裁')
}

main().catch((error) => {
  console.error('❌ 验证失败：', error)
  process.exit(1)
})
