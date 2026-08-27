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
        <p className="text-sm text-ink-muted mt-0.5">Permite aplicar desconto ao fechar comandas no quiosque e em eventos.</p>
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
  const inQuiosque = location.pathname.startsWith('/quiosque');
  const [showModal, setShowModal] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    senhaConfirm: '',
    podeDarDescontoQuiosque: false,
  });

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ['funcionarios'],
    queryFn: () => api.get<Usuario[]>('/api/usuarios'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/api/usuarios', {
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        podeDarDescontoQuiosque: form.podeDarDescontoQuiosque,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
      setShowModal(false);
      setForm({ nome: '', email: '', senha: '', senhaConfirm: '', podeDarDescontoQuiosque: false });
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar'),
  });

  const permissoesMutation = useMutation({
    mutationFn: ({ id, podeDarDescontoQuiosque }: { id: string; podeDarDescontoQuiosque: boolean }) =>
      api.patch(`/api/usuarios/${id}/permissoes-quiosque`, { podeDarDescontoQuiosque }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['funcionarios'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar permissão'),
  });

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
          subtitle={inQuiosque ? 'Cadastre atendentes do quiosque' : 'Cadastre atendentes da sua cervejaria'}
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
            {f.papel === 'ATENDENTE' && (
              <PermissaoDescontoRow
                ativo={Boolean(f.podeDarDescontoQuiosque)}
                loading={togglingId === f.id}
                onToggle={(podeDarDescontoQuiosque) =>
                  permissoesMutation.mutate({ id: f.id, podeDarDescontoQuiosque })
                }
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

          <PermissaoDescontoRow
            ativo={form.podeDarDescontoQuiosque}
            onToggle={(podeDarDescontoQuiosque) => setForm({ ...form, podeDarDescontoQuiosque })}
          />

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
