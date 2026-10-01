import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../features/Dashboard.vue'
import Accounts from '../features/Accounts.vue'
import Transactions from '../features/Transactions.vue'
import Drafts from '../features/Drafts.vue'
import Settings from '../features/Settings.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Dashboard, meta: { title: '總覽' } },
    { path: '/accounts', component: Accounts, meta: { title: '我的帳戶' } },
    { path: '/transactions', component: Transactions, meta: { title: '收支紀錄' } },
    { path: '/drafts', component: Drafts, meta: { title: '草稿與待處理' } },
    { path: '/settings', component: Settings, meta: { title: '資料與設定' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
