<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useBookStore } from '../stores/book'
import { groups, type AccountView } from '../domain/model'
import { currency } from '../domain/seeds'
import { formatMoney } from '../domain/money'
import AppIcon from '../components/AppIcon.vue'
const store = useBookStore()
const openAccount = inject<(account?: AccountView) => void>('openAccount')!
const showArchived = ref(false)
const visible = computed(() =>
  store.ledger.accounts.filter((a) => showArchived.value || !a.archived),
)
function setDefault(id: string) {
  void store.setDefault(id).catch(() => undefined)
}
</script>
<template>
  <section class="page-heading">
    <div>
      <p class="small-label">把錢放對地方</p>
      <h1>我的帳戶</h1>
      <p>分組整理，清楚看見每個帳戶的餘額。</p>
    </div>
    <button class="button primary" :disabled="!store.ready" @click="openAccount()">
      <AppIcon name="plus" />新增帳戶
    </button>
  </section>
  <div class="page-toolbar">
    <span class="muted">{{ visible.length }} 個帳戶 · {{ groups.length }} 種分組</span
    ><label class="checkbox"><input v-model="showArchived" type="checkbox" />顯示已封存</label>
  </div>
  <div v-if="!visible.length" class="surface empty-state">
    <span class="empty-icon"><AppIcon name="wallet" :size="30" /></span>
    <h3>給每一筆錢，一個位置</h3>
    <p>可以先新增「日常現金」或最常用的銀行帳戶。</p>
    <button class="button primary" :disabled="!store.ready" @click="openAccount()">
      建立第一個帳戶
    </button>
  </div>
  <section
    v-for="group in groups.filter((g) => visible.some((a) => a.group === g))"
    :key="group"
    class="account-group"
  >
    <h2>
      {{ group }} <span>{{ visible.filter((a) => a.group === group).length }}</span>
    </h2>
    <div class="account-grid">
      <article
        v-for="a in visible.filter((a) => a.group === group)"
        :key="a.id"
        class="account-card"
        :class="{ archived: a.archived }"
      >
        <div class="account-card-top">
          <span class="account-symbol" :class="a.color"><AppIcon name="wallet" /></span
          ><span v-if="store.ledger.defaultAccountId === a.id" class="badge">預設帳戶</span
          ><button
            class="icon-button"
            :disabled="!store.ready"
            :aria-label="`編輯${a.name}`"
            @click="openAccount(a)"
          >
            <AppIcon name="settings" />
          </button>
        </div>
        <h3>{{ a.name }} <span v-if="a.archived" class="badge neutral">已封存</span></h3>
        <p class="account-card-balance">
          <small>{{ a.currencyId }}</small
          >{{ formatMoney(store.accountBalances[a.id] || '0', currency(a.currencyId).precision) }}
        </p>
        <p class="account-note">
          {{ a.note || (a.includeInTotal ? '納入總餘額' : '不納入總餘額') }}
        </p>
        <button
          v-if="!a.archived && store.ledger.defaultAccountId !== a.id"
          class="text-button"
          :disabled="store.working || !store.ready"
          @click="setDefault(a.id)"
        >
          設為預設記帳帳戶</button
        ><span v-else class="muted">{{
          a.archived ? '歷史紀錄仍可查閱' : '新增紀錄時自動帶入'
        }}</span>
      </article>
    </div>
  </section>
</template>
