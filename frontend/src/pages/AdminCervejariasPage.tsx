import { useState, useMemo, useEffect, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatCurrency, assetUrl } from '../lib/api';
import { Modal } from '../components/Modal';
import { Loading } from '../components/Loading';
import { ToggleAtivo } from '../components/ToggleAtivo';
import { BrandingEditorFields, BRANDING_DEFAULT_PRIMARY, normalizeTheme } from '../components/BrandingEditorFields';
import { PasswordWithConfirmFields, validatePasswordPair } from '../components/PasswordWithConfirmFields';
import { mensagemConfirmacaoEstoque, modoEmpresa } from '../lib/operacao-capacidades';
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
  operacao: boolean;
  operacaoControlaEstoque: boolean;
  operacaoTemCozinha: boolean;
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
  operacao: false,
  operacaoControlaEstoque: false,
  operacaoTemCozinha: false,
};

const CAPABILITY_OPTIONS = [
  ['cashMode', 'Venda avulsa', 'Vender diretamente no balcÃ£o ou ponto de venda.'],
  ['plannedOperations', 'OperaÃ§Ãµes', 'Trabalhar com operaÃ§Ãµes iniciadas agora ou agendadas.'],
  ['taps', 'Torneiras de chope', 'Usar torneiras de chope nas operaÃ§Ãµes.'],
  ['inventory', 'Controle de estoque', 'Controlar saldo e movimentaÃ§Ã£o dos produtos.'],
  ['kitchen', 'Cozinha / preparo', 'Usar o fluxo de preparo de pedidos.'],
] as const;
type Enablements = { cashMode: boolean; plannedOperations: boolean; taps: boolean; inventory: boolean; kitchen: boolean };
const CAPABILITY_COPY: Record<keyof Enablements, { title: string; description: string }> = {
  cashMode: { title: 'Venda avulsa', description: 'Vender diretamente no balcão ou ponto de venda.' },
  plannedOperations: { title: 'Operações', description: 'Trabalhar com operações iniciadas agora ou agendadas.' },
  taps: { title: 'Torneiras de chope', description: 'Usar torneiras de chope nas operações.' },
  inventory: { title: 'Controle de estoque', description: 'Controlar saldo e movimentação dos produtos.' },
  kitchen: { title: 'Cozinha / preparo', description: 'Usar o fluxo de preparo de pedidos.' },
};
const ENABLEMENTS_PADRAO: Enablements = { cashMode: false, plannedOperations: false, taps: false, inventory: false, kitchen: false };

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
  // Compatibility projection is kept only for the unreachable legacy block below.
  const [modulos, setModulos] = useState({ ...MODULOS_PADRAO });
  const [enablements, setEnablements] = useState<Enablements>({ ...ENABLEMENTS_PADRAO });

  const { data: editingConfiguration } = useQuery({
    queryKey: ['admin-operational-configuration', editing?.id],
    enabled: Boolean(editing?.id),
    queryFn: () => api.get<Record<`${keyof Enablements}Enabled`, boolean>>(`/api/admin/cervejarias/${editing!.id}/configuracao-operacional`),
  });

  useEffect(() => {
    if (!logoFile) return;
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!editingConfiguration) return;
    setEnablements({
      cashMode: editingConfiguration.plannedOperationsEnabled !== true,
      plannedOperations: editingConfiguration.plannedOperationsEnabled,
      taps: editingConfiguration.tapsEnabled,
      inventory: editingConfiguration.inventoryEnabled,
      kitchen: editingConfiguration.kitchenEnabled,
    });
  }, [editingConfiguration]);

  const savedTheme = useMemo(
    () => (editing ? normalizeTheme(editing.corPaleta ?? null, editing.corPrimaria ?? null) : null),
    [editing],
  );

  const resetForm = () => {
    setForm({ cervejariaNome: '', donoNome: '', donoEmail: '', donoSenha: '', donoSenhaConfirm: '' });
    setCorPrimaria(BRANDING_DEFAULT_PRIMARY);
    setLogoFile(null);
    setLogoPreview(null);
    setEnablements({ ...ENABLEMENTS_PADRAO });
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
    const alterouEstoque = editingConfiguration?.inventoryEnabled !== undefined && editingConfiguration.inventoryEnabled !== enablements.inventory;
    const confirmacaoEstoque = alterouEstoque
      ? confirm(mensagemConfirmacaoEstoque(enablements.inventory))
      : false;
    if (alterouEstoque && !confirmacaoEstoque) return;
    updateMutation.mutate({ confirmacaoEstoque });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      return api.post('/api/admin/cervejarias/provision', {
        nome: form.cervejariaNome,
        dono: { nome: form.donoNome, email: form.donoEmail, senha: form.donoSenha },
        enablements,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] });
      setShowModal(false);
      resetForm();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ confirmacaoEstoque }: { confirmacaoEstoque: boolean }) => {
      if (!editing) throw new Error('Nenhuma empresa selecionada');
      const data = new FormData();
      data.append('cervejariaNome', form.cervejariaNome);
      data.append('donoNome', form.donoNome);
      data.append('donoEmail', form.donoEmail);
      if (form.donoSenha) data.append('donoSenha', form.donoSenha);
      if (corPrimaria && /^#[0-9a-fA-F]{6}$/.test(corPrimaria)) data.append('corPrimaria', corPrimaria);
      if (logoFile) data.append('logo', logoFile);
      return Promise.all([
        api.postFormData<CervejariaAdmin>(`/api/admin/cervejarias/${editing.id}`, data, { method: 'PATCH' }),
        api.patch(`/api/admin/cervejarias/${editing.id}/configuracao-operacional`, {
          plannedOperationsEnabled: enablements.plannedOperations,
          tapsEnabled: enablements.taps,
          inventoryEnabled: enablements.inventory,
          kitchenEnabled: enablements.kitchen,
          ...(confirmacaoEstoque ? { confirmacaoEstoque: true } : {}),
        }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-cervejarias'] });
      queryClient.invalidateQueries({ queryKey: ['admin-operational-configuration', editing?.id] });
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
            <label className="label">Capacidades operacionais</label>
            <p className="text-xs text-ink-faint">Escolha somente os recursos que a empresa vai utilizar. Eles não criam trailer, ponto de venda, tap, evento ou produto automaticamente.</p>
            <label className="label">Como este estabelecimento trabalha?</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`card text-left ${enablements.cashMode ? 'ring-2 ring-brand-400' : ''}`} onClick={() => setEnablements((current) => ({ ...current, cashMode: true, plannedOperations: false }))}>Por caixa</button>
              <button type="button" className={`card text-left ${enablements.plannedOperations ? 'ring-2 ring-brand-400' : ''}`} onClick={() => setEnablements((current) => ({ ...current, cashMode: false, plannedOperations: true }))}>Por operações / eventos</button>
            </div>
            <p className="text-xs text-ink-faint">Escolha um único modo. Os recursos abaixo são complementares.</p>
            {CAPABILITY_OPTIONS.filter(([key]) => key !== 'cashMode' && key !== 'plannedOperations').map(([key]) => (
              <ModuloOption key={key} titulo={CAPABILITY_COPY[key].title} descricao={CAPABILITY_COPY[key].description} marcado={enablements[key]} onChange={(value) => setEnablements((current) => ({ ...current, [key]: value }))} />
            ))}
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

          {editing && false && (
            <div className="space-y-2">
              <label className="label">Modo da empresa</label>
              <div className="rounded-xl border border-line bg-surface-lighter px-4 py-3 text-sm font-semibold text-ink">
                {modoEmpresa(editing!.modulos.cervejaria, editing!.modulos.operacao)}
                <span className="ml-2 font-normal text-ink-muted">(somente leitura)</span>
              </div>

              {editing!.modulos.operacao && (
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-semibold text-ink">Recursos do Operacao</p>
                  <ModuloOption
                    titulo="Controlar estoque"
                    descricao="Baixa na venda, reposição e registro de perdas."
                    marcado={modulos.operacaoControlaEstoque}
                    onChange={(v) => setModulos((m) => ({ ...m, operacaoControlaEstoque: v }))}
                  />
                  <ModuloOption
                    titulo="Tem cozinha"
                    descricao="Fila e painel de pedidos em preparo."
                    marcado={modulos.operacaoTemCozinha}
                    onChange={(v) => setModulos((m) => ({ ...m, operacaoTemCozinha: v }))}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="label">Capacidades operacionais</label>
            <p className="text-xs text-ink-faint">Defina os recursos que fazem parte desta operaÃ§Ã£o.</p>
            <label className="label">Como este estabelecimento trabalha?</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`card text-left ${enablements.cashMode ? 'ring-2 ring-brand-400' : ''}`} onClick={() => setEnablements((current) => ({ ...current, cashMode: true, plannedOperations: false }))}>Por caixa</button>
              <button type="button" className={`card text-left ${enablements.plannedOperations ? 'ring-2 ring-brand-400' : ''}`} onClick={() => setEnablements((current) => ({ ...current, cashMode: false, plannedOperations: true }))}>Por operações / eventos</button>
            </div>
            {CAPABILITY_OPTIONS.filter(([key]) => key !== 'cashMode' && key !== 'plannedOperations').map(([key]) => (
              <ModuloOption key={key} titulo={CAPABILITY_COPY[key].title} descricao={CAPABILITY_COPY[key].description} marcado={enablements[key]} onChange={(value) => setEnablements((current) => ({ ...current, [key]: value }))} />
            ))}
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
