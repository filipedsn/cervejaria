import { useQuery } from '@tanstack/react-query';
import {
  getBrowserAppOrigin,
  isQrUsingLocalhost,
  resolvePublicAppOrigin,
} from '../lib/public-app-url';

export function usePublicAppOrigin() {
  const browserOrigin = getBrowserAppOrigin();

  const { data: origin = browserOrigin, isLoading } = useQuery({
    queryKey: ['public-app-origin'],
    queryFn: resolvePublicAppOrigin,
    staleTime: 5 * 60 * 1000,
  });

  return {
    origin,
    isLoading,
    isLocalhostQr: isQrUsingLocalhost(origin),
  };
}
