import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

const productionCsp = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  'frame-src https://accounts.google.com/gsi/',
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'production-security-policy',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: () => [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: productionCsp },
            injectTo: 'head-prepend',
          },
          {
            tag: 'meta',
            attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' },
            injectTo: 'head',
          },
        ],
      },
    },
  ],
  server: { port: 5173, strictPort: true },
  build: { sourcemap: false },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
