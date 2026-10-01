<script setup lang="ts">
import { reactive, ref } from 'vue'
import Dialog from 'primevue/dialog'
import AuthorizationNotice from './AuthorizationNotice.vue'
import { groups, newId, type Account, type AccountView } from '../domain/model'
import { currencies } from '../domain/seeds'
import { useBookStore } from '../stores/book'
const props = defineProps<{ account?: AccountView }>()
const emit = defineEmits<{ close: [] }>()
const store = useBookStore()
const account = reactive<Account>(
  props.account
    ? {
        id: props.account.id,
        name: props.account.name,
        group: props.account.group,
        currencyId: props.account.currencyId,
        openingBalance: props.account.openingBalance,
        note: props.account.note,
        includeInTotal: props.account.includeInTotal,
        isCredit: props.account.isCredit,
        archived: props.account.archived,
        color: props.account.color,
      }
    : {
        id: newId(),
        name: '',
        group: '現金',
        currencyId: 'TWD',
        openingBalance: '0',
        note: '',
        includeInTotal: true,
        isCredit: false,
        archived: false,
        color: 'blue',
      },
)
const error = ref('')
async function save() {
  error.value = ''
  try {
    await store.saveAccount(account, props.account?.versionId ?? null)
    emit('close')
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '未能保存帳戶'
  }
}
</script>
<template>
  <Dialog
    :visible="true"
    modal
    :header="account.name || '新增帳戶'"
    class="account-dialog"
    :closable="!store.working"
    @update:visible="emit('close')"
  >
    <form class="form-stack" @submit.prevent="save">
      <AuthorizationNotice in-editor />
      <label
        >帳戶名稱<input
          v-model="account.name"
          autofocus
          maxlength="60"
          placeholder="例如：日常現金、薪轉帳戶"
          required
      /></label>
      <div class="form-grid">
        <label
          >帳戶分組<select v-model="account.group" aria-label="帳戶分組">
            <option v-for="group in groups" :key="group">{{ group }}</option>
          </select></label
        ><label
          >主幣種<select
            v-model="account.currencyId"
            aria-label="主幣種"
            :disabled="!!props.account"
          >
            <option v-for="c in currencies" :key="c.id" :value="c.id">
              {{ c.id }} · {{ c.name }}
            </option>
          </select></label
        >
      </div>
      <label
        >期初餘額<input
          v-model="account.openingBalance"
          inputmode="decimal"
          :disabled="!!props.account"
          required
        /><small
          >不列入收入。若需記錄既有欠款，可輸入負數；目前尚未提供信用額度與帳單功能。</small
        ></label
      >
      <label
        >備註<textarea
          v-model="account.note"
          rows="2"
          maxlength="2000"
          placeholder="可填帳戶用途，請勿輸入密碼"
        />
      </label>
      <fieldset class="color-field">
        <legend>辨識色彩</legend>
        <label
          v-for="color in ['blue', 'green', 'orange', 'purple'] as const"
          :key="color"
          class="color-choice"
          :class="color"
          ><input
            v-model="account.color"
            type="radio"
            :value="color"
            :aria-label="
              { blue: '藍色', green: '綠色', orange: '橘色', purple: '紫色' }[color]
            " /><span></span
        ></label>
      </fieldset>
      <label class="checkbox"
        ><input v-model="account.includeInTotal" type="checkbox" />納入總餘額</label
      >
      <label v-if="props.account" class="checkbox"
        ><input v-model="account.archived" type="checkbox" />封存帳戶（保留歷史紀錄）</label
      >
      <p v-if="error" role="alert" class="inline-error">{{ error }}</p>
      <div class="dialog-actions">
        <button
          class="button secondary"
          type="button"
          :disabled="store.working"
          @click="emit('close')"
        >
          取消</button
        ><button class="button primary" :disabled="store.working || !store.online || !store.ready">
          {{ store.working ? '正在保存…' : '保存帳戶' }}
        </button>
      </div>
    </form>
  </Dialog>
</template>
