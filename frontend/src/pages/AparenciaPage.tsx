import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError, logoAssetUrl } from '../lib/api';
import type { Cervejaria } from '../types';

export function AparenciaPage({ embedded }: { embedded?: boolean } = {}) {
  const { cervejaria, updateCervejaria } = useAuth();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSaved = (updated: Cervejaria) => {
    updateCervejaria(updated);
    setSuccess('Logo atualizada com sucesso.');
    setError('');
    setTimeout(() => setSuccess(''), 3000);
  };

  const logoMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return api.postFormData<Cervejaria>('/api/cervejaria/branding/logo', form);
    },
    onSuccess: (updated) => {
      handleSaved(updated);
      setLogoPreview(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar logo'),
  });

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    logoMutation.mutate(file);
    e.target.value = '';
  };

  const savedLogo = logoAssetUrl(cervejaria);

  return (
    <div className={`space-y-6 ${embedded ? '' : 'max-w-lg mx-auto'}`}>
      {!embedded && (
        <div>
          <h2 className="page-title text-xl sm:text-2xl">Aparência</h2>
          <p className="page-subtitle">
            Logo da cervejaria exibida no cabeçalho do app
          </p>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}
      {success && <div className="alert-success">{success}</div>}

      <div className="card space-y-4">
        <h3 className="font-semibold text-ink">Logomarca</h3>
        <p className="text-sm text-ink-muted">
          A logo aparece no topo do app para identificar sua cervejaria. O visual do app usa a identidade padrão Quiver Tap.
        </p>
        <div className="flex items-center gap-4">
          {(logoPreview || savedLogo) ? (
            <img
              src={logoPreview ?? savedLogo!}
              alt="Logo"
              className="h-20 w-20 rounded-xl object-contain bg-surface-lighter border border-line"
            />
          ) : (
            <div className="h-20 w-20 rounded-xl bg-surface-lighter border border-line flex items-center justify-center text-ink-faint text-xs text-center px-2">
              Sem logo
            </div>
          )}
          <div className="flex-1">
            <label className="touch-btn-secondary touch-btn-sm inline-block cursor-pointer">
              {logoMutation.isPending ? 'Enviando...' : 'Trocar logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={logoMutation.isPending}
                onChange={handleLogoChange}
              />
            </label>
            <p className="text-xs text-ink-faint mt-2">PNG, JPG, WEBP ou GIF · até 5 MB</p>
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-ink">Pré-visualização</h3>
        <div className="rounded-xl border border-line bg-canvas p-4 flex items-center gap-3">
          {(logoPreview || savedLogo) ? (
            <img
              src={logoPreview ?? savedLogo!}
              alt=""
              className="h-8 w-8 rounded-lg object-contain bg-surface border border-line shrink-0"
            />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-sm shrink-0">
              🍺
            </div>
          )}
          <p className="text-base font-bold text-ink truncate">{cervejaria?.nome}</p>
        </div>
        <p className="text-xs text-ink-faint">Assim a logo aparece no cabeçalho do app.</p>
      </div>
    </div>
  );
}
