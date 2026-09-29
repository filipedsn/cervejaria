import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 2 },
  },
});

/** Prevent cached tenant data from crossing an authentication boundary. */
export function clearSessionQueryCache() {
  queryClient.clear();
}
