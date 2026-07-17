import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Usuario } from '../types';
import { Modal } from '../components/Modal';
import { ModalFormFooter } from '../components/ModalFormFooter';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { PasswordWithConfirmFields, validatePasswordPair } from '../components/PasswordWithConfirmFields';

export function FuncionariosPage({ embedded }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ nome: '', email: '', senha: '', senhaConfirm: '' });

  const { data: funcionarios, isLoading } = useQuery({
    queryKey: ['funcionarios'],
    queryFn: () => api.get<Usuario[]>('/api/usuarios'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/usuarios', { nome: form.nome, email: form.email, senha: form.senha }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
      setShowModal(false);
      setForm({ nome: '', email: '', senha: '', senhaConfirm: '' });
      setError('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar'),
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
          subtitle="Cadastre atendentes da sua cervejaria"
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
        {funcionarios?.map((f) => (
          <div key={f.id} className="card flex items-center justify-between">
            <div>
              <p className="font-bold">{f.nome}</p>
              <p className="text-sm text-ink-muted">{f.email}</p>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${
              f.papel === 'DONO' ? 'bg-brand-50 text-brand-600' : 'badge-inactive'
            }`}>
              {f.papel === 'DONO' ? 'Proprietário' : 'Atendente'}
            </span>
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
