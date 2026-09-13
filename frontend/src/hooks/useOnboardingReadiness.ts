import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { onboardingQueryKey, type OnboardingReadiness } from '../lib/onboarding';

export function useOnboardingReadiness() {
  const { cervejaria, usuario, isAuthenticated, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const cervejariaId = cervejaria?.id ?? null;
  const usuarioId = usuario?.id ?? null;
  const queryKey = onboardingQueryKey(cervejariaId, usuarioId);

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<OnboardingReadiness>('/api/onboarding/readiness'),
    enabled: isAuthenticated && !isAdmin && Boolean(cervejariaId && usuarioId),
    staleTime: 30_000,
  });

  return {
    ...query,
    queryKey,
    invalidate: () => queryClient.invalidateQueries({ queryKey }),
  };
}
