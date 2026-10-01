<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { type Transaction, kindNames } from '../domain/model'
import { category, currency } from '../domain/seeds'
import { formatMoney } from '../domain/money'
import { total } from '../domain/ledger'
import { useBookStore } from '../stores/book'
defineProps<{ transactions: Transaction[] }>()
defineEmits<{ select: [transaction: Transaction] }>()
const store = useBookStore()
const account = (id: string) => store.ledger.accounts.find((a) => a.id === id)
</script>
<template>
  <div class="transaction-list">
    <button
      v-for="tx in transactions"
      :key="tx.id"
      class="transaction-row"
      @click="$emit('select', tx)"
    >
      <span class="category-icon" :class="tx.kind"
        ><AppIcon
          :name="
            tx.kind === 'expense' ? category(tx.lines[0]?.categoryId)?.icon || 'tag' : tx.kind
          "
      /></span>
      <span class="transaction-description"
        ><strong
          >{{ tx.title || tx.merchant || tx.lines[0]?.name
          }}<span v-if="store.ledger.reversed.includes(tx.id)" class="badge neutral"
            >已撤銷</span
          ></strong
        ><small
          >{{ tx.date.slice(5).replace('-', '/') }} <span class="separator">·</span>
          {{ account(tx.accountId)?.name }}
          <span v-if="tx.kind === 'transfer'">→ {{ account(tx.targetAccountId)?.name }}</span
          ><span v-else>
            ·
            {{
              tx.lines.length > 1
                ? `${tx.lines.length} 筆明細`
                : category(tx.lines[0]?.categoryId)?.name
            }}</span
          ></small
        ></span
      >
      <span class="transaction-amount" :class="tx.kind"
        ><strong
          >{{ tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '−' : ''
          }}{{
            formatMoney(total(tx), currency(account(tx.accountId)?.currencyId || 'TWD').precision)
          }}</strong
        ><small>{{ account(tx.accountId)?.currencyId }} · {{ kindNames[tx.kind] }}</small></span
      >
    </button>
  </div>
</template>
