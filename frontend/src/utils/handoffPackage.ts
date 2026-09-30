import type { Block, BlockName, BlockState, WoodType } from '../types/block'
import type { ProcessNode, ProcessStage } from '../types/node'
import type { HandoffPackage } from '../types/handoff'

const BLOCK_NAMES: readonly BlockName[] = ['墨线版', '黄版', '红版', '绿版', '副版']
const WOOD_TYPES: readonly WoodType[] = ['梨木', '黄杨']
const BLOCK_STATES: readonly BlockState[] = ['待刻', '在刻', '已刻成', '已修版']
const STAGES: readonly ProcessStage[] = ['起稿', '勾描', '上样', '刻版', '修版', '调色', '套印', '晾晒']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/** 已有数据缺少修订号时按 null 返回，由调用方按节点推定迁移 */
function parseBlock(value: unknown): Block | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  const draftId = asString(value.draftId)
  const blockName = oneOf(value.blockName, BLOCK_NAMES)
  const colorNo = asNumber(value.colorNo)
  const woodType = oneOf(value.woodType, WOOD_TYPES)
  const thicknessMm = asNumber(value.thicknessMm)
  const carvedBy = asString(value.carvedBy)
  const state = oneOf(value.state, BLOCK_STATES)
  const rev = asNumber(value.rev)
  if (!id || !draftId || !blockName || colorNo === null || !woodType || thicknessMm === null || !state || rev === null) {
    return null
  }
  return {
    id,
    draftId,
    blockName,
    colorNo,
    woodType,
    thicknessMm,
    carvedBy: carvedBy ?? '',
    state,
    defectNote: typeof value.defectNote === 'string' ? value.defectNote : '',
    rev,
  }
}

function parseNode(value: unknown): ProcessNode | null {
  if (!isRecord(value)) return null
  const stage = oneOf(value.stage, STAGES)
  const seq = asNumber(value.seq)
  const operator = asString(value.operator)
  const startedAt = asString(value.startedAt)
  const durationMin = asNumber(value.durationMin)
  const id = asString(value.id)
  if (!stage || seq === null || !operator || !startedAt || durationMin === null || !id) return null
  const node: ProcessNode = {
    id,
    stage,
    seq,
    operator,
    startedAt,
    durationMin,
    note: typeof value.note === 'string' ? value.note : '',
  }
  if (asString(value.blockId)) node.blockId = asString(value.blockId) as string
  if (asString(value.batchId)) node.batchId = asString(value.batchId) as string
  return node
}

/** 解析并校验交接包，失败时返回中文错误信息 */
export function parseHandoffPackage(raw: unknown): { ok: true; pkg: HandoffPackage } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: '交接包不是有效的 JSON 对象。' }

  const packageNo = asString(raw.packageNo) ?? '未编号交接包'
  const handedAt = asString(raw.handedAt) ?? new Date().toISOString()

  if (!Array.isArray(raw.blocks)) return { ok: false, error: '交接包缺少版片清单（blocks）。' }
  if (!Array.isArray(raw.nodes)) return { ok: false, error: '交接包缺少工序节点（nodes）。' }

  const blocks: Block[] = []
  for (const item of raw.blocks) {
    const block = parseBlock(item)
    if (!block) return { ok: false, error: '存在无法识别的版片记录：版片编号、修订号等必填项缺失或越界。' }
    blocks.push(block)
  }

  const nodes: ProcessNode[] = []
  for (const item of raw.nodes) {
    const node = parseNode(item)
    if (!node) return { ok: false, error: '存在无法识别的工序节点：节点编号、环节、序号等必填项缺失。' }
    nodes.push(node)
  }

  if (blocks.length === 0) return { ok: false, error: '交接包内没有任何版片，无法对账。' }

  return { ok: true, pkg: { packageNo, handedAt, blocks, nodes } }
}
