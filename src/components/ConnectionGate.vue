<script setup lang="ts">
import { useBookStore } from '../stores/book'
import AppIcon from './AppIcon.vue'
const book = useBookStore()
const isDevelopment = import.meta.env.DEV
</script>
<template>
  <section class="connection-gate">
    <div class="gate-copy">
      <span class="small-label">從自己的帳本開始</span>
      <h1>好好記帳，<br />留點餘裕給生活。</h1>
      <p>日常的每一筆，都有清楚的去處。<br />連接自己的 Google Drive，開始整理收支與帳戶。</p>
      <button
        v-if="book.clientId"
        class="button primary large"
        :disabled="book.connecting"
        @click="book.connect"
      >
        <AppIcon name="cloud" />{{ book.connecting ? '正在連接…' : '連接 Google Drive' }}
      </button>
      <RouterLink v-else-if="isDevelopment" class="button primary large" to="/settings"
        ><AppIcon name="settings" />設定 Google 連線</RouterLink
      >
      <p v-if="!book.clientId && !isDevelopment" role="status">
        網站的 Google 連線設定尚未完成，請稍後再試。
      </p>
      <span class="gate-note"><AppIcon name="lock" :size="15" />帳務只保存在你的雲端硬碟</span>
    </div>
    <div class="book-illustration" aria-hidden="true">
      <div class="book-cover">
        <div class="book-spine"></div>
        <div class="book-cover-top">Choubo<span>日常收支帳簿</span></div>
        <div class="book-lines"><span></span><span></span><span></span><span></span></div>
        <div class="book-stamp">慢慢記<br />好好過</div>
      </div>
      <div class="receipt-slip">
        <AppIcon name="check" :size="22" /><span>一筆一筆<br /><strong>都是生活</strong></span>
      </div>
    </div>
  </section>
  <div class="gate-features">
    <div>
      <AppIcon name="list" />
      <h3>一筆消費，多筆明細</h3>
      <p>同一次購物，也能分清飲食和日用品。</p>
    </div>
    <div>
      <AppIcon name="wallet" />
      <h3>各種帳戶，一起整理</h3>
      <p>現金、銀行與不同幣種，分別看得清楚。</p>
    </div>
    <div>
      <AppIcon name="cloud" />
      <h3>資料保留在自己手上</h3>
      <p>使用本人的 Drive，草稿與入帳狀態清楚可見。</p>
    </div>
  </div>
</template>
