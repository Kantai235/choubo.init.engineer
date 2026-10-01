<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { DateTime } from 'luxon'
import AppIcon from '../components/AppIcon.vue'
import TransactionList from '../components/TransactionList.vue'
import { useBookStore } from '../stores/book'
import { formatMoney } from '../domain/money'
import { cashFlowSummary } from '../domain/report'
import { currency } from '../domain/seeds'
import type { Transaction } from '../domain/model'
const store = useBookStore()
const openAccount = inject<() => void>('openAccount')!
const openTransaction = inject<() => void>('openTransaction')!
const showTransaction = inject<(t: Transaction) => void>('showTransaction')!
const selectedCurrency = ref('TWD')
const includeAdjustments = ref(false)
const month = DateTime.now().setZone('Asia/Taipei').toFormat('yyyy-MM')
const accounts = computed(() => store.ledger.accounts.filter((a) => !a.archived))
const currencyOptions = computed(() => [
  ...new Set(['TWD', ...store.ledger.accounts.map((a) => a.currencyId)]),
])
const current = computed(() =>
  store.ledger.transactions.filter((t) => !store.ledger.reversed.includes(t.id)),
)
const recent = computed(() =>
  [...current.value]
    .sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`))
    .slice(0, 6),
)
const summary = computed(() =>
  cashFlowSummary(store.ledger, selectedCurrency.value, month, includeAdjustments.value),
)
const formatted = (amount: string) =>
  formatMoney(amount, currency(selectedCurrency.value).precision)
</script>
<template>
  <section class="page-heading">
    <div>
      <p class="small-label">
        {{ DateTime.now().setZone('Asia/Taipei').toFormat('yyyy 年 M 月 d 日') }}
      </p>
      <h1>讓收支，井井有條。</h1>
      <p>每一筆生活，都記得清楚。</p>
    </div>
    <button
      class="button primary"
      :disabled="!store.ready"
      @click="accounts.length ? openTransaction() : openAccount()"
    >
      <AppIcon name="plus" />{{ accounts.length ? '記一筆' : '建立第一個帳戶' }}
    </button>
  </section>
  <div class="page-toolbar">
    <span class="muted">資金收支 · 依交易日 · {{ month }}</span>
    <label class="checkbox"
      ><input v-model="includeAdjustments" type="checkbox" />包含對帳差額</label
    >
  </div>
  <section class="balance-overview" aria-label="帳務摘要">
    <div class="balance-main">
      <div class="balance-caption">
        <span>帳戶總餘額</span
        ><select v-model="selectedCurrency" aria-label="總覽幣種">
          <option v-for="id in currencyOptions" :key="id">{{ id }}</option>
        </select>
      </div>
      <div class="balance-number">{{ formatted(summary.balance) }}</div>
      <p>僅合計 {{ selectedCurrency }} 帳戶，其他幣種分開顯示</p>
      <span class="balance-watermark" aria-hidden="true"
        ><AppIcon name="wallet" :size="112"
      /></span>
    </div>
    <div class="month-stat">
      <span class="stat-icon income"><AppIcon name="income" /></span><span>本月收入</span
      ><strong>{{ formatted(summary.income) }}</strong
      ><small>{{ selectedCurrency }} · 不含轉帳本金</small>
    </div>
    <div class="month-stat">
      <span class="stat-icon expense"><AppIcon name="expense" /></span><span>本月支出</span
      ><strong>{{ formatted(summary.expense) }}</strong
      ><small>{{ selectedCurrency }} · 含轉帳手續費</small>
    </div>
  </section>
  <div class="dashboard-columns">
    <section class="surface transaction-surface">
      <div class="section-heading">
        <h2>最近紀錄</h2>
        <RouterLink to="/transactions" class="text-button"
          >查看全部 <AppIcon name="arrow" :size="16"
        /></RouterLink>
      </div>
      <TransactionList v-if="recent.length" :transactions="recent" @select="showTransaction" />
      <div v-else class="empty-state">
        <span class="empty-icon"><AppIcon name="list" :size="29" /></span>
        <h3>第一筆，就從今天開始</h3>
        <p>
          {{
            accounts.length
              ? '記下午餐、通勤，或今天收到的一筆收入。'
              : '先建立一個帳戶，再記下生活裡的收支。'
          }}
        </p>
        <button
          class="button secondary"
          :disabled="!store.ready"
          @click="accounts.length ? openTransaction() : openAccount()"
        >
          {{ accounts.length ? '新增收支紀錄' : '新增帳戶' }}
        </button>
      </div>
    </section>
    <aside class="account-aside">
      <div class="section-heading">
        <h2>我的帳戶</h2>
        <RouterLink to="/accounts" class="icon-button" aria-label="查看全部帳戶"
          ><AppIcon name="arrow" :size="18"
        /></RouterLink>
      </div>
      <div v-for="a in accounts.slice(0, 4)" :key="a.id" class="account-summary">
        <span class="account-symbol" :class="a.color"><AppIcon name="wallet" :size="19" /></span
        ><span
          ><strong>{{ a.name }}</strong
          ><small>{{ a.group }}</small></span
        ><b
          >{{ formatMoney(store.accountBalances[a.id] || '0', currency(a.currencyId).precision)
          }}<small>{{ a.currencyId }}</small></b
        >
      </div>
      <p v-if="!accounts.length" class="muted account-hint">
        現金、銀行、儲值卡，<br />從最常用的帳戶開始。
      </p>
      <button class="add-account" :disabled="!store.ready" @click="openAccount()">
        <AppIcon name="plus" :size="16" />新增帳戶
      </button>
      <div class="draft-reminder">
        <AppIcon name="draft" :size="24" />
        <h3>想好了，再入帳。</h3>
        <p>草稿會先保存，確認後才更新帳戶餘額。</p>
        <RouterLink to="/drafts"
          >查看草稿 <span>{{ store.visibleDrafts.length }}</span></RouterLink
        >
      </div>
    </aside>
  </div>
</template>
