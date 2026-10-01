<script setup lang="ts">
import { onMounted, onBeforeUnmount, provide, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from 'primevue/dialog'
import { useBookStore } from './stores/book'
import AppIcon from './components/AppIcon.vue'
import AccountEditor from './components/AccountEditor.vue'
import TransactionEditor from './components/TransactionEditor.vue'
import ConnectionGate from './components/ConnectionGate.vue'
import { preloadGoogle } from './infrastructure/auth'
import { categoryLabel, currency } from './domain/seeds'
import { formatMoney, sum, money } from './domain/money'
import { total, netFee } from './domain/ledger'
import { kindNames, type AccountView, type Transaction } from './domain/model'
const store = useBookStore()
const route = useRoute()
const editingAccount = ref(false)
const account = ref<AccountView>()
const editingTransaction = ref(false)
const transaction = ref<Transaction>()
const selected = ref<Transaction>()
const reversal = ref(false)
const reason = ref('')
const currentAccount = computed(() =>
  store.ledger.accounts.find((a) => a.id === selected.value?.accountId),
)
const targetAccount = computed(() =>
  store.ledger.accounts.find((a) => a.id === selected.value?.targetAccountId),
)
const navigation = [
  { path: '/', label: '總覽', icon: 'home' },
  { path: '/accounts', label: '我的帳戶', icon: 'wallet' },
  { path: '/transactions', label: '收支紀錄', icon: 'list' },
  { path: '/drafts', label: '草稿', icon: 'draft' },
  { path: '/settings', label: '設定', icon: 'settings' },
]
provide('openAccount', (value?: AccountView) => {
  account.value = value
  editingAccount.value = true
})
provide('openTransaction', (value?: Transaction) => {
  transaction.value = value
  editingTransaction.value = true
})
provide('showTransaction', (value: Transaction) => {
  selected.value = value
  reversal.value = false
  reason.value = ''
})
watch(
  () => store.identity?.id,
  () => {
    editingAccount.value = false
    account.value = undefined
    editingTransaction.value = false
    transaction.value = undefined
    selected.value = undefined
    reversal.value = false
    reason.value = ''
  },
  { flush: 'sync' },
)
let cleanup: (() => void) | undefined
onMounted(() => {
  cleanup = store.initEvents()
  void store.restoreConnection()
  if (store.clientId) void preloadGoogle()
})
onBeforeUnmount(() => cleanup?.())
async function reverse() {
  if (!selected.value) return
  try {
    await store.reverse(selected.value.id, reason.value)
    selected.value = undefined
  } catch {
    /* Global status retains the actionable error. */
  }
}
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand" aria-label="Choubo 首頁"
        ><span class="brand-mark"><AppIcon name="book" :size="24" /></span
        ><span>Choubo<small>把生活記清楚</small></span></RouterLink
      >
      <div class="nav-caption">我的帳簿</div>
      <nav aria-label="主要導覽">
        <RouterLink
          v-for="item in navigation"
          :key="item.path"
          :to="item.path"
          :class="{ active: route.path === item.path }"
          ><AppIcon :name="item.icon" /><span>{{ item.label }}</span
          ><b v-if="item.path === '/drafts' && store.visibleDrafts.length">{{
            store.visibleDrafts.length
          }}</b></RouterLink
        >
      </nav>
      <div class="sidebar-footer">
        <div class="privacy-line">
          <AppIcon name="lock" :size="16" /><span>你的資料，只屬於你</span>
        </div>
        <div class="profile">
          <span class="avatar">{{ store.identity?.name.slice(0, 1) || 'C' }}</span
          ><span
            ><strong>{{ store.identity?.name || '我的個人帳簿' }}</strong
            ><small>{{
              store.ready ? 'Google Drive 已授權' : '等待連接 Google Drive'
            }}</small></span
          >
        </div>
      </div>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <span class="breadcrumb"><span>我的帳簿</span><i>/</i>{{ route.meta.title }}</span>
        <div class="topbar-actions">
          <RouterLink
            to="/settings"
            class="sync-indicator"
            :class="{
              warning: !store.online || !!store.error,
              connected: store.ready && store.online,
            }"
            ><span></span><span>{{ store.status }}</span></RouterLink
          ><button
            v-if="store.identity"
            class="icon-button"
            :disabled="store.working || !store.ready || !store.online"
            aria-label="重新同步"
            @click="store.sync().catch(() => undefined)"
          >
            <AppIcon name="refresh" :size="18" /></button
          ><span class="top-avatar">{{ store.identity?.name.slice(0, 1) || 'C' }}</span>
        </div>
      </header>
      <main id="main-content">
        <div v-if="store.error" role="alert" class="banner error-banner">
          <span>{{ store.error }}</span
          ><button class="icon-button" aria-label="關閉錯誤提示" @click="store.error = ''">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
        <div v-if="store.notice" role="status" class="banner success-banner">
          <AppIcon name="check" :size="18" /><span>{{ store.notice }}</span
          ><button class="icon-button" aria-label="關閉提示" @click="store.notice = ''">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
        <div v-if="store.cached" class="banner">
          顯示上次確認的快取資料（{{
            new Date(store.lastSyncedAt).toLocaleString('zh-TW')
          }}），尚待與 Google Drive 核對。
        </div>
        <RouterLink
          v-if="store.ledger.conflicts.length && route.path !== '/drafts'"
          class="banner conflict-banner"
          to="/drafts"
          >{{
            store.ledger.conflicts.length
          }}
          項資料需要核對，相關紀錄已暫停入帳。查看待處理</RouterLink
        ><ConnectionGate v-if="!store.identity && route.path !== '/settings'" /><RouterView
          v-else
        />
      </main>
      <footer class="app-footer">
        <span>慢慢記，好好過。</span
        ><span
          ><a href="/privacy.html" target="_blank" rel="noopener noreferrer">資料與隱私</a> · Choubo
          個人帳簿</span
        >
      </footer>
    </div>
    <nav class="mobile-nav" aria-label="手機導覽">
      <RouterLink
        v-for="item in navigation"
        :key="item.path"
        :to="item.path"
        :class="{ active: route.path === item.path }"
        ><AppIcon :name="item.icon" :size="21" /><span>{{
          item.label === '我的帳戶' ? '帳戶' : item.label === '收支紀錄' ? '紀錄' : item.label
        }}</span></RouterLink
      >
    </nav>
    <AccountEditor
      v-if="editingAccount && store.identity"
      :account="account"
      @close="editingAccount = false"
    />
    <TransactionEditor
      v-if="editingTransaction && store.identity"
      :initial="transaction"
      @close="editingTransaction = false"
    />
    <Dialog
      :visible="!!selected && !!store.identity"
      modal
      header="紀錄明細"
      class="account-dialog"
      @update:visible="selected = undefined"
      ><template v-if="selected"
        ><div class="record-detail">
          <span class="badge"
            >{{ kindNames[selected.kind]
            }}{{ store.ledger.reversed.includes(selected.id) ? ' · 已撤銷' : '' }}</span
          >
          <h2>{{ selected.title || selected.merchant || selected.lines[0]?.name }}</h2>
          <p>{{ selected.date }} {{ selected.time }} · {{ currentAccount?.name }}</p>
          <p v-if="selected.merchant">商家／對象：{{ selected.merchant }}</p>
          <p v-if="selected.kind === 'transfer'">
            轉入帳戶：{{ targetAccount?.name }} · {{ targetAccount?.currencyId }}
          </p>
          <div v-for="line in selected.lines" :key="line.id" class="record-line">
            <span
              ><strong>{{ line.name }}</strong
              ><small>{{ categoryLabel(line.categoryId) }}</small></span
            ><b>{{
              formatMoney(line.amount, currency(currentAccount?.currencyId || 'TWD').precision)
            }}</b>
          </div>
          <div class="receipt-total">
            <span>本金合計</span
            ><strong
              ><small>{{ currentAccount?.currencyId }}</small
              >{{
                formatMoney(
                  total(selected),
                  currency(currentAccount?.currencyId || 'TWD').precision,
                )
              }}</strong
            >
          </div>
          <p v-if="selected.kind === 'transfer'">
            轉入合計 {{ targetAccount?.currencyId }}
            {{
              formatMoney(
                sum(selected.lines.map((line) => line.destinationAmount)),
                currency(targetAccount?.currencyId || 'TWD').precision,
              )
            }}<br />
            手續費 {{ selected.fee }}，手續費折扣 {{ selected.feeDiscount }}<br />
            來源實扣 {{ currentAccount?.currencyId }}
            {{
              formatMoney(
                money(total(selected)).plus(netFee(selected)).toFixed(),
                currency(currentAccount?.currencyId || 'TWD').precision,
              )
            }}
          </p>
          <p v-if="selected.invoiceNumber">
            發票 {{ selected.invoiceNumber }} · {{ selected.randomCode }}
          </p>
          <p v-if="selected.note" class="detail-note">{{ selected.note }}</p>
          <template v-if="!store.ledger.reversed.includes(selected.id)"
            ><button
              v-if="!reversal"
              class="text-button danger"
              :disabled="!store.ready"
              @click="reversal = true"
            >
              撤銷這筆紀錄
            </button>
            <form v-else class="form-stack" @submit.prevent="reverse">
              <p class="inline-error">將沖回這筆紀錄對帳戶餘額的影響，原始內容會保留。</p>
              <label
                >撤銷原因<input
                  v-model="reason"
                  required
                  maxlength="500"
                  placeholder="例如：重複記帳" /></label
              ><button class="button danger-button" :disabled="store.working || !store.online">
                {{ store.working ? '正在確認…' : '確認撤銷' }}
              </button>
            </form></template
          >
        </div></template
      ></Dialog
    >
  </div>
</template>
