import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { ensureAppShellBranding } from './lib/app-branding';
import { initAppTheme } from './lib/app-theme';
import { initPwaUpdateChecks } from './lib/pwa-updates';
import { queryClient } from './lib/query-client';

initAppTheme();
ensureAppShellBranding();
initPwaUpdateChecks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
