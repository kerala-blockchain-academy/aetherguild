import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  build: {
    outDir: '../dist/',
    emptyOutDir: true, // also necessary
    rollupOptions: {
      output: {
        entryFileNames: 'faucet/ui/[name].js',
        chunkFileNames: 'faucet/ui/[name].js',
        assetFileNames: 'faucet/ui/[name].[ext]',
      },
    },
  },
})
