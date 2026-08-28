import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

interface AdminSettings {
  appUrl: string;
  smtp: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    passConfigured: boolean;
  };
  backup: {
    enabled: boolean;
    retentionDays: number;
    scheduleHour: number;
  };
  lastBackupAt: string | null;
  lastBackupFile: string | null;
  lastBackupSize: number | null;
  smtpSource: 'database' | 'env';
}

interface BackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

type Tab = 'geral' | 'smtp' | 'backup';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

export function AdminConfiguracoesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('geral');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testEmail, setTestEmail] = useState('');

  const [appUrl, setAppUrl] = useState('');
  const [smtp, setSmtp] = useState({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
  });
  const [backup, setBackup] = useState({ enabled: true, retentionDays: 14, scheduleHour: 3 });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<AdminSettings>('/api/admin/settings'),
  });

  const { data: backupsData } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: () => api.get<{ files: BackupFile[] }>('/api/admin/settings/backups'),
    enabled: tab === 'backup',
  });

  useEffect(() => {
    if (settings) {
      setAppUrl(settings.appUrl);
      setSmtp({
        enabled: settings.smtp.enabled,
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        user: settings.smtp.user,
        pass: '',
        from: settings.smtp.from,
      });
      setBackup(settings.backup);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<AdminSettings>('/api/admin/settings', {
        appUrl,
        smtp: {
          ...smtp,
          pass: smtp.pass || undefined,
        },
        backup,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] });
      setSmtp((s) => ({ ...s, pass: '' }));
      setMessage('Configurações salvas com sucesso.');
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar');
      setMessage('');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => api.post<{ message: string }>('/api/admin/settings/smtp/test', { email: testEmail }),
    onSuccess: (data: { message: string }) => {
      setMessage(data.message);
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Falha no teste SMTP');
      setMessage('');
    },
  });

  const backupMutation = useMutation({
    mutationFn: () => api.post<{ message: string; file: BackupFile }>('/api/admin/settings/backups/run'),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] });
      setMessage(`${data.message}: ${data.file.filename} (${formatBytes(data.file.size)})`);
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Erro ao executar backup');
      setMessage('');
    },
  });

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'geral', label: 'Geral', icon: '⚙️' },
    { id: 'smtp', label: 'E-mail (SMTP)', icon: '📧' },
    { id: 'backup', label: 'Backup', icon: '💾' },
  ];

  if (isLoading) {
    return <div className="text-ink-muted">Carregando configurações...</div>;
  }

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl lg:text-3xl font-bold">Configurações</h2>
        <p className="text-ink-muted mt-1">SMTP, backup da base de dados e parâmetros do sistema</p>
      </div>

      {message && <div className="alert-success">{message}</div>}
      {error && <div className="alert-error">{error}</div>}

      <div className="segmented-control">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`segmented-control-btn ${tab === t.id ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-lg">Aplicação</h3>
          <div>
            <label className="label">URL pública do frontend (APP_URL)</label>
            <input
              className="input"
              value={appUrl}
              onChange={(e) => setAppUrl(e.target.value)}
              placeholder="http://localhost:5201"
            />
            <p className="text-xs text-ink-faint mt-1">
              Usada nos links de recuperação de senha enviados por e-mail.
            </p>
          </div>
        </div>
      )}

      {tab === 'smtp' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-lg">Servidor SMTP</h3>
            {settings?.smtpSource === 'env' && (
              <span className="badge-inactive">Usando .env (salve aqui para migrar)</span>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={smtp.enabled}
              onChange={(e) => setSmtp({ ...smtp, enabled: e.target.checked })}
              className="w-5 h-5 rounded accent-brand-400"
            />
            <span className="text-sm">Habilitar envio de e-mails via SMTP</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Host</label>
              <input className="input" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.seudominio.com.br" />
            </div>
            <div>
              <label className="label">Porta</label>
              <input type="number" className="input" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer pb-3">
                <input
                  type="checkbox"
                  checked={smtp.secure}
                  onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })}
                  className="w-5 h-5 rounded accent-brand-400"
                />
                <span className="text-sm">SSL/TLS (porta 465)</span>
              </label>
            </div>
            <div>
              <label className="label">Usuário</label>
              <input className="input" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />
            </div>
            <div>
              <label className="label">Senha</label>
              <input
                type="password"
                className="input"
                value={smtp.pass}
                onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
                placeholder={settings?.smtp.passConfigured ? '•••••••• (deixe vazio para manter)' : ''}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Remetente (From)</label>
              <input className="input" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="Cervejaria Movel <noreply@seudominio.com.br>" />
            </div>
          </div>

          <div className="pt-4 border-t border-line space-y-3">
            <p className="text-sm text-ink-muted">Enviar e-mail de teste</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                className="input flex-1"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="seu@email.com"
              />
              <button
                type="button"
                className="touch-btn-secondary shrink-0"
                disabled={testMutation.isPending || !testEmail}
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? 'Enviando...' : 'Testar SMTP'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <h3 className="font-semibold text-lg">Backup da base de dados</h3>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={backup.enabled}
                onChange={(e) => setBackup({ ...backup, enabled: e.target.checked })}
                className="w-5 h-5 rounded accent-brand-400"
              />
              <span className="text-sm">Backups habilitados</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Retenção (dias)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="input"
                  value={backup.retentionDays}
                  onChange={(e) => setBackup({ ...backup, retentionDays: Number(e.target.value) })}
                />
                <p className="text-xs text-ink-faint mt-1">Backups mais antigos são removidos automaticamente.</p>
              </div>
              <div>
                <label className="label">Horário agendado (0–23h)</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  className="input"
                  value={backup.scheduleHour}
                  onChange={(e) => setBackup({ ...backup, scheduleHour: Number(e.target.value) })}
                />
                <p className="text-xs text-ink-faint mt-1">Referência para agendamento futuro (cron).</p>
              </div>
            </div>

            <div className="rounded-xl bg-surface-lighter p-4 text-sm space-y-1">
              <p><span className="text-ink-faint">Último backup:</span> {formatDateTime(settings?.lastBackupAt ?? null)}</p>
              {settings?.lastBackupFile && (
                <p><span className="text-ink-faint">Arquivo:</span> {settings.lastBackupFile} ({formatBytes(settings.lastBackupSize ?? 0)})</p>
              )}
            </div>

            <button
              type="button"
              className="touch-btn-primary w-full sm:w-auto"
              disabled={backupMutation.isPending}
              onClick={() => backupMutation.mutate()}
            >
              {backupMutation.isPending ? 'Executando backup...' : 'Executar backup agora'}
            </button>
          </div>

          {backupsData?.files && backupsData.files.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-line font-semibold">Arquivos disponíveis</div>
              <ul className="divide-y divide-line">
                {backupsData.files.map((f) => (
                  <li key={f.filename} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{f.filename}</p>
                      <p className="text-ink-faint text-xs">{formatDateTime(f.createdAt)} · {formatBytes(f.size)}</p>
                    </div>
                    <a
                      href={`/api/admin/settings/backups/${encodeURIComponent(f.filename)}`}
                      className="touch-btn-secondary touch-btn-sm shrink-0"
                      download
                    >
                      Baixar
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="touch-btn-primary w-full sm:w-auto min-w-[200px]"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        {saveMutation.isPending ? 'Salvando...' : 'Salvar configurações'}
      </button>
    </div>
  );
}
