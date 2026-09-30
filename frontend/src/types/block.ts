export type BlockName = '墨线版' | '黄版' | '红版' | '绿版' | '副版'
export type WoodType = '梨木' | '黄杨'
export type BlockState = '待刻' | '在刻' | '已刻成' | '已修版'

export interface Block {
  id: string
  draftId: string
  blockName: BlockName
  colorNo: number
  woodType: WoodType
  thicknessMm: number
  carvedBy: string
  state: BlockState
  defectNote: string
  /** 版片修订号：每经历一次修版节点递增一档，初刻为 1。交接包据此对账。 */
  rev: number
}
