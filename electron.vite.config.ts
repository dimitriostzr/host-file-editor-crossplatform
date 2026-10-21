import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { thirdPartyNotices } from './scripts/third-party-notices.js'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        // CommonJS, because the `electron` module is CJS and named ESM imports off it do not
        // interop. Bundling to CJS keeps `import { BrowserWindow } from 'electron'` working.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        // A sandboxed preload must be CommonJS: Electron does not allow ESM preloads when
        // sandbox is true, and turning the sandbox off to get ESM would be a bad trade in an
        // app whose renderer orchestrates a write to a root-owned file.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    // Main and preload keep their dependencies external, so those ship in node_modules with
    // their own licence files. Only the renderer bundles third-party code into the app.
    plugins: [react(), tailwindcss(), thirdPartyNotices({ extra: ['tailwindcss'] })],
    build: { rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  },
})
