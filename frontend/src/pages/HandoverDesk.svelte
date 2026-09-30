<script lang="ts">
  import { onMount } from 'svelte'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import { blockStore } from '../stores/blockStore'
  import { db } from '../utils/db'
  import { reconcilePackage } from '../utils/reconcile'
  import {
    commitHandoverPackage,
    listOpenConflicts,
    listPackages,
    parseHandoverPackage,
    resolveConflict,
  } from '../utils/handoverImport'
  import { buildSampleHandoverPackage } from '../utils/sampleHandover'
  import type { Block } from '../types/block'
  import type { ProcessNode } from '../types/node'
  import type {
    BlockReport,
    ConflictRecord,
    HandoverPackage,
    NodeReport,
    PackageArchive,
  } from '../types/handover'

  let rawText = $state('')
  let parseErrors = $state<string[]>([])
  let parsed = $state<HandoverPackage | null>(null)
  let preview = $state<ReturnType<typeof reconcilePackage> | null>(null)
  let feedback = $state('')
  let feedbackKind = $state<'ok' | 'err'>('ok')
  let faultInjection = $state(false)
  let importing = $state(false)
  let packages = $state<PackageArchive[]>([])
  let conflicts = $state<ConflictRecord[]>([])
  let blockIndex = $state<Record<string, Block>>({})

  onMount(() => {
    void refreshAll()
  })

  async function refreshAll(): Promise<void> {
    await Promise.all([blockStore.load(), refreshArchives()])
  }

  async function refreshArchives(): Promise<void> {
    const [packageRecords, conflictRecords, blocks] = await Promise.all([
      listPackages(),
      listOpenConflicts(),
      db.blocks.toArray(),
    ])
    packages = packageRecords
    conflicts = conflictRecords
    blockIndex = Object.fromEntries(blocks.map((block) => [block.id, block]))
  }

  function loadSample(): void {
    rawText = JSON.stringify(buildSampleHandoverPackage(), null, 2)
    feedback = ''
    runPreview()
  }

  function readFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      rawText = String(reader.result ?? '')
      runPreview()
    }
    reader.readAsText(file, 'utf-8')
  }

  function runPreview(): void {
    feedback = ''
    parseErrors = []
    preview = null
    parsed = null
    if (!rawText.trim()) return

    const result = parseHandoverPackage(rawText)
    if (!result.ok || !result.package) {
      parseErrors = result.errors
      return
    }
    parsed = result.package
    preview = reconcilePackage({
      pkg: result.package,
      localBlocks: Object.values(blockIndex),
      localNodes: [],
    })
    // 节点对账依赖库内最新数据，异步补齐后刷新
    void refreshPreviewFromDb()
  }

  async function computePreview(): Promise<ReturnType<typeof reconcilePackage> | null> {
    if (!parsed) return null
    const [localBlocks, localNodes] = await Promise.all([db.blocks.toArray(), db.nodes.toArray()])
    return reconcilePackage({ pkg: parsed, localBlocks, localNodes })
  }

  // 预览依赖库内最新数据，页面载入或处置冲突后异步补齐
  async function refreshPreviewFromDb(): Promise<void> {
    if (parsed) preview = await computePreview()
  }

  const blockDecisionMeta: Record<BlockReport['decision'], { label: string; tone: string }> = {
    new: { label: '新收入档', tone: 'ok' },
    identical: { label: '完全一致', tone: 'muted' },
    'merge-preview': { label: '可合并 · 待预览', tone: 'warn' },
    'conflict-rev': { label: '修订号冲突 · 挡住覆盖', tone: 'bad' },
    'migrated-rev': { label: '本地缺修订号 · 已推定迁移', tone: 'info' },
  }

  const nodeDecisionMeta: Record<NodeReport['decision'], { label: string; tone: string }> = {
    new: { label: '新节点', tone: 'ok' },
    duplicate: { label: '重复 · 只入一条', tone: 'muted' },
    'conflict-node': { label: '同节点内容漂移 · 保留双方', tone: 'bad' },
  }

  const previewCounts = $derived(
    preview
      ? {
          newBlocks: preview.blockReports.filter((item) => item.decision === 'new').length,
          merges: preview.blockReports.filter((item) => item.decision === 'merge-preview').length,
          blockConflicts: preview.blockReports.filter((item) => item.decision === 'conflict-rev').length,
          migrations: preview.blockReports.filter((item) => item.localRevInferred).length,
          newNodes: preview.nodeReports.filter((item) => item.decision === 'new').length,
          duplicateNodes: preview.nodeReports.filter((item) => item.decision === 'duplicate').length,
          nodeConflicts: preview.nodeReports.filter((item) => item.decision === 'conflict-node').length,
        }
      : null,
  )

  async function runImport(): Promise<void> {
    if (!parsed) return
    importing = true
    try {
      const summary = await commitHandoverPackage(parsed, { faultAtWrite: faultInjection ? 2 : undefined })
      feedbackKind = 'ok'
      feedback =
        `已导入「${parsed.packageNo}」：新版片 ${summary.addedBlocks} 块、合并 ${summary.mergedBlocks} 块、` +
        `迁移修订号 ${summary.migratedBlocks} 块；新节点 ${summary.addedNodes} 条、重复跳过 ${summary.duplicateNodes} 条、` +
        `挂起冲突 ${summary.conflicts} 条。`
      rawText = ''
      parsed = null
      preview = null
    } catch (error) {
      feedbackKind = 'err'
      feedback = `${error instanceof Error ? error.message : '导入失败'}；整包已回滚，原包与已有档案均未改动，可排除故障后重新提交。`
    } finally {
      importing = false
      faultInjection = false
      await refreshAll()
    }
  }

  async function retryPackage(record: PackageArchive): Promise<void> {
    importing = true
    try {
      await commitHandoverPackage(record.raw)
      feedbackKind = 'ok'
      feedback = `「${record.packageNo}」重新提交完成。`
    } catch (error) {
      feedbackKind = 'err'
      feedback = error instanceof Error ? error.message : '重新提交失败'
    } finally {
      importing = false
      await refreshAll()
    }
  }

  async function settle(conflict: ConflictRecord, resolution: 'keep-local' | 'take-package' | 'keep-both'): Promise<void> {
    await resolveConflict(conflict.id, resolution)
    feedbackKind = 'ok'
    feedback =
      resolution === 'take-package'
        ? '已采用交接包一侧并落档。'
        : resolution === 'keep-both'
          ? '已保留双方版本。'
          : '已保留本地档案，交接包一侧仅留账。'
    await refreshAll()
    await refreshPreviewFromDb()
  }

  function blockNameOf(id: string): string {
    return blockIndex[id]?.blockName ?? id
  }

  function displayRecord(record: unknown): string {
    if (record === null || record === undefined) return '（无）'
    return JSON.stringify(record, null, 2)
  }

  function formatTime(value: string): string {
    return value.replace('T', ' ').slice(0, 16)
  }

  const statusMeta: Record<PackageArchive['status'], { label: string; tone: string }> = {
    pending: { label: '待处理', tone: 'warn' },
    imported: { label: '已导入', tone: 'ok' },
    'rolled-back': { label: '已回滚 · 可重提', tone: 'bad' },
  }
