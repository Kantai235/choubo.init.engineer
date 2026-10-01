<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue'
import Dialog from 'primevue/dialog'
import AuthorizationNotice from './AuthorizationNotice.vue'
import AppIcon from './AppIcon.vue'
import { useBookStore } from '../stores/book'
import { newId, kinds, kindNames, type Transaction } from '../domain/model'
import { currency, leafCategories, category } from '../domain/seeds'
import { total, netFee } from '../domain/ledger'
import { formatMoney, money } from '../domain/money'
import { downloadJson } from '../infrastructure/local'
const props = defineProps<{ initial?: Transaction }>()
const emit = defineEmits<{ close: [] }>()
const store = useBookStore()
const ownerId = store.identity?.id
const form = reactive<Transaction>(
  props.initial ? JSON.parse(JSON.stringify(props.initial)) : store.newTransaction(),
)
const error = ref('')
const saved = ref(false)
const changed = ref(false)
const advanced = ref(false)
const submitting = ref(false)
const pending = computed(() =>
  store.pending.some(
    (op) => op.command.type === 'transaction.post' && op.command.transaction.id === form.id,
  ),
)
let timer: ReturnType<typeof setTimeout> | undefined
const accounts = computed(() => store.ledger.accounts.filter((a) => !a.archived))
const source = computed(() => accounts.value.find((a) => a.id === form.accountId))
const destination = computed(() => accounts.value.find((a) => a.id === form.targetAccountId))
const options = computed(() =>
  leafCategories(form.kind).filter((c) => !(form.kind === 'transfer' && c.name === '退款')),
)
const safeTotal = computed(() => {
  try {
    return formatMoney(total(form), source.value ? currency(source.value.currencyId).precision : 2)
  } catch {
    return '—'
  }
})
const sourceDebit = computed(() => {
  try {
    return formatMoney(
      money(total(form)).plus(netFee(form)).toFixed(),
      source.value ? currency(source.value.currencyId).precision : 2,
    )
  } catch {
    return '—'
  }
})
const draft = computed(() =>
  store.drafts.find((d) => d.id === form.id && JSON.stringify(d.value) === JSON.stringify(form)),
)
const savedLabel = computed(() =>
  draft.value && store.isDraftSynced(draft.value)
    ? '草稿已同步至 Drive'
    : saved.value
      ? '草稿已暫存本機'
      : '尚未保存',
)
function persist() {
  clearTimeout(timer)
  if (store.identity?.id !== ownerId) return
  if (!changed.value && !saved.value) return
  try {
    store.saveDraft(form)
    saved.value = true
    changed.value = false
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '草稿尚未安全保存'
  }
}
watch(
  form,
  () => {
    changed.value = true
    saved.value = false
    clearTimeout(timer)
    timer = setTimeout(persist, 350)
  },
  { deep: true },
)
function changeKind(kind: Transaction['kind']) {
  form.kind = kind
  form.targetAccountId = ''
  form.fee = '0'
  form.feeDiscount = '0'
  form.lines = form.lines.map((l) => ({
    ...l,
    categoryId: options.value[0]?.id ?? '',
    destinationAmount: '',
  }))
}
function addLine() {
  form.lines.push({
    id: newId(),
    categoryId: options.value[0]?.id ?? '',
    name: '',
    amount: '',
    destinationAmount: '',
  })
}
function sameCurrency(line: Transaction['lines'][number]) {
  if (source.value?.currencyId === destination.value?.currencyId)
    line.destinationAmount = line.amount
}
watch(
  () => [form.accountId, form.targetAccountId],
  () => {
    if (form.kind === 'transfer') form.lines.forEach(sameCurrency)
  },
)
function fillName(line: Transaction['lines'][number]) {
  if (!line.name.trim()) line.name = category(line.categoryId)?.name ?? ''
}
function keepDraft() {
  changed.value = true
  close()
}
function close() {
  persist()
  if (error.value && changed.value) return
  emit('close')
}
async function submit() {
  error.value = ''
  changed.value = true
  persist()
  if (!saved.value) return
  submitting.value = true
  try {
    await store.postDraft(form.id)
    emit('close')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '提交尚未完成'
  } finally {
    submitting.value = false
  }
}
window.addEventListener('pagehide', persist)
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', persist)
  clearTimeout(timer)
  if (changed.value) persist()
})
</script>
<template>
  <Dialog
    :visible="true"
    modal
    header="記下一筆"
    class="transaction-dialog"
    :closable="!store.working"
    @update:visible="close"
  >
    <form class="form-stack" @submit.prevent="submit">
      <AuthorizationNotice in-editor />
      <p v-if="pending" class="inline-error">
        這筆內容正在等待提交確認，暫停修改。可回到草稿頁查回／重試。
      </p>
      <fieldset class="editor-fields" :disabled="submitting || pending">
        <div class="segmented" role="group" aria-label="紀錄類型">
          <button
            v-for="kind in kinds"
            :key="kind"
            type="button"
            :class="{ active: form.kind === kind }"
            :aria-pressed="form.kind === kind"
            @click="changeKind(kind)"
          >
            <AppIcon :name="kind" :size="17" />{{ kindNames[kind] }}
          </button>
        </div>
        <div class="form-grid">
          <label
            >{{ form.kind === 'transfer' ? '轉出帳戶' : '帳戶'
            }}<select v-model="form.accountId" required aria-label="記帳帳戶">
              <option disabled value="">選擇帳戶</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">
                {{ a.name }} · {{ a.currencyId }}
              </option>
            </select></label
          ><label v-if="form.kind === 'transfer'"
            >轉入帳戶<select v-model="form.targetAccountId" aria-label="轉入帳戶" required>
              <option disabled value="">選擇轉入帳戶</option>
              <option
                v-for="a in accounts.filter((a) => a.id !== form.accountId)"
                :key="a.id"
                :value="a.id"
              >
                {{ a.name }} · {{ a.currencyId }}
              </option>
            </select></label
          ><label v-else
            >商家／對象<input
              v-model="form.merchant"
              placeholder="選填，例如：巷口早餐店"
              maxlength="120"
          /></label>
        </div>
        <div class="form-grid">
          <label>日期<input v-model="form.date" type="date" required /></label
          ><label>時間<input v-model="form.time" type="time" required /></label>
        </div>
        <div class="detail-header">
          <h3>
            分類明細 <span>{{ form.lines.length }}</span>
          </h3>
          <span>{{ source?.currencyId || '先選擇帳戶' }}</span>
        </div>
        <div v-for="(line, index) in form.lines" :key="line.id" class="detail-line">
          <div class="line-number">{{ index + 1 }}</div>
          <div class="line-fields">
            <label class="sr-only" :for="`category-${line.id}`">第 {{ index + 1 }} 行分類</label
            ><select :id="`category-${line.id}`" v-model="line.categoryId" @change="fillName(line)">
              <option v-for="c in options" :key="c.id" :value="c.id">
                {{ c.parentId ? `${category(c.parentId)?.name}／` : '' }}{{ c.name }}
              </option>
            </select>
            <input
              v-model="line.name"
              :aria-label="`第 ${index + 1} 行名稱`"
              placeholder="明細名稱"
              maxlength="120"
              required
            />
            <input
              v-model="line.amount"
              :aria-label="`第 ${index + 1} 行金額`"
              class="amount-input"
              inputmode="decimal"
              placeholder="0"
              required
              @input="sameCurrency(line)"
            />
            <label v-if="form.kind === 'transfer'" class="destination-input"
              >轉入 {{ destination?.currencyId
              }}<input
                v-model="line.destinationAmount"
                :aria-label="`第 ${index + 1} 行轉入金額`"
                inputmode="decimal"
                placeholder="實際轉入金額"
                required
            /></label>
          </div>
          <button
            type="button"
            class="icon-button remove-line"
            :aria-label="`刪除第 ${index + 1} 行`"
            :disabled="form.lines.length === 1"
            @click="form.lines.splice(index, 1)"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </div>
        <button type="button" class="add-line" @click="addLine">
          <AppIcon name="plus" :size="17" />新增一行明細
        </button>
        <div v-if="form.kind === 'transfer'" class="form-grid">
          <label>手續費<input v-model="form.fee" inputmode="decimal" /></label
          ><label>手續費折扣<input v-model="form.feeDiscount" inputmode="decimal" /></label>
        </div>
        <div class="receipt-total">
          <span
            >{{ form.kind === 'transfer' ? '轉出本金' : '合計'
            }}<small>{{ form.lines.length }} 筆明細</small></span
          ><strong
            ><small>{{ source?.currencyId || '—' }}</small
            >{{ safeTotal }}</strong
          >
        </div>
        <p v-if="form.kind === 'transfer'" class="muted">
          含手續費實扣 {{ source?.currencyId }} {{ sourceDebit }}；本金不列支出。
        </p>
        <button
          type="button"
          class="text-button more-fields"
          :aria-expanded="advanced"
          @click="advanced = !advanced"
        >
          {{ advanced ? '收起' : '新增' }}備註與發票資料
        </button>
        <template v-if="advanced"
          ><label>整筆名稱<input v-model="form.title" maxlength="120" placeholder="選填" /></label>
          <div class="form-grid">
            <label>發票號碼<input v-model="form.invoiceNumber" maxlength="40" /></label
            ><label>隨機碼<input v-model="form.randomCode" maxlength="40" /></label>
          </div>
          <label>備註<textarea v-model="form.note" rows="2" maxlength="2000" /></label
        ></template>
      </fieldset>
      <p v-if="error" role="alert" class="inline-error">{{ error }}</p>
      <div class="draft-status">
        <span><AppIcon name="draft" :size="15" />{{ savedLabel }}</span
        ><button
          type="button"
          class="text-button"
          @click="downloadJson(`choubo-draft-${form.id}.json`, form)"
        >
          下載草稿
        </button>
      </div>
      <div class="dialog-actions">
        <button type="button" class="button secondary" :disabled="store.working" @click="keepDraft">
          保留草稿</button
        ><button class="button primary" :disabled="store.working || !store.online || !store.ready">
          {{ store.working ? '等待雲端確認…' : '確認入帳' }}
        </button>
      </div>
      <p class="submit-note">
        {{
          store.online
            ? 'Google Drive 確認保存後，才會更新正式餘額。'
            : '目前離線，可以繼續編輯與保留草稿。'
        }}
      </p>
    </form>
  </Dialog>
</template>
