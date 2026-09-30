<script lang="ts">
  import { onMount } from 'svelte'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import { downloadJson } from '../utils/export'
  import { parseHandoffPackage } from '../utils/handoffPackage'
  import { buildSampleHandoffPackage } from '../utils/sampleHandoff'
  import { commitHandoff, loadPendingConflicts, loadResolvedConflicts, previewHandoff, resolveConflict } from '../utils/handoff'
  import { blockStore } from '../stores/blockStore'
  import type { HandoffPackage, BlockReconcileEntry, BlockRevisionConflict, ReconcileReport } from '../types/handoff'
  import type { Block } from '../types/block'

  let report = $state<ReconcileReport | null>(null)
  let loadedPackage = $state<HandoffPackage | null>(null)
  let fileName = $state('')
  let parseError = $state('')
  let feedback = $state('')
  let committing = $state(false)
  let pendingConflicts = $state<BlockRevisionConflict[]>([])
  let resolvedConflicts = $state<BlockRevisionConflict[]>([])

  const hasConflicts = $derived((report?.blockStats.conflict ?? 0) > 0)
  const willWriteBlocks = $derived((report?.blockStats.add ?? 0) + (report?.blockStats.merge ?? 0))

  onMount(() => {
    void refreshConflicts()
  })

  async function refreshConflicts(): Promise<void> {
    const [pending, resolved] = await Promise.all([loadPendingConflicts(), loadResolvedConflicts()])
    pendingConflicts = pending
    resolvedConflicts = resolved
  }

  async function handleFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    parseError = ''
    feedback = ''
    report = null
    loadedPackage = null
    if (!file) return

    fileName = file.name
    try {
      const text = await file.text()
      const parsed = parseHandoffPackage(JSON.parse(text))
      if (!parsed.ok) {
        parseError = parsed.error
        return
      }
      loadedPackage = parsed.pkg
      report = await previewHandoff(parsed.pkg)
    } catch {
      parseError = '文件不是合法 JSON，请确认是刻工带回的交接包。'
    } finally {
      input.value = ''
    }
  }

  async function loadSample(): Promise<void> {
    parseError = ''
    feedback = ''
    const pkg = buildSampleHandoffPackage()
    fileName = `${pkg.packageNo}.json`
    loadedPackage = pkg
    report = await previewHandoff(pkg)
  }

  function downloadSample(): void {
    downloadJson('示例交接包.json', buildSampleHandoffPackage())
  }

  async function commit(): Promise<void> {
    if (!loadedPackage || !report || committing) return
    committing = true
    feedback = ''
    try {
      const result = await commitHandoff(loadedPackage)
      feedback = `整包已入账：版片 ${willWriteBlocks} 块写入，节点新增 ${result.nodesAdded} 条；${result.conflictsCreated} 块修订号不一致，已保留双方待裁决。`
      await Promise.all([blockStore.load(), refreshConflicts()])
      loadedPackage = null
      report = null
      fileName = ''
    } catch (error) {
      feedback = `写入中途失败，整包已回滚，原包与本地档案均未改动。${error instanceof Error ? `（${error.message}）` : ''}`
    } finally {
      committing = false
    }
  }

  async function decide(conflict: BlockRevisionConflict, resolution: 'take-incoming' | 'keep-local'): Promise<void> {
    feedback = ''
    try {
      await resolveConflict(conflict.id, resolution)
      feedback = `「${conflict.blockId}」冲突已${resolution === 'take-incoming' ? '按交接包修订覆盖' : '维持本地档案'}结案。`
      await Promise.all([blockStore.load(), refreshConflicts()])
    } catch (error) {
      feedback = `裁决未能入账，已回滚。${error instanceof Error ? `（${error.message}）` : ''}`
    }
  }

  function blockOf(entry: BlockReconcileEntry): Block {
    return entry.incoming
  }

  function kindLabel(kind: BlockReconcileEntry['kind']): string {
    return kind === 'add' ? '新增版片' : kind === 'merge' ? '可合并' : '修订号冲突'
  }

  const fieldLabels: Record<string, string> = {
    draftId: '画稿编号',
    blockName: '版片',
    colorNo: '色序',
    woodType: '木料',
    thicknessMm: '版厚',
    carvedBy: '刻工',
    state: '状态',
    defectNote: '崩口与修补',
  }

  function fieldLabel(name: string): string {
    return fieldLabels[name] ?? name
  }
