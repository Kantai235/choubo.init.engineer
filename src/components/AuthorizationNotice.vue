<script setup lang="ts">
import { useBookStore } from '../stores/book'
defineProps<{ inEditor?: boolean }>()
const store = useBookStore()
</script>
<template>
  <div
    v-if="
      store.identity && !store.connecting && (store.renewalDue || !store.ready || store.renewing)
    "
    class="banner authorization-notice"
    role="status"
  >
    <div>
      <strong>{{
        store.renewing
          ? '正在更新 Google 授權'
          : store.ready
            ? 'Google 授權即將到期'
            : 'Google 授權需要續接'
      }}</strong>
      <p>點一下續接目前帳號，正在編輯的內容會保留。</p>
      <p v-if="inEditor && store.error" role="alert">{{ store.error }}</p>
      <p v-if="!store.online">目前離線，請於恢復網路後續接。</p>
    </div>
    <button
      type="button"
      class="button secondary"
      :disabled="store.working || !store.online"
      @click="store.renewAuthorization"
    >
      {{ store.renewing ? '正在續接…' : '續接 Google Drive' }}
    </button>
  </div>
</template>
