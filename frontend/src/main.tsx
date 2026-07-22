import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { ensureAppShellBranding } from './lib/app-branding';
import { initAppTheme } from './lib/app-theme';
import { initPwaUpdateChecks } from './lib/pwa-updates';

initAppTheme();
ensureAppShellBranding();
initPwaUpdateChecks();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 2 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
