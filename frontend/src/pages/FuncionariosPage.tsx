import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Usuario } from '../types';
import { Modal } from '../components/Modal';
import { ModalFormFooter } from '../components/ModalFormFooter';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { PasswordWithConfirmFields, validatePasswordPair } from '../components/PasswordWithConfirmFields';
import { ToggleAtivo } from '../components/ToggleAtivo';

const TOGGLE_DESCONTO_ATIVO = 'Desativar desconto nas comandas';
const TOGGLE_DESCONTO_INATIVO = 'Ativar desconto nas comandas';

const PERMISSOES_UI = [
  ['cash.open', 'Abrir caixa', 'Inicia um turno de caixa.'],
  ['cash.close', 'Fechar caixa', 'Encerra o turno de caixa.'],
  ['cash.values.read', 'Visualizar valores do caixa', 'Mostra totais, movimentos e resumo financeiro do turno.'],
  ['cash.movement.write', 'Registrar suprimento e sangria', 'Lança entradas e retiradas no caixa.'],
  ['payment.receive', 'Receber pagamentos', 'Registra pagamentos em comandas e vendas.'],
  ['debt.receive', 'Receber dívidas', 'Registra recebimentos de contas pendentes.'],
  ['command.close', 'Fechar comandas', 'Encerra comandas e aplica pagamentos autorizados.'],
  ['discount.apply', 'Aplicar descontos', 'Aplica desconto em comanda e venda avulsa.'],
  ['command.item.cancel', 'Cancelar itens', 'Remove itens e reduz quantidades, inclusive pelo fluxo de cancelamento da cozinha.'],
  ['command.cancel', 'Cancelar comanda inteira', 'Cancela a comanda inteira; concessao individual exige autorizacao explicita.'],
  ['kitchen.cancel', 'Cancelar pedidos da cozinha', 'Solicita cancelamento de pedido; exige também estorno de venda.'],
  ['sale.refund', 'Estornar venda', 'Estorna venda paga junto com o cancelamento do pedido.'],
  ['dashboard.read', 'Visualizar dashboard', 'Acessa os painéis consolidados financeiros.'],
  ['event.dashboard.read', 'Visualizar painel do evento', 'Acessa indicadores e valores do evento.'],
  ['reports.read', 'Visualizar relatórios', 'Acessa relatórios financeiros e exportações CSV.'],
] as const;

