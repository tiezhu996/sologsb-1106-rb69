import type { HandoverPackage } from '../types/handover'

/**
 * 示例交接包，刻意覆盖全部对账情形：
 * - block-ms-02 修订号一致但崩口与状态已改 → 合并预览
 * - block-zw-03 本地修订号 1、包里修订号 2 → 修订号冲突，挡住覆盖
 * - block-mk-04 本地为初版、包里记为修订二版且内容有变 → 修订号不一致冲突
 * - block-ms-05 本地没有 → 新收入
 * - node 新节点 / 重复节点 / 内容漂移冲突 / 包内重复，各一
 */
export function buildSampleHandoverPackage(): HandoverPackage {
  return {
    packageNo: `交接-${new Date().getFullYear()}-0930`,
    carver: '周桂枝',
    handedAt: new Date().toISOString().slice(0, 16),
    note: '外屋刻制完工带回：黄版修嵌，红版改版待管事对账，另补两块外屋新刻记录。',
    blocks: [
      {
        id: 'block-ms-02',
        draftId: 'draft-menshen-qin',
        blockName: '黄版',
        colorNo: 2,
        woodType: '梨木',
        thicknessMm: 20,
        carvedBy: '周桂枝',
        state: '已刻成',
        defectNote: '甲胄边线浅崩口嵌补后验线平整，另顺修云纹刀口两处。',
        rev: 1,
      },
      {
        id: 'block-zw-03',
        draftId: 'draft-zaowang-siming',
        blockName: '红版',
        colorNo: 3,
        woodType: '梨木',
        thicknessMm: 18,
        carvedBy: '陈小满',
        state: '在刻',
        defectNote: '供桌红块平底已刻完，外屋又补刻卷草纹（修订二版）。',
        rev: 2,
      },
      {
        id: 'block-mk-04',
        draftId: 'draft-muke-zhai',
        blockName: '绿版',
        colorNo: 4,
        woodType: '梨木',
        thicknessMm: 19,
        carvedBy: '秦木生',
        state: '在刻',
        defectNote: '旗穗绿块局部加深，木料边沿新见一小裂纹。',
        rev: 2,
      },
      {
        id: 'block-ms-05',
        draftId: 'draft-menshen-qin',
        blockName: '绿版',
        colorNo: 5,
        woodType: '梨木',
        thicknessMm: 19,
        carvedBy: '秦木生',
        state: '待刻',
        defectNote: '外屋试刻备用绿版，尚未上样。',
        rev: 1,
      },
    ],
    nodes: [
      {
        id: 'node-sample-ms02-crave',
        blockId: 'block-ms-02',
        stage: '刻版',
        seq: 1,
        operator: '周桂枝',
        startedAt: '2026-09-29T07:40',
        durationMin: 420,
        note: '甲胄边线嵌补后重新走刀，云纹顺修。',
      },
      {
        id: 'node-ms-04',
        blockId: 'block-ms-01',
        stage: '刻版',
        seq: 4,
        operator: '齐师傅',
        startedAt: '2026-01-05T07:50',
        durationMin: 760,
        note: '人物面部先刻，衣纹随后分层推进。',
      },
      {
        id: 'node-mk-03',
        blockId: 'block-mk-01',
        stage: '上样',
        seq: 3,
        operator: '周桂枝',
        startedAt: '2026-02-03T08:20',
        durationMin: 90,
        note: '包内记录与档案有出入：旗面折线以重朱定位。',
      },
      {
        id: 'node-sample-dup-a',
        blockId: 'block-ms-02',
        stage: '修版',
        seq: 2,
        operator: '周桂枝',
        startedAt: '2026-09-30T09:00',
        durationMin: 60,
        note: '同一工序被手抄两遍，此为第一条。',
      },
      {
        id: 'node-sample-dup-b',
        blockId: 'block-ms-02',
        stage: '修版',
        seq: 2,
        operator: '周桂枝',
        startedAt: '2026-09-30T09:00',
        durationMin: 60,
        note: '同一工序被手抄两遍，此条重复，只入一条。',
      },
    ],
  }
}
