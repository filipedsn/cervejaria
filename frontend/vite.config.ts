import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const isProdServe = process.env.QUIVER_ENV === 'production';
const frontendPort = isProdServe ? 5201 : 5202;
const apiPort = isProdServe ? 3001 : 3002;

export default defineConfig({  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
        theme_color: '#f7f8fa',
        background_color: '#f7f8fa',
        display: 'standalone',
        display_override: ['standalone', 'fullscreen'],
        orientation: 'portrait',
        start_url: '/eventos',
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.method === 'GET' && /\/api\/(produtos|taps|trailers)(\?|$|\/)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'catalog-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 120 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: frontendPort,
    allowedHosts: ['.quivercloud.com.br'],
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/uploads': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/socket.io': { target: `http://127.0.0.1:${apiPort}`, ws: true },
    },
  },});
