import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency, assetUrl } from '../lib/api';
import { Modal } from '../components/Modal';
import { Loading } from '../components/Loading';
import { ToggleAtivo } from '../components/ToggleAtivo';
import { BrandingEditorFields, BRANDING_DEFAULT_PRIMARY, normalizeTheme } from '../components/BrandingEditorFields';
import { PasswordWithConfirmFields, validatePasswordPair } from '../components/PasswordWithConfirmFields';
import type { BrandTheme } from '../types';

interface MesAtualStats {
  mes: string;
  faturamento: number;
  comandasAtendidas: number;
  tiposProduto: number;
  produtoMaisVende: string | null;
}

interface ModulosAdmin {
  cervejaria: boolean;
  quiosque: boolean;
  quiosqueControlaEstoque: boolean;
  quiosqueTemCozinha: boolean;
}

interface CervejariaAdmin {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  logoUrl?: string | null;
  corPrimaria?: string | null;
  corSecundaria?: string | null;
  corPaleta?: BrandTheme | null;
  modulos: ModulosAdmin;
  mesAtual: MesAtualStats;
  _count: { usuarios: number; eventos: number };
  usuarios: Array<{ id: string; nome: string; email: string }>;
}

function ModulosBadges({ modulos }: { modulos: ModulosAdmin }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {modulos.cervejaria && (
        <span className="rounded-full bg-brand-400/15 px-2 py-0.5 text-[10px] font-semibold text-brand-600">
          Cervejaria
        </span>
      )}
      {modulos.quiosque && (
        <span className="rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-semibold text-orange">
          Quiosque
        </span>
      )}
      {modulos.quiosque && modulos.quiosqueTemCozinha && (
        <span className="rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] font-medium text-ink-faint">
          Cozinha
        </span>
      )}
      {modulos.quiosque && modulos.quiosqueControlaEstoque && (
        <span className="rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] font-medium text-ink-faint">
          Estoque
        </span>
      )}
    </div>
  );
}

function CervejariaLogo({ nome, logoUrl }: { nome: string; logoUrl?: string | null }) {
  const src = assetUrl(logoUrl);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        data-brewery-branding
        className="h-10 w-10 rounded-xl object-contain bg-surface-lighter shrink-0"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="h-10 w-10 rounded-xl bg-brand-400/15 border border-brand-400/20 flex items-center justify-center text-sm shrink-0"
      title={nome}
    >
      🍺
    </div>
  );
}

function MesAtualResumo({ stats }: { stats: MesAtualStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-line text-sm">
      <div>
        <p className="text-ink-faint text-xs">Faturamento</p>
        <p className="font-semibold text-brand-600">{formatCurrency(stats.faturamento)}</p>
      </div>
      <div>
        <p className="text-ink-faint text-xs">Comandas</p>
        <p className="font-semibold">{stats.comandasAtendidas}</p>
      </div>
      <div>
        <p className="text-ink-faint text-xs">Tipos de produto</p>
        <p className="font-semibold">{stats.tiposProduto}</p>
      </div>
      <div>
        <p className="text-ink-faint text-xs">Mais vendido</p>
        <p className="font-semibold truncate">{stats.produtoMaisVende ?? '—'}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-card flex-1 min-w-[140px] !items-start !text-left">
      <p className="text-xs text-ink-faint uppercase tracking-wide">{label}</p>
      <p className="metric-value mt-1">{value}</p>
    </div>
  );
}

function ModuloOption({
  titulo,
  descricao,
  marcado,
  onChange,
}: {
  titulo: string;
  descricao: string;
  marcado: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="card flex cursor-pointer items-start gap-3 py-3">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-brand-400"
        checked={marcado}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-semibold">{titulo}</span>
        <span className="block text-xs text-ink-faint">{descricao}</span>
      </span>
    </label>
  );
}

const MODULOS_PADRAO = {
  cervejaria: true,
  quiosque: false,
  quiosqueControlaEstoque: false,
  quiosqueTemCozinha: false,
};

