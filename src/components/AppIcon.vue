<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  wallet: 'M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V6m19 7h-5v4h5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  draft: 'M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9m-7-7v7h7M7 13h10M7 17h6',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  income: 'M12 4v16m-6-6 6 6 6-6',
  expense: 'M12 20V4m-6 6 6-6 6 6',
  transfer: 'M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5',
  cloud: 'M7 18a5 5 0 1 1 0-10 7 7 0 0 1 13 3 4 4 0 0 1-1 8h-4m-6-2 3-3 3 3m-3-3v8',
  check: 'm5 12 4 4L19 6',
  lock: 'M6 10h12v11H6V10m2 0V6a4 4 0 0 1 8 0v4m-4 5v2',
  refresh: 'M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5',
  search: 'M21 21l-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  food: 'M4 3v6a3 3 0 0 0 6 0V3M7 3v18M19 3v18m0-18c-5 3-5 9 0 9',
  transport: 'M4 16h16V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10Zm0-6h16M7 16v4m10-4v4M7 13h.1M17 13h.1',
  bag: 'M4 8h16l1 13H3L4 8Zm4 0V6a4 4 0 0 1 8 0v2',
  play: 'm9 5 11 7-11 7V5Z',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
  heart: 'M20 5c-3-3-6-1-8 1C5-3-5 7 12 21 29 7 19-3 12 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  book: 'M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1m0-16c3-2 7-2 10-1v16c-3-1-7-1-10 1V5Z',
  chart: 'M4 3v18h17M8 16v-5m5 5V7m5 9V4',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4 4h.01',
  logout: 'M9 3H3v18h6m5-15 6 6-6 6m-7-6h13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.tag" />
  </svg>
</template>
