import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import { definePreset } from '@primeuix/themes'
import '@fontsource-variable/manrope'
import './styles/main.scss'
import App from './App.vue'
import { router } from './app/router'

const ledgerTheme = definePreset(Aura, {
  components: {
    dialog: {
      colorScheme: {
        light: {
          root: { background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--line)' },
        },
        dark: {
          root: { background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--line)' },
        },
      },
    },
  },
})

createApp(App)
  .use(createPinia())
  .use(router)
  .use(PrimeVue, { theme: { preset: ledgerTheme, options: { darkModeSelector: 'system' } } })
  .mount('#app')
