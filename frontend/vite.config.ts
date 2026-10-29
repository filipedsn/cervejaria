import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const isProdServe = process.env.QUIVER_ENV === 'production';
const frontendPort = isProdServe ? 5201 : 5202;
const apiPort = Number(process.env.VITE_API_PORT ?? (isProdServe ? 3001 : 3002));

export default defineConfig({  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null,
      devOptions: {
        enabled: true,
        type: 'module',
      },
      includeAssets: ['logo.png', 'icons/pwa-192.png', 'icons/pwa-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        scope: '/',
        name: 'Quiver Tap',
        short_name: 'Quiver Tap',
        description: 'Controle de comandas para cervejarias móveis',
        theme_color: '#f6f9fc',
        background_color: '#f6f9fc',
        display: 'standalone',
        display_override: ['standalone', 'fullscreen'],
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icons/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    // 0.0.0.0 — celular na mesma LAN acessa via IP:5202 (tapdev/DNS externo não é mais o caminho DEV).
    host: true,
    port: frontendPort,
    // Em DEV liberar qualquer Host (IP LAN / Tailscale). Em serve de produção mantém o domínio.
    allowedHosts: isProdServe ? ['.quivercloud.com.br'] : true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/uploads': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/socket.io': { target: `http://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