export function AdminCervejariasPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CervejariaAdmin | null>(null);
  const [error, setError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    cervejariaNome: '',
    donoNome: '',
    donoEmail: '',
    donoSenha: '',
    donoSenhaConfirm: '',
  });
  const [corPrimaria, setCorPrimaria] = useState(BRANDING_DEFAULT_PRIMARY);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [modulos, setModulos] = useState({ ...MODULOS_PADRAO });

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const savedTheme = useMemo(
    () => (editing ? normalizeTheme(editing.corPaleta ?? null, editing.corPrimaria ?? null) : null),
    [editing],
  );

  const resetForm = () => {
    setForm({ cervejariaNome: '', donoNome: '', donoEmail: '', donoSenha: '', donoSenhaConfirm: '' });
    setCorPrimaria(BRANDING_DEFAULT_PRIMARY);
    setLogoFile(null);
    setLogoPreview(null);
    setModulos({ ...MODULOS_PADRAO });
    setError('');
  };

  const openEdit = (c: CervejariaAdmin) => {
    setEditing(c);
    setForm({
      cervejariaNome: c.nome,
      donoNome: c.usuarios[0]?.nome ?? '',
      donoEmail: c.usuarios[0]?.email ?? '',
      donoSenha: '',
      donoSenhaConfirm: '',
    });
    setCorPrimaria(c.corPrimaria ?? BRANDING_DEFAULT_PRIMARY);
    setLogoFile(null);
    setLogoPreview(null);
    setError('');
  };

  const closeEdit = () => {
    setEditing(null);
    resetForm();
  };

  const { data: cervejarias, isLoading } = useQuery({
    queryKey: ['admin-cervejarias'],
    queryFn: () => api.get<CervejariaAdmin[]>('/api/admin/cervejarias'),
  });

  const stats = useMemo(() => {
    if (!cervejarias) return { total: 0, ativas: 0, usuarios: 0, eventos: 0, faturamentoMes: 0, comandasMes: 0, mes: '' };
    return {
      total: cervejarias.length,
      ativas: cervejarias.filter((c) => c.ativo).length,
      usuarios: cervejarias.reduce((s, c) => s + c._count.usuarios, 0),
      eventos: cervejarias.reduce((s, c) => s + c._count.eventos, 0),
      faturamentoMes: cervejarias.reduce((s, c) => s + c.mesAtual.faturamento, 0),
      comandasMes: cervejarias.reduce((s, c) => s + c.mesAtual.comandasAtendidas, 0),
      mes: cervejarias[0]?.mesAtual.mes ?? '',
    };
  }, [cervejarias]);

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    const pwdErr = validatePasswordPair(form.donoSenha, form.donoSenhaConfirm);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    if (!modulos.cervejaria && !modulos.quiosque) {
      setError('Selecione ao menos um módulo para a empresa');
      return;
    }
    setError('');
    createMutation.mutate();
  };

  const handleUpdate = (e: FormEvent) => {
    e.preventDefault();
    const pwdErr = validatePasswordPair(form.donoSenha, form.donoSenhaConfirm, { optional: true });
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    setError('');
    updateMutation.mutate();
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const data = new FormData();
      data.append('cervejariaNome', form.cervejariaNome);
      data.append('donoNome', form.donoNome);
      data.append('donoEmail', form.donoEmail);
      data.append('donoSenha', form.donoSenha);
      data.append('moduloCervejaria', String(modulos.cervejaria));
      data.append('moduloQuiosque', String(modulos.quiosque));
      if (modulos.quiosque) {
        data.append('quiosqueControlaEstoque', String(modulos.quiosqueControlaEstoque));
        data.append('quiosqueTemCozinha', String(modulos.quiosqueTemCozinha));
      }
      if (logoFile) data.append('logo', logoFile);
      return api.postFormData('/api/admin/cervejarias', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] });
      setShowModal(false);
      resetForm();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar'),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Nenhuma empresa selecionada');
      const data = new FormData();
      data.append('cervejariaNome', form.cervejariaNome);
      data.append('donoNome', form.donoNome);
      data.append('donoEmail', form.donoEmail);
      if (form.donoSenha) data.append('donoSenha', form.donoSenha);
      if (corPrimaria && /^#[0-9a-fA-F]{6}$/.test(corPrimaria)) data.append('corPrimaria', corPrimaria);
      if (logoFile) data.append('logo', logoFile);
      return api.postFormData<CervejariaAdmin>(`/api/admin/cervejarias/${editing.id}`, data, { method: 'PATCH' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] });
      closeEdit();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar'),
  });

  const reextractMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Nenhuma empresa selecionada');
      return api.post<CervejariaAdmin>(`/api/admin/cervejarias/${editing.id}/branding/reextract`);
    },
    onSuccess: (updated) => {
      setEditing(updated);
      setCorPrimaria(updated.corPrimaria ?? BRANDING_DEFAULT_PRIMARY);
      queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao reanalisar logo'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      api.patch<CervejariaAdmin>(`/api/admin/cervejarias/${id}/ativo`, { ativo }),
    onMutate: ({ id }) => setTogglingId(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] }),
    onSettled: () => setTogglingId(null),
  });

  const handleToggle = (c: CervejariaAdmin) => {
    const msg = c.ativo
      ? `Desativar "${c.nome}"? Dono e atendentes não poderão mais fazer login.`
      : `Reativar "${c.nome}"? Usuários vinculados poderão fazer login novamente.`;
    if (confirm(msg)) {
      toggleMutation.mutate({ id: c.id, ativo: !c.ativo });
    }
  };

  if (isLoading) return <Loading />;

  return (
    <div className="w-full space-y-6 lg:space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold">Empresas</h2>
          <p className="text-ink-muted mt-1">
            Gerencie todas as empresas cadastradas no sistema
            {stats.mes && <span className="text-ink-faint"> · Métricas de {stats.mes}</span>}
          </p>
        </div>
        <button className="touch-btn-primary min-h-12 px-8 shrink-0 self-start lg:self-auto" onClick={() => setShowModal(true)}>
          + Nova Empresa
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Ativas" value={stats.ativas} />
        <StatCard label={`Faturamento ${stats.mes}`} value={formatCurrency(stats.faturamentoMes)} />
        <StatCard label={`Comandas ${stats.mes}`} value={stats.comandasMes} />
      </div>

      {cervejarias && cervejarias.length > 0 && (
        <div className="hidden lg:block card p-0 overflow-x-auto">
          <table className="w-full text-left min-w-[1100px]">
            <thead>
              <tr className="border-b border-line text-xs text-ink-faint uppercase tracking-wide">
                <th className="px-4 py-4 font-medium w-16"><span className="sr-only">Logo</span></th>
                <th className="px-4 py-4 font-medium">Empresa</th>
                <th className="px-4 py-4 font-medium">Proprietário</th>
                <th className="px-4 py-4 font-medium text-right">Faturamento</th>
                <th className="px-4 py-4 font-medium text-center">Comandas</th>
                <th className="px-4 py-4 font-medium text-center">Produtos</th>
                <th className="px-4 py-4 font-medium">Mais vendido</th>
                <th className="px-4 py-4 font-medium text-center">Status</th>
                <th className="px-4 py-4 font-medium text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {cervejarias.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b border-line last:border-0 hover:bg-surface-lighter ${
                    !c.ativo ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-4">
                    <CervejariaLogo nome={c.nome} logoUrl={c.logoUrl} />
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-semibold">{c.nome}</p>
                    <ModulosBadges modulos={c.modulos} />
                    {!c.ativo && (
                      <span className="text-xs text-danger">Inativa</span>
                    )}
                    <p className="text-xs text-ink-faint mt-0.5 truncate max-w-[180px]">{c.usuarios[0]?.email}</p>
                  </td>
                  <td className="px-4 py-4 text-ink-soft">{c.usuarios[0]?.nome ?? '—'}</td>
                  <td className="px-4 py-4 text-right font-semibold text-brand-600">
                    {formatCurrency(c.mesAtual.faturamento)}
                  </td>
                  <td className="px-4 py-4 text-center">{c.mesAtual.comandasAtendidas}</td>
                  <td className="px-4 py-4 text-center">{c.mesAtual.tiposProduto}</td>
                  <td className="px-4 py-4 text-ink-soft max-w-[160px] truncate">
                    {c.mesAtual.produtoMaisVende ?? '—'}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <ToggleAtivo
                        ativo={c.ativo}
                        loading={togglingId === c.id}
                        labelAtivo="Desativar empresa"
                        labelInativo="Ativar empresa"
                        onToggle={() => handleToggle(c)}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <button
                      type="button"
                      className="touch-btn-secondary touch-btn-sm"
                      onClick={() => openEdit(c)}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:hidden">
        {cervejarias?.map((c) => (
          <div key={c.id} className={`card ${!c.ativo ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <CervejariaLogo nome={c.nome} logoUrl={c.logoUrl} />
                <h3 className="text-lg font-bold min-w-0">
                  {c.nome}
                  {!c.ativo && <span className="text-xs text-danger ml-2">(inativa)</span>}
                </h3>
              </div>
              <ToggleAtivo
                ativo={c.ativo}
                loading={togglingId === c.id}
                labelAtivo="Desativar empresa"
                labelInativo="Ativar empresa"
                onToggle={() => handleToggle(c)}
              />
            </div>
            <div className="mt-2">
              <ModulosBadges modulos={c.modulos} />
            </div>
            {c.usuarios[0] && (
              <>
                <p className="text-sm text-ink-muted mt-2">{c.usuarios[0].nome}</p>
                <p className="text-sm text-ink-faint truncate">{c.usuarios[0].email}</p>
              </>
            )}
            <p className="text-xs text-ink-faint mt-2">Mês: {c.mesAtual.mes}</p>
            <MesAtualResumo stats={c.mesAtual} />
            <div className="flex gap-3 mt-3 pt-3 border-t border-line">
              <span className={`text-xs px-2 py-1 rounded-lg ${c.ativo ? 'badge-live' : 'badge-inactive'}`}>
                {c.ativo ? 'Ativa' : 'Inativa'}
              </span>
              <button type="button" className="touch-btn-secondary touch-btn-sm ml-auto" onClick={() => openEdit(c)}>
                Editar
              </button>
            </div>
          </div>
        ))}
      </div>

      {cervejarias?.length === 0 && (
        <div className="card text-center py-20">
          <p className="text-5xl mb-4">🏭</p>
          <p className="text-xl text-ink-muted">Nenhuma empresa cadastrada</p>
          <p className="text-ink-faint mt-2 mb-6">Comece cadastrando a primeira empresa do sistema</p>
          <button className="touch-btn-primary inline-block px-10" onClick={() => setShowModal(true)}>
            Cadastrar empresa
          </button>
        </div>
      )}

      <Modal open={showModal} onClose={() => { setShowModal(false); resetForm(); }} title="Cadastrar Empresa">
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nome da empresa</label>
              <input className="input" value={form.cervejariaNome} onChange={(e) => setForm({ ...form, cervejariaNome: e.target.value })} required />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Logomarca</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="input file:mr-4 file:rounded-lg file:border-0 file:bg-brand-400 file:px-4 file:py-2 file:text-surface file:font-semibold"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-ink-faint mt-1">
                As cores da logo serão extraídas automaticamente para personalizar o app desta empresa.
              </p>
              {logoPreview && (
                <div className="mt-3 flex items-center gap-3">
                  <img src={logoPreview} alt="Prévia da logo" className="h-16 w-16 rounded-xl object-contain bg-surface-lighter" />
                  <button
                    type="button"
                    className="text-sm text-ink-muted hover:text-ink"
                    onClick={() => setLogoFile(null)}
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="label">Nome do proprietário</label>
              <input className="input" value={form.donoNome} onChange={(e) => setForm({ ...form, donoNome: e.target.value })} required />
            </div>
            <div>
              <label className="label">E-mail do proprietário</label>
              <input type="email" className="input" value={form.donoEmail} onChange={(e) => setForm({ ...form, donoEmail: e.target.value })} required />
            </div>
            <div className="sm:col-span-2">
              <PasswordWithConfirmFields
                senha={form.donoSenha}
                confirmar={form.donoSenhaConfirm}
                onSenhaChange={(v) => setForm({ ...form, donoSenha: v })}
                onConfirmarChange={(v) => setForm({ ...form, donoSenhaConfirm: v })}
                senhaLabel="Senha inicial"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="label">Módulos da empresa</label>
            <p className="text-xs text-ink-faint">
              Define quais operações a empresa enxerga. Pode ativar os dois.
            </p>

            <ModuloOption
              titulo="Cervejaria"
              descricao="Eventos, chope por tap, ranking e portal do cliente."
              marcado={modulos.cervejaria}
              onChange={(v) => setModulos((m) => ({ ...m, cervejaria: v }))}
            />

            <ModuloOption
              titulo="Quiosque"
              descricao="Venda rápida, comanda por apelido e fechamento de caixa diário."
              marcado={modulos.quiosque}
              onChange={(v) => setModulos((m) => ({ ...m, quiosque: v }))}
            />

            {modulos.quiosque && (
              <div className="ml-4 space-y-2 border-l-2 border-surface-lighter pl-4">
                <ModuloOption
                  titulo="Controlar estoque"
                  descricao="Baixa na venda, reposição e registro de perdas."
                  marcado={modulos.quiosqueControlaEstoque}
                  onChange={(v) => setModulos((m) => ({ ...m, quiosqueControlaEstoque: v }))}
                />
                <ModuloOption
                  titulo="Tem cozinha"
                  descricao="Tela de pedidos em preparo, na ordem de chegada."
                  marcado={modulos.quiosqueTemCozinha}
                  onChange={(v) => setModulos((m) => ({ ...m, quiosqueTemCozinha: v }))}
                />
              </div>
            )}
          </div>

          <button type="submit" className="touch-btn-primary w-full" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Cadastrando...' : 'Cadastrar'}
          </button>
        </form>
      </Modal>

      <Modal open={!!editing} onClose={closeEdit} title={`Editar — ${editing?.nome ?? ''}`}>
        <form onSubmit={handleUpdate} className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Nome da empresa</label>
              <input className="input" value={form.cervejariaNome} onChange={(e) => setForm({ ...form, cervejariaNome: e.target.value })} required />
            </div>
            <div>
              <label className="label">Nome do proprietário</label>
              <input className="input" value={form.donoNome} onChange={(e) => setForm({ ...form, donoNome: e.target.value })} required />
            </div>
            <div>
              <label className="label">E-mail do proprietário</label>
              <input type="email" className="input" value={form.donoEmail} onChange={(e) => setForm({ ...form, donoEmail: e.target.value })} required />
            </div>
            <div className="sm:col-span-2">
              <PasswordWithConfirmFields
                senha={form.donoSenha}
                confirmar={form.donoSenhaConfirm}
                onSenhaChange={(v) => setForm({ ...form, donoSenha: v })}
                onConfirmarChange={(v) => setForm({ ...form, donoSenhaConfirm: v })}
                senhaLabel="Nova senha do proprietário (opcional)"
                required={false}
              />
            </div>
          </div>

          <BrandingEditorFields
            currentLogoUrl={editing?.logoUrl}
            newLogoPreview={logoPreview}
            onLogoSelect={(file) => {
              setLogoFile(file);
              if (!file) setLogoPreview(null);
            }}
            corPrimaria={corPrimaria}
            onCorPrimariaChange={setCorPrimaria}
            savedTheme={savedTheme}
            onReextract={editing?.logoUrl ? () => reextractMutation.mutate() : undefined}
            reextractPending={reextractMutation.isPending}
            disabled={updateMutation.isPending}
            logoLabel={logoFile ? 'Trocar imagem selecionada' : 'Enviar nova logo'}
          />

          <button type="submit" className="touch-btn-primary w-full" disabled={updateMutation.isPending || reextractMutation.isPending}>
            {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
