import { useState, type CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError, assetUrl, logoAssetUrl } from '../lib/api';
import type { Cervejaria } from '../types';
import { PortalBackground } from '../components/PortalBackground';

export function AparenciaPage({ embedded }: { embedded?: boolean } = {}) {
  const { cervejaria, updateCervejaria } = useAuth();
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<'celular' | 'tablet'>('celular');
  const [previewLandscape, setPreviewLandscape] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSaved = (updated: Cervejaria, message: string) => {
    updateCervejaria(updated);
    setSuccess(message);
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
      handleSaved(updated, 'Logo atualizada com sucesso.');
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

  const backgroundMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('background', file);
      return api.postFormData<Cervejaria>('/api/cervejaria/branding/portal-background', form);
    },
    onSuccess: (updated) => {
      handleSaved(updated, 'Fundo do portal atualizado com sucesso.');
      setBackgroundPreview(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar imagem de fundo'),
  });

  const removeBackgroundMutation = useMutation({
    mutationFn: () => api.delete<Cervejaria>('/api/cervejaria/branding/portal-background'),
    onSuccess: (updated) => {
      handleSaved(updated, 'Fundo removido. O portal voltou ao padrão.');
      setBackgroundPreview(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover imagem de fundo'),
  });

  const handleBackgroundChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackgroundPreview(URL.createObjectURL(file));
    backgroundMutation.mutate(file);
    e.target.value = '';
  };

  const savedLogo = logoAssetUrl(cervejaria);
  const savedBackground = assetUrl(
    cervejaria?.portalBackgroundUrl,
    cervejaria?.portalBackgroundVersion ?? cervejaria?.updatedAt,
  );
  const previewRatio = previewDevice === 'celular'
    ? (previewLandscape ? 844 / 390 : 390 / 844)
    : (previewLandscape ? 1024 / 768 : 768 / 1024);

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

      <div className="card space-y-4">
        <div>
          <h3 className="font-semibold text-ink">Fundo do portal do cliente</h3>
          <p className="text-sm text-ink-muted mt-1">
            Esta imagem será exibida atrás das telas do portal do cliente desta empresa. Uma camada escura é aplicada para manter os textos legíveis.
          </p>
        </div>
        <p className="text-sm text-ink-muted">
          A imagem será exibida inteira. Espaços restantes usarão a cor de fundo do portal.
        </p>
        <div className="portal-preview-controls flex flex-wrap items-center gap-2" role="group" aria-label="Dispositivo da prévia">
          {(['celular', 'tablet'] as const).map((device) => (
            <button key={device} type="button" className="touch-btn-secondary touch-btn-sm"
              aria-pressed={previewDevice === device} onClick={() => setPreviewDevice(device)}>
              {device === 'celular' ? 'Celular' : 'Tablet'}
            </button>
          ))}
          <button type="button" className="touch-btn-secondary touch-btn-sm"
            aria-pressed={previewLandscape} onClick={() => setPreviewLandscape((value) => !value)}>
            {previewLandscape ? 'Orientação horizontal' : 'Orientação vertical'}
          </button>
        </div>
        <div
          className="portal-preview-frame portal-background-host overflow-hidden rounded-xl border border-line bg-canvas mx-auto"
          aria-label={`Prévia do portal em ${previewDevice}`}
          style={{ '--portal-preview-ratio': previewRatio } as CSSProperties}
        >
          <PortalBackground src={backgroundPreview ?? savedBackground} preview />
          <div className="relative p-3">
            <div className="portal-login-card text-center">
              <p className="font-semibold">{cervejaria?.nome}</p>
              <p className="text-sm text-ink-muted">Abrir comanda</p>
              {!backgroundPreview && !savedBackground && (
                <p className="text-xs text-ink-faint mt-2">Fundo padrão do portal</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="touch-btn-secondary touch-btn-sm inline-block cursor-pointer">
            {backgroundMutation.isPending ? 'Enviando...' : savedBackground ? 'Trocar fundo' : 'Enviar imagem'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={backgroundMutation.isPending || removeBackgroundMutation.isPending}
              onChange={handleBackgroundChange}
            />
          </label>
          {savedBackground && (
            <button
              type="button"
              className="touch-btn-secondary touch-btn-sm"
              disabled={backgroundMutation.isPending || removeBackgroundMutation.isPending}
              onClick={() => removeBackgroundMutation.mutate()}
            >
              {removeBackgroundMutation.isPending ? 'Removendo...' : 'Remover fundo'}
            </button>
          )}
          <p className="text-xs text-ink-faint">PNG, JPG ou WEBP · até 5 MB</p>
        </div>
      </div>
    </div>
  );
}
