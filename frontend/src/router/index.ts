import DraftList from '../pages/DraftList.svelte'
import BlockBoard from '../pages/BlockBoard.svelte'
import NodeTimeline from '../pages/NodeTimeline.svelte'
import BatchList from '../pages/BatchList.svelte'
import CarverList from '../pages/CarverList.svelte'
import HandoverDesk from '../pages/HandoverDesk.svelte'

export const routes = {
  '/drafts': DraftList,
  '/drafts/:id/blocks': BlockBoard,
  '/blocks/:id/nodes': NodeTimeline,
  '/batches': BatchList,
  '/carvers': CarverList,
  '/handover': HandoverDesk,
  '*': DraftList,
}

export default routes