</script>

<svelte:head>
  <title>交接包对账 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">刻工外屋完工带回</p>
    <h1>交接包对账</h1>
    <p>导入前与本地档案逐项对账：能合并的预览确认，修订号不一致保留双方并挡住覆盖，重复节点只入一条。</p>
  </div>
  <div class="heading-actions">
    <button class="button ghost" type="button" onclick={downloadSample}>下载示例包</button>
    <button class="button secondary" type="button" data-testid="load-sample" onclick={loadSample}>载入示例包</button>
  </div>
</div>

<section class="summary-strip four">
  <div><span>待裁决冲突</span><strong data-testid="count-pending-conflict">{pendingConflicts.length}</strong></div>
  <div><span>已裁决</span><strong>{resolvedConflicts.length}</strong></div>
  <div><span>本包将写入版片</span><strong>{willWriteBlocks}</strong></div>
  <div><span>本包新增节点</span><strong>{report?.nodeStats.add ?? 0}</strong></div>
</section>

<section class="panel form-panel">
  <div class="panel-heading">
    <div>
      <span class="section-kicker">第一步 · 选包</span>
      <h2>选择刻工带回的交接包</h2>
    </div>
  </div>
  <div class="import-drop">
    <input data-testid="file-handoff" type="file" accept="application/json,.json" onchange={handleFile} />
    {#if fileName}<p class="sync-note">已选：{fileName}</p>{/if}
    {#if parseError}<p class="form-message" data-testid="parse-error">{parseError}</p>{/if}
  </div>
</section>

{#if report && loadedPackage}
  <section class="panel" data-testid="preview-panel">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">第二步 · 逐项对账预览</span>
        <h2>{report.packageNo} 对账结果</h2>
      </div>
      <span class="sync-note">交接时间 {report.handedAt.slice(0, 16).replace('T', ' ')}</span>
    </div>

    <div class="reconcile-summary">
      <span class="pill add">新增 {report.blockStats.add}</span>
      <span class="pill merge">可合并 {report.blockStats.merge}</span>
      <span class="pill conflict">冲突 {report.blockStats.conflict}</span>
      <span class="pill node">新增节点 {report.nodeStats.add}</span>
      <span class="pill skip">重复节点 {report.nodeStats.skipDuplicate}</span>
    </div>

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr><th>判定</th><th>版片</th><th>修订号（本地 → 包内）</th><th>差异字段</th></tr>
      </thead>
        <tbody>
          {#each report.blockEntries as entry (entry.incoming.id)}
            {@const block = blockOf(entry)}
            <tr data-testid={`row-block-entry-${entry.kind}`}>
              <td><span class="pill {entry.kind}">{kindLabel(entry.kind)}</span></td>
              <td><strong>{block.blockName}</strong><small>{block.id} · {block.carvedBy || '未指派'}</small></td>
              <td>
                {#if entry.kind === 'add'}
                  <small>本地无此版片</small> · <b>包内 r{entry.incomingRev}</b>
                {:else}
                  <b class:rev-conflict={entry.kind === 'conflict'}>r{entry.localRev} → r{entry.incomingRev}</b>
                {/if}
              </td>
              <td>
                {#if entry.changedFields.length === 0}
                  <small>内容一致</small>
                {:else}
                  {entry.changedFields.map(fieldLabel).join('、')}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="node-preview">
      <h3>工序节点对账（{report.nodeEntries.length} 条）</h3>
      <ul class="node-entry-list">
        {#each report.nodeEntries as entry (entry.incoming.id)}
          <li data-testid={`row-node-entry-${entry.kind}`}>
            <span class="pill {entry.kind === 'add' ? 'add' : 'skip'}">
              {entry.kind === 'add' ? `新增 · 第 ${entry.resolvedSeq} 节点` : '重复跳过'}
            </span>
            <span>{entry.incoming.blockId ?? '未归属版片'} · {entry.incoming.stage}</span>
            <small>{entry.incoming.operator}{entry.duplicateOfId ? ` · 与 ${entry.duplicateOfId} 重复` : ''}</small>
          </li>
        {/each}
      </ul>
    </div>

    <div class="form-actions">
      <button class="button primary" data-testid="commit-handoff" type="button" disabled={committing} onclick={commit}>
        {committing ? '正在整包入账…' : '确认无误，整包入账'}
      </button>
      {#if hasConflicts}<span class="sync-note">冲突版片不会覆盖本地，入账后到下方"未决冲突"继续裁决。</span>{/if}
    </div>
  </section>
{/if}

<section class="panel" data-testid="pending-panel">
  <div class="panel-heading">
    <div>
      <span class="section-kicker">第三步 · 未决冲突</span>
      <h2>修订号不一致，保留双方</h2>
    </div>
    <strong>{pendingConflicts.length} 件</strong>
  </div>

  {#if pendingConflicts.length === 0}
    <EmptyBox title="没有待裁决的冲突" message="交接包中修订号一致的版片已直接合并；出现不一致时会在这里保留双方。" />
  {:else}
    <div class="conflict-list">
      {#each pendingConflicts as conflict (conflict.id)}
        <article class="conflict-card" data-testid="row-conflict">
          <header>
            <strong>{conflict.blockId}</strong>
            <span class="pill conflict">本地 r{conflict.localRev} · 包内 r{conflict.incomingRev}</span>
            <small>来自 {conflict.packageNo} · {conflict.detectedAt.slice(0, 16).replace('T', ' ')}</small>
          </header>
          <div class="conflict-sides">
            <div class="conflict-side local">
              <span>本地档案（维持）</span>
              <p><b>{conflict.localBlock.blockName}</b> · {conflict.localBlock.state} · {conflict.localBlock.carvedBy || '未指派'}</p>
              <p>{conflict.localBlock.defectNote || '无崩口记录'}</p>
            </div>
            <div class="conflict-side incoming">
              <span>交接包修订（可覆盖）</span>
              <p><b>{conflict.incomingBlock.blockName}</b> · {conflict.incomingBlock.state} · {conflict.incomingBlock.carvedBy || '未指派'}</p>
              <p>{conflict.incomingBlock.defectNote || '无崩口记录'}</p>
            </div>
          </div>
          <div class="inline-actions">
            <button class="button primary" data-testid={`take-incoming-${conflict.blockId}`} type="button" onclick={() => decide(conflict, 'take-incoming')}>采用交接包修订</button>
            <button class="button secondary" data-testid={`keep-local-${conflict.blockId}`} type="button" onclick={() => decide(conflict, 'keep-local')}>维持本地档案</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

{#if resolvedConflicts.length > 0}
  <section class="panel">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">裁决留痕</span>
        <h2>已处理的修订冲突</h2>
      </div>
    </div>
    <ul class="node-entry-list">
      {#each resolvedConflicts as conflict (conflict.id)}
        <li>
          <span class="pill {conflict.status === 'take-incoming' ? 'merge' : 'skip'}">
            {conflict.status === 'take-incoming' ? '已采用包内' : '已维持本地'}
          </span>
          <span>{conflict.blockId} · r{conflict.localRev} / r{conflict.incomingRev}</span>
          <small>{conflict.resolvedAt?.slice(0, 16).replace('T', ' ')}</small>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if feedback}<p class="notice" data-testid="handoff-feedback">{feedback}</p>{/if}