function PermissaoDescontoRow({
  ativo,
  loading,
  onToggle,
}: {
  ativo: boolean;
  loading?: boolean;
  onToggle: (ativo: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">Pode dar desconto nas comandas</p>
        <p className="text-sm text-ink-muted mt-0.5">Permite aplicar desconto ao fechar comandas no operacao e em eventos.</p>
      </div>
      <ToggleAtivo
        ativo={ativo}
        loading={loading}
        labelAtivo={TOGGLE_DESCONTO_ATIVO}
        labelInativo={TOGGLE_DESCONTO_INATIVO}
        onToggle={() => onToggle(!ativo)}
      />
    </div>
  );
}

export function FuncionariosPage({ embedded }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const inOperacao = location.pathname.startsWith('/operacao');
  const [showModal, setShowModal] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    senhaConfirm: '',
    permissoesOperacao: [] as string[],
  });

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ['funcionarios'],
    queryFn: () => api.get<Usuario[]>('/api/usuarios'),
  });
  const permissionMode = funcionarios?.some((f) => Array.isArray(f.permissoesOperacao)) ?? false;

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/usuarios', {
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        ...(permissionMode
          ? { permissoesOperacao: form.permissoesOperacao }
          : { podeDarDescontoOperacao: form.permissoesOperacao.includes('discount.apply') }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
      setShowModal(false);
      setForm({ nome: '', email: '', senha: '', senhaConfirm: '', permissoesOperacao: [] });
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar'),
  });

  const permissoesMutation = useMutation({
    mutationFn: ({ id, permissoesOperacao }: { id: string; permissoesOperacao: string[] }) =>
      api.patch(`/api/usuarios/${id}/permissoes-operacao`, permissionMode
        ? { permissoesOperacao }
        : { podeDarDescontoOperacao: permissoesOperacao.includes('discount.apply') }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['funcionarios'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar permissão'),
  });

  const togglePermission = (permissions: string[], permission: string) =>
    permissions.includes(permission)
      ? permissions.filter((item) => item !== permission)
      : [...permissions, permission];

  const renderPermissionSelectors = (permissions: string[], onChange: (permissions: string[]) => void, disabled = false) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSOES_UI.map(([key, label, description]) => (
        <label key={key} className="flex items-start gap-3 rounded-xl border border-line bg-surface-lighter px-3 py-3">
          <input
            type="checkbox"
            checked={permissions.includes(key)}
            disabled={disabled}
            onChange={() => onChange(togglePermission(permissions, key))}
            aria-label={label}
            className="mt-1"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">{label}</span>
            <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
          </span>
        </label>
      ))}
    </div>
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const pwdErr = validatePasswordPair(form.senha, form.senhaConfirm);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    setError('');
    createMutation.mutate();
  };

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          title="Funcionários"
          subtitle={inOperacao ? 'Cadastre atendentes do operacao' : 'Cadastre atendentes da sua cervejaria'}
          action={
            <button type="button" className="touch-btn-primary touch-btn-sm" onClick={() => setShowModal(true)}>
              + Novo Atendente
            </button>
          }
        />
      ) : (
        <div className="flex justify-end">
          <button type="button" className="touch-btn-primary touch-btn-sm" onClick={() => setShowModal(true)}>
            + Novo Atendente
          </button>
        </div>
      )}

      <div className="space-y-3">
        {error && !showModal && <div className="alert-error">{error}</div>}
        {funcionarios?.map((f) => (
          <div key={f.id} className="card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold truncate">{f.nome}</p>
                <p className="text-sm text-ink-muted truncate">{f.email}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                f.papel === 'DONO' ? 'bg-brand-50 text-brand-600' : 'badge-inactive'
              }`}>
                {f.papel === 'DONO' ? 'Proprietário' : 'Atendente'}
              </span>
            </div>
            {f.papel === 'DONO' ? (
              <p className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3 text-sm font-semibold text-brand-700">
                Acesso integral às permissões da empresa.
              </p>
            ) : permissionMode ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">Permissões individuais</p>
                {renderPermissionSelectors(f.permissoesOperacao ?? [], (permissoesOperacao) =>
                  permissoesMutation.mutate({ id: f.id, permissoesOperacao }), togglingId === f.id)}
              </div>
            ) : (
              <PermissaoDescontoRow
                ativo={Boolean(f.podeDarDescontoOperacao)}
                loading={togglingId === f.id}
                onToggle={(ativo) => permissoesMutation.mutate({
                  id: f.id,
                  permissoesOperacao: ativo ? ['discount.apply'] : [],
                })}
              />
            )}
          </div>
        ))}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Novo Atendente">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <div>
            <label className="label">Nome</label>
            <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </div>
          <div>
            <label className="label">E-mail</label>
            <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <PasswordWithConfirmFields
            senha={form.senha}
            confirmar={form.senhaConfirm}
            onSenhaChange={(v) => setForm({ ...form, senha: v })}
            onConfirmarChange={(v) => setForm({ ...form, senhaConfirm: v })}
            senhaLabel="Senha inicial"
            required
          />

          {permissionMode ? renderPermissionSelectors(form.permissoesOperacao, (permissoesOperacao) => setForm({ ...form, permissoesOperacao })) : (
            <PermissaoDescontoRow
              ativo={form.permissoesOperacao.includes('discount.apply')}
              onToggle={(ativo) => setForm({ ...form, permissoesOperacao: ativo ? ['discount.apply'] : [] })}
            />
          )}

          <ModalFormFooter
            onCancel={() => setShowModal(false)}
            submitLabel="Cadastrar"
            pending={createMutation.isPending}
            pendingLabel="Cadastrando..."
          />
        </form>
      </Modal>
    </div>
  );
}
