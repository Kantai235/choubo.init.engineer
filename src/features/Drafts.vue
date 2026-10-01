<script setup lang="ts">
import { inject } from 'vue'
import { useBookStore } from '../stores/book'
import { kindNames, newId, type Draft, type Transaction } from '../domain/model'
import AppIcon from '../components/AppIcon.vue'
import { downloadJson } from '../infrastructure/local'
const store = useBookStore()
const openTransaction = inject<(tx?: Transaction) => void>('openTransaction')!
function discard(draft: Draft) {
  if (confirm('捨棄這份草稿？這不會變更正式帳務。')) {
    try {
      store.saveDraft(
        draft.value,
        true,
        store.drafts.filter((d) => d.id === draft.id).map((d) => d.revisionId),
      )
    } catch (error) {
      store.error = error instanceof Error ? error.message : '無法捨棄草稿'
    }
  }
}
function choose(draft: Draft) {
  try {
    store.saveDraft(
      draft.value,
      false,
      store.drafts.filter((d) => d.id === draft.id).map((d) => d.revisionId),
    )
    openTransaction(draft.value)
  } catch (error) {
    store.error = error instanceof Error ? error.message : '無法保存選擇'
  }
}
function copy(draft: Draft) {
  openTransaction({
    ...draft.value,
    id: newId(),
    lines: draft.value.lines.map((l) => ({ ...l, id: newId() })),
  })
}
</script>
<template>
  <section class="page-heading">
    <div>
      <p class="small-label">先保留，再確認</p>
      <h1>草稿與待處理</h1>
      <p>草稿不影響正式餘額，確認內容後再入帳。</p>
    </div>
  </section>
  <section v-if="store.pending.length" class="surface pending-section">
    <h2>等待確認的提交</h2>
    <p class="muted">雲端回應尚未確認，重試會沿用同一操作，不另記一筆。</p>
    <div v-for="op in store.pending" :key="op.id" class="pending-row">
      <span
        >{{
          op.command.type === 'transaction.post'
            ? op.command.transaction.title || op.command.transaction.lines[0]?.name || '收支紀錄'
            : op.command.type === 'account.put'
              ? op.command.account.name
              : '帳務設定'
        }}<small>{{ new Date(op.createdAt).toLocaleString('zh-TW') }}</small></span
      ><button
        class="button secondary"
        :disabled="store.working || !store.ready || !store.online"
        @click="store.retry(op.id).catch(() => undefined)"
      >
        查回／重試
      </button>
    </div>
  </section>
  <section v-if="store.ledger.conflicts.length" class="surface pending-section">
    <h2>需要核對的版本</h2>
    <p class="muted">保留所有候選內容，受影響的紀錄未計入正式餘額。請先匯出資料供核對。</p>
    <div v-for="c in store.ledger.conflicts" :key="c.id" class="conflict-row">
      <strong>{{ c.message }}</strong
      ><small>{{ c.operationIds.join('、') }}</small>
    </div>
  </section>
  <div v-if="!store.visibleDrafts.length" class="surface empty-state">
    <span class="empty-icon"><AppIcon name="draft" :size="30" /></span>
    <h3>目前沒有未完成的草稿</h3>
    <p>記帳時可先保留內容，稍後再回來繼續。</p>
  </div>
  <section v-else class="draft-grid">
    <article
      v-for="draft in store.visibleDrafts"
      :key="draft.revisionId"
      class="surface draft-card"
    >
      <div class="draft-card-top">
        <span class="category-icon"><AppIcon name="draft" /></span
        ><span class="badge" :class="{ neutral: !store.isDraftSynced(draft) }">{{
          store.isDraftSynced(draft) ? '草稿已同步' : '僅本機暫存'
        }}</span>
      </div>
      <h3>
        {{
          draft.value.title || draft.value.merchant || draft.value.lines[0]?.name || '未命名紀錄'
        }}
      </h3>
      <p>
        {{ kindNames[draft.value.kind] }} · {{ draft.value.lines.length }} 筆明細 ·
        {{ draft.value.date }}
      </p>
      <p v-if="store.drafts.filter((d) => d.id === draft.id).length > 1" class="inline-error">
        這份草稿有多個版本，請選擇要保留的內容。
      </p>
      <div class="draft-card-actions">
        <button
          v-if="store.drafts.filter((d) => d.id === draft.id).length > 1"
          class="button secondary"
          @click="choose(draft)"
        >
          採用這份版本</button
        ><button v-else class="button secondary" @click="openTransaction(draft.value)">
          繼續編輯</button
        ><button class="text-button" @click="copy(draft)">複製</button
        ><button class="text-button danger" @click="discard(draft)">捨棄</button
        ><button
          class="icon-button"
          aria-label="下載草稿"
          @click="downloadJson(`choubo-draft-${draft.id}.json`, draft)"
        >
          <AppIcon name="download" :size="17" />
        </button>
      </div>
    </article>
  </section>
</template>
