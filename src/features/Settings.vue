<script setup lang="ts">
import { ref } from 'vue'
import { useBookStore } from '../stores/book'
import { downloadJson } from '../infrastructure/local'
import AppIcon from '../components/AppIcon.vue'
const store = useBookStore()
const clientId = ref(store.clientId)
const configMessage = ref('')
const origin = window.location.origin
const isDevelopment = import.meta.env.DEV
const fromEnv = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID)
function save() {
  if (!clientId.value.trim().endsWith('.apps.googleusercontent.com')) {
    configMessage.value = '請填入以 .apps.googleusercontent.com 結尾的網頁用戶端 ID'
    return
  }
  store.saveConfig(clientId.value)
  configMessage.value = '連線設定已保存，可以連接 Google Drive'
}
function exportBook() {
  try {
    downloadJson(`choubo-export-${new Date().toISOString().slice(0, 10)}.json`, store.exportData())
  } catch (error) {
    store.error = error instanceof Error ? error.message : '無法匯出'
  }
}
</script>
<template>
  <section class="page-heading">
    <div>
      <p class="small-label">資料保留在自己手上</p>
      <h1>資料與設定</h1>
      <p>管理 Google 連線、本機快取與帳務匯出。</p>
    </div>
  </section>
  <div class="settings-stack">
    <section class="surface settings-section">
      <div class="settings-icon"><AppIcon name="settings" :size="25" /></div>
      <div class="settings-body">
        <h2>顯示外觀</h2>
        <p>
          跟隨系統設定，目前為<span class="theme-light-label">亮色</span
          ><span class="theme-dark-label">暗色</span>模式。變更裝置的外觀設定後，網站會即時更新。
        </p>
      </div>
    </section>
    <section class="surface settings-section">
      <div class="settings-icon"><AppIcon name="cloud" :size="25" /></div>
      <div class="settings-body">
        <h2>Google Drive 連線</h2>
        <p>
          {{
            store.identity
              ? `${store.identity.name} · ${store.identity.email}`
              : '授權後，資料會放在你的 My Drive 根目錄「Choubo 記帳資料」資料夾。'
          }}
        </p>
        <p class="muted">
          同一分頁重整會恢復有效授權。到期前可續接目前帳號，保留正在編輯的內容；Google
          可能要求登入或確認。登出會清除此分頁的授權與帳號提示。
        </p>
        <div class="settings-actions">
          <button
            class="button primary"
            :disabled="!store.clientId || store.connecting || store.working || !store.online"
            @click="store.connect"
          >
            {{
              store.renewing
                ? '正在續接…'
                : store.restoring
                  ? '正在恢復連線…'
                  : store.connecting
                    ? '正在連接…'
                    : store.identity
                      ? '續接目前帳號'
                      : '連接 Google Drive'
            }}
          </button>
          <button
            v-if="store.identity || store.hasAccountHint"
            class="button secondary"
            :disabled="store.connecting || store.working || !store.online"
            @click="store.switchAccount"
          >
            切換帳號</button
          ><a
            v-if="store.folderUrl"
            class="button secondary"
            :href="store.folderUrl"
            target="_blank"
            rel="noopener noreferrer"
            >查看 Drive 資料夾</a
          ><button
            v-if="store.identity || store.connecting || store.hasAccountHint"
            class="text-button danger"
            @click="store.disconnect"
          >
            登出
          </button>
        </div>
        <p v-if="store.authorizationExpiresAt" class="muted authorization-expiry">
          目前授權有效至：{{
            new Date(store.authorizationExpiresAt).toLocaleString('zh-TW')
          }}。實際期限由 Google 核發，續接成功才會更新。
        </p>
        <p v-if="store.lastSyncedAt" class="muted">
          最後核對：{{ new Date(store.lastSyncedAt).toLocaleString('zh-TW') }}
        </p>
      </div>
    </section>
    <section v-if="isDevelopment && (!store.clientId || !fromEnv)" class="surface settings-section">
      <div class="settings-icon"><AppIcon name="settings" :size="25" /></div>
      <div class="settings-body">
        <h2>開發環境連線設定</h2>
        <p>
          網站尚未配置 Google 用戶端時，由網站開發者完成此設定。一般使用者不需要自行建立 Google
          Cloud 專案。
        </p>
        <ol class="setup-steps">
          <li>在 Google Cloud 啟用 Google Drive API，設定 OAuth 同意畫面。</li>
          <li>建立「網頁應用程式」OAuth 用戶端。</li>
          <li>
            將目前網站來源 <code>{{ origin }}</code> 加到授權的 JavaScript 來源。
          </li>
          <li>測試模式時將登入帳號加入測試使用者。</li>
        </ol>
        <form @submit.prevent="save">
          <label
            >Google Client ID<input
              v-model="clientId"
              placeholder="…apps.googleusercontent.com"
              autocomplete="off"
              spellcheck="false"
          /></label>
          <p class="muted">
            只需要公開 Client ID，請勿填入 Client Secret。正式部署可用 VITE_GOOGLE_CLIENT_ID 設定。
          </p>
          <button class="button secondary">保存連線設定</button>
          <p v-if="configMessage" role="status" class="config-message">{{ configMessage }}</p>
        </form>
      </div>
    </section>
    <section class="surface settings-section">
      <div class="settings-icon"><AppIcon name="download" :size="25" /></div>
      <div class="settings-body">
        <h2>匯出目前帳務</h2>
        <p>下載本版已載入的帳戶、操作、草稿與待確認提交。不包含授權憑證。</p>
        <p class="muted">此為基本 JSON 匯出；完整圖片備份與還原功能仍在後續階段。</p>
        <button
          class="button secondary"
          :disabled="!store.ready || store.working"
          @click="exportBook"
        >
          下載 JSON
        </button>
      </div>
    </section>
    <section class="surface settings-section">
      <div class="settings-icon"><AppIcon name="refresh" :size="25" /></div>
      <div class="settings-body">
        <h2>本機快取</h2>
        <p>清除後會在下次連接從 Drive 重建。草稿及未確認提交會保留。</p>
        <button class="button secondary" :disabled="!store.ready" @click="store.clearCache">
          清除可重建快取
        </button>
      </div>
    </section>
    <p class="version-note">
      Choubo 0.1.0 · 基礎記帳開發版<br />目前提供帳戶、收入、支出、轉帳與草稿。信用帳單、回饋、分期及應收應付依開發階段陸續加入。
    </p>
  </div>
</template>