</script>

<svelte:head>
  <title>交接包对账 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">外屋完工 · 回坊交接</p>
    <h1>交接包对账台</h1>
    <p>刻工带回的交接包含版片修订号与工序节点；导入前与本地档案逐项对账，能合并的先预览，修订号不一致的保留双方并挡住覆盖，重复节点只入一条。</p>
  </div>
  <button class="button ghost" data-testid="load-sample" type="button" onclick={loadSample}>载入示例交接包</button>
</div>

<section class="summary-strip four">
  <div><span>归档交接包</span><strong data-testid="count-packages">{packages.length}</strong></div>
  <div><span>已导入</span><strong>{packages.filter((item) => item.status === 'imported').length}</strong></div>
  <div><span>回滚待重提</span><strong>{packages.filter((item) => item.status === 'rolled-back').length}</strong></div>
  <div><span>未决冲突</span><strong data-testid="count-conflicts">{conflicts.length}</strong></div>
</section>

{#if feedback}
  <p class="notice {feedbackKind === 'err' ? 'notice-bad' : ''}" data-testid="import-feedback">{feedback}</p>
{/if}

<section class="panel form-panel" data-testid="receipt-panel">
  <div class="panel-heading">
    <div>
      <span class="section-kicker">第一步 · 收包</span>
      <h2>粘贴或选择交接包 JSON</h2>
    </div>
  </div>
  <div class="receipt-actions">
    <label class="file-button">
      <input type="file" accept="application/json,.json" onchange={readFile} hidden />
      <span class="button ghost">选择交接包文件</span>
    </label>
    <button class="button ghost" type="button" onclick={() => { rawText = ''; parsed = null; preview = null; parseErrors = [] }}>清空</button>
    <button class="button secondary" data-testid="preview-btn" type="button" onclick={runPreview} disabled={!rawText.trim()}>重新对账预览</button>
  </div>
  <textarea
    class="receipt-input"
    data-testid="receipt-text"
    rows="10"
    bind:value={rawText}
    placeholder="在此粘贴交接包 JSON：含 packageNo、carver、handedAt、blocks、nodes 五项"
    oninput={() => { parseErrors = [] }}
  ></textarea>

  {#if parseErrors.length > 0}
    <div class="error-box" data-testid="parse-errors">
      <strong>交接包校验未通过：</strong>
      <ul>
        {#each parseErrors as error}<li>{error}</li>{/each}
      </ul>
    </div>
  {/if}
</section>

{#if preview && previewCounts}
  <section class="panel" data-testid="preview-panel">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">第二步 · 逐项对账预览</span>
        <h2>{preview.package.packageNo} · {preview.package.carver} 交回</h2>
      </div>
      <span>{formatTime(preview.package.handedAt)}</span>
    </div>

    <div class="summary-strip four compact-strip">
      <div><span>新版片 / 合并</span><strong>{previewCounts.newBlocks} / {previewCounts.merges}</strong></div>
      <div><span>修订号冲突</span><strong class="text-bad">{previewCounts.blockConflicts}</strong></div>
      <div><span>新节点 / 重复</span><strong>{previewCounts.newNodes} / {previewCounts.duplicateNodes}</strong></div>
      <div><span>节点漂移</span><strong class="text-bad">{previewCounts.nodeConflicts}</strong></div>
    </div>

    {#if preview.package.note}<p class="gentle-copy package-note">包内说明：{preview.package.note}</p>{/if}

    <h3 class="report-title">版片对账（含修订号）</h3>
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr><th>版片</th><th>本地修订号</th><th>包内修订号</th><th>结论</th><th>预览变化</th></tr>
        </thead>
        <tbody>
          {#each preview.blockReports as item (item.incoming.id)}
            <tr>
              <td>
                <strong>{item.incoming.id}</strong>
                <small>{item.incoming.blockName} · {item.incoming.carvedBy} · {item.incoming.state}</small>
              </td>
              <td>
                <strong class={item.localRevInferred ? 'rev-inferred' : ''}>
                  {item.local ? `第 ${item.local.rev ?? '—'} 版` : '无档案'}
                </strong>
                {#if item.localRevInferred}<small>缺号已按节点推定</small>{/if}
              </td>
              <td>
                <strong class={item.incomingRevInferred ? 'rev-inferred' : ''}>第 {item.incoming.rev} 版</strong>
                {#if item.incomingRevInferred}<small>包内缺号已推定</small>{/if}
              </td>
              <td><span class="decision tone-{blockDecisionMeta[item.decision].tone}">{blockDecisionMeta[item.decision].label}</span></td>
              <td>
                {#if item.changedFields.length === 0}
                  <small class="gentle-copy">无字段差异</small>
                {:else}
                  <dl class="field-diff">
                    {#each item.changedFields as change}
                      <div>
                        <dt>{change.label}</dt>
                        <dd><del>{String(change.local) || '空'}</del><ins>{String(change.incoming) || '空'}</ins></dd>
                      </div>
                    {/each}
                  </dl>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <h3 class="report-title">工序节点对账</h3>
    <div class="node-report-grid">
      {#each preview.nodeReports as item (item.incoming.id)}
        <article class="node-report-card tone-card-{nodeDecisionMeta[item.decision].tone}">
          <header>
            <strong>{item.incoming.stage} · 第 {item.incoming.seq} 节点</strong>
            <span class="decision tone-{nodeDecisionMeta[item.decision].tone}">{nodeDecisionMeta[item.decision].label}</span>
          </header>
          <p>{item.incoming.note}</p>
          <small>{item.incoming.operator} · {formatTime(item.incoming.startedAt)} · {item.incoming.durationMin} 分钟</small>
          {#if item.decision === 'conflict-node' && item.local}
            <div class="drift-pair">
              <div><span>本地档案</span><p>{item.local.note}</p></div>
              <div><span>交接包</span><p>{item.incoming.note}</p></div>
            </div>
          {/if}
        </article>
      {/each}
    </div>

    <div class="import-bar">
      <label class="fault-toggle">
        <input type="checkbox" data-testid="fault-toggle" bind:checked={faultInjection} />
        <span>演练：第二次写入时制造故障，验证整包回滚</span>
      </label>
      <button class="button primary" data-testid="commit-import" type="button" disabled={importing} onclick={runImport}>
        {importing ? '正在写入…' : '确认导入（整包事务提交）'}
      </button>
    </div>
  </section>
{/if}

{#if conflicts.length > 0}
  <section class="panel" data-testid="conflict-panel">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">第三步 · 未决冲突</span>
        <h2>挡住覆盖的双方记录（{conflicts.length}）</h2>
      </div>
      <span class="sync-note">重开页面后仍在此继续处理</span>
    </div>

    <div class="conflict-list">
      {#each conflicts as conflict (conflict.id)}
        <article class="conflict-card" data-testid="conflict-row">
          <header>
            <div>
              <strong>{conflict.kind === 'block-rev' ? `版片修订号冲突 · ${blockNameOf(conflict.blockId)}` : `工序节点漂移 · ${blockNameOf(conflict.blockId)}`}</strong>
              <small>来自 {conflict.packageNo} · 挂账于 {formatTime(conflict.createdAt)}</small>
            </div>
            {#if conflict.kind === 'block-rev'}
              <span class="rev-pair">本地 第 {conflict.localRev ?? '—'} 版 ↔ 包内 第 {conflict.packageRev ?? '—'} 版</span>
            {/if}
          </header>
          <div class="record-pair">
            <div><span>本地档案（保留中）</span><pre>{displayRecord(conflict.localRecord)}</pre></div>
            <div><span>交接包记录（不覆盖）</span><pre>{displayRecord(conflict.packageRecord)}</pre></div>
          </div>
          <footer>
            <button class="button ghost" type="button" onclick={() => settle(conflict, 'keep-local')}>保留本地</button>
            <button class="button secondary" type="button" onclick={() => settle(conflict, 'take-package')}>采用交接包</button>
            <button class="button danger" type="button" onclick={() => settle(conflict, 'keep-both')}>
              {conflict.kind === 'node-drift' ? '双方并存' : '双方留账'}
            </button>
          </footer>
        </article>
      {/each}
    </div>
  </section>
{/if}

<section class="panel" data-testid="archive-panel">
  <div class="panel-heading">
    <div>
      <span class="section-kicker">原包归档</span>
      <h2>交接包往来账</h2>
    </div>
    <span class="sync-note">写入中途失败时整包回滚，原包不丢</span>
  </div>

  {#if packages.length === 0}
    <EmptyBox title="尚无交接包" message="刻工外屋完工带回交接包后，在此粘贴 JSON 或选择文件导入。" actionLabel="载入示例交接包" onaction={loadSample} />
  {:else}
    <div class="archive-list">
      {#each packages as record (record.id)}
        <article class="archive-item" data-testid="archive-row">
          <div>
            <strong>{record.packageNo}</strong>
            <small>{record.carver} · {formatTime(record.handedAt)} · 版片 {record.raw.blocks.length} 块 / 节点 {record.raw.nodes.length} 条</small>
          </div>
          <div class="archive-side">
            <span class="decision tone-{statusMeta[record.status].tone}">{statusMeta[record.status].label}</span>
            {#if record.status === 'rolled-back'}
              <button class="mini-button strong" data-testid="retry-package" type="button" disabled={importing} onclick={() => retryPackage(record)}>重新提交</button>
            {/if}
            {#if record.importedAt}<small>导入于 {formatTime(record.importedAt)}</small>{/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
