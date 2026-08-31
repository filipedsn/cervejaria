/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_SOCKET_URL: string;
  /** Origem pública para links/QR (ex.: http://192.168.1.10:5202 em dev na LAN) */
  readonly VITE_PUBLIC_APP_URL?: string;
  /** SHA injetado no build pelo deploy; nunca e resolvido no browser. */
  readonly VITE_RELEASE_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
