import type { HandoffPackage } from '../types/handoff'

/**
 * 一份刻工带回的示例交接包，覆盖对账的各条路径：
 * - block-ms-03：修订号一致但内容有改动（在刻 -> 已刻成、补崩口），可合并预览
 * - block-ms-02：交接包修订号 2 与本地 1 不一致，挡住覆盖并留双方待裁决
 * - block-ms-04：修订号一致、内容也一致，合并且无字段差异
 * - block-zw-05：本地没有的新增副版（含本地未知的画稿编号，仅随包留档）
 * - 节点：上样(新)、修版(新)、刻版(本地已有/包内重复，各只入一条)
 */
export function buildSampleHandoffPackage(): HandoffPackage {
  const today = new Date().toISOString().slice(0, 10)
  return {
    packageNo: `交接-${today.replace(/-/g, '')}-01`,
    handedAt: new Date().toISOString(),
    blocks: [
      {
        id: 'block-ms-03',
        draftId: 'draft-menshen-qin',
        blockName: '红版',
        colorNo: 3,
        woodType: '梨木',
        thicknessMm: 20,
        carvedBy: '陈小满',
        state: '已刻成',
        defectNote: '袍角纹样处有一处浅崩口，已嵌补平整。',
        rev: 1,
      },
      {
        id: 'block-ms-02',
        draftId: 'draft-menshen-qin',
        blockName: '黄版',
        colorNo: 2,
        woodType: '梨木',
        thicknessMm: 20,
        carvedBy: '周桂枝',
        state: '已刻成',
        defectNote: '甲胄边线崩口修平后，另把靠旗纹加深一刀。',
        rev: 2,
      },
      {
        id: 'block-ms-04',
        draftId: 'draft-menshen-qin',
        blockName: '绿版',
        colorNo: 4,
        woodType: '梨木',
        thicknessMm: 19,
        carvedBy: '秦木生',
        state: '待刻',
        defectNote: '',
        rev: 1,
      },
      {
        id: 'block-zw-05',
        draftId: 'draft-zaowang-siming',
        blockName: '副版',
        colorNo: 5,
        woodType: '梨木',
        thicknessMm: 17,
        carvedBy: '秦木生',
        state: '在刻',
        defectNote: '供桌供花局部加刻的副版。',
        rev: 1,
      },
    ],
    nodes: [
      {
        id: 'pkg-node-ms-03-1',
        blockId: 'block-ms-03',
        stage: '刻版',
        seq: 1,
        operator: '陈小满',
        startedAt: `${today}T08:10`,
        durationMin: 420,
        note: '红袍大面平底刻完，验线后刻成。',
      },
      {
        id: 'pkg-node-ms-03-2',
        blockId: 'block-ms-03',
        stage: '修版',
        seq: 2,
        operator: '秦木生',
        startedAt: `${today}T14:30`,
        durationMin: 75,
        note: '袍角浅崩口嵌补，顺纹修平。',
      },
      {
        // 与本地 block-ms-01 已有的刻版节点同身份（同版片同环节），应判为重复、只入一条
        id: 'pkg-node-ms-01-dup',
        blockId: 'block-ms-01',
        stage: '刻版',
        seq: 4,
        operator: '齐师傅',
        startedAt: `${today}T09:00`,
        durationMin: 700,
        note: '管事手抄第二遍的刻版记录，应去重。',
      },
      {
        // 包内自重复：与上一条同版片同环节，也只入一条
        id: 'pkg-node-ms-03-2-copy',
        blockId: 'block-ms-03',
        stage: '修版',
        seq: 2,
        operator: '秦木生',
        startedAt: `${today}T14:30`,
        durationMin: 75,
        note: '同一修版节点的第二遍手抄。',
      },
    ],
  }
}
