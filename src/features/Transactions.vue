<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useBookStore } from '../stores/book'
import { type Transaction } from '../domain/model'
import AppIcon from '../components/AppIcon.vue'
import TransactionList from '../components/TransactionList.vue'
import { categoryLabel } from '../domain/seeds'
const store = useBookStore()
const openTransaction = inject<() => void>('openTransaction')!
const showTransaction = inject<(tx: Transaction) => void>('showTransaction')!
const search = ref('')
const accountId = ref('')
const kind = ref('')
const month = ref('')
const includeReversed = ref(false)
const transactions = computed(() =>
  store.ledger.transactions
    .filter(
      (t) =>
        (includeReversed.value || !store.ledger.reversed.includes(t.id)) &&
        (!accountId.value ||
          t.accountId === accountId.value ||
          t.targetAccountId === accountId.value) &&
        (!kind.value || t.kind === kind.value) &&
        (!month.value || t.date.startsWith(month.value)) &&
        `${t.title} ${t.merchant} ${t.note} ${t.lines.map((l) => `${l.name} ${categoryLabel(l.categoryId)}`).join(' ')}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)),
)
</script>
<template>
  <section class="page-heading">
    <div>
      <p class="small-label">每一筆都有跡可循</p>
      <h1>收支紀錄</h1>
      <p>按帳戶、類型或月份，找回生活的細節。</p>
    </div>
    <button
      class="button primary"
      :disabled="!store.ready || !store.ledger.accounts.some((a) => !a.archived)"
      @click="openTransaction()"
    >
      <AppIcon name="plus" />記一筆
    </button>
  </section>
  <section class="surface">
    <div class="filters">
      <label class="search-field"
        ><AppIcon name="search" :size="18" /><input
          v-model="search"
          aria-label="搜尋紀錄"
          placeholder="搜尋分類、名稱、商家或備註" /></label
      ><select v-model="accountId" aria-label="篩選帳戶">
        <option value="">全部帳戶</option>
        <option v-for="a in store.ledger.accounts" :key="a.id" :value="a.id">
          {{ a.name }}
        </option></select
      ><select v-model="kind" aria-label="篩選類型">
        <option value="">全部類型</option>
        <option value="expense">支出</option>
        <option value="income">收入</option>
        <option value="transfer">轉帳</option></select
      ><input v-model="month" type="month" aria-label="篩選月份" />
    </div>
    <div class="list-caption">
      <span>{{ transactions.length }} 筆紀錄</span
      ><label class="checkbox"><input v-model="includeReversed" type="checkbox" />包含已撤銷</label>
    </div>
    <TransactionList
      v-if="transactions.length"
      :transactions="transactions"
      @select="showTransaction"
    />
    <div v-else class="empty-state">
      <span class="empty-icon"><AppIcon name="search" :size="28" /></span>
      <h3>
        {{ store.ledger.transactions.length ? '沒有符合條件的紀錄' : '還沒有正式入帳的紀錄' }}
      </h3>
      <p>
        {{
          store.ledger.transactions.length
            ? '調整篩選條件，或換個關鍵字試試。'
            : '草稿確認並保存至 Drive 後，就會出現在這裡。'
        }}
      </p>
    </div>
  </section>
</template>
