import { useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Usuario } from '../types';
import { AcessosDialog, PermissoesAgrupadas } from '../components/PermissoesAgrupadas';
import { Loading } from '../components/Loading';
import { PageHeader } from '../components/PageHeader';
import { validatePasswordPair } from '../components/PasswordWithConfirmFields';
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
        <p className="text-sm text-ink-muted mt-0.5">Permite aplicar desconto ao fechar comandas no operacao e em eventos.</p>
      </div>
      <div className="[&_button]:min-h-11">
      <ToggleAtivo
        ativo={ativo}
        loading={loading}
        labelAtivo={TOGGLE_DESCONTO_ATIVO}
        labelInativo={TOGGLE_DESCONTO_INATIVO}
        onToggle={() => onToggle(!ativo)}
      />
      </div>
    </div>
  );
}

export function FuncionariosPage({ embedded }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const inOperacao = location.pathname.startsWith('/operacao');
  const [showModal, setShowModal] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const saving = useRef(false);
  const [editor, setEditor] = useState<{ usuario: Usuario; original: string[]; draft: string[] } | null>(null);
  const [editorError, setEditorError] = useState('');
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
    onSettled: () => { saving.current = false; },
  });

  const permissoesMutation = useMutation({
    mutationFn: ({ id, permissoesOperacao }: { id: string; permissoesOperacao: string[] }) =>
      api.patch<Partial<Usuario>>(`/api/usuarios/${id}/permissoes-operacao`, permissionMode
        ? { permissoesOperacao }
        : { podeDarDescontoOperacao: permissoesOperacao.includes('discount.apply') }),
    onMutate: ({ id }) => setTogglingId(id),
    onSettled: () => { setTogglingId(null); saving.current = false; },
    onSuccess: (confirmed, { id }) => {
      queryClient.setQueryData<Usuario[]>(['funcionarios'], current => current?.map(user => user.id === id ? { ...user, ...confirmed } : user));
      queryClient.invalidateQueries({ queryKey: ['funcionarios'] });
      setEditor(null);
      setEditorError('');
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Erro ao atualizar permissão';
      if (permissionMode) setEditorError(message); else setError(message);
    },
  });

  const discardEditor = () => {
    if (saving.current) return;
    setEditor(null);
    setEditorError('');
  };
  const closeEditor = () => {
    if (saving.current) return;
    const dirty = editor && (editor.draft.length !== editor.original.length || editor.draft.some(key => !editor.original.includes(key)));
    if (!dirty || window.confirm('Descartar as alterações de acessos?')) discardEditor();
  };
  const discardCreate = () => {
    if (saving.current) return;
    setShowModal(false);
    setForm({ nome: '', email: '', senha: '', senhaConfirm: '', permissoesOperacao: [] });
    setError('');
  };
  const closeCreate = () => {
    if (saving.current) return;
    const dirty = form.nome || form.email || form.senha || form.senhaConfirm || form.permissoesOperacao.length;
    if (!dirty || window.confirm('Descartar as alterações do cadastro?')) discardCreate();
  };
  const savePermissions = () => {
    if (!editor || saving.current) return;
    saving.current = true;
    setEditorError('');
    permissoesMutation.mutate({ id: editor.usuario.id, permissoesOperacao: [...editor.draft] });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (saving.current) return;
    const pwdErr = validatePasswordPair(form.senha, form.senhaConfirm);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    setError('');
    saving.current = true;
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
            <button type="button" className="touch-btn-primary" onClick={() => setShowModal(true)}>
              + Novo Atendente
            </button>
          }
        />
      ) : (
        <div className="flex justify-end">
          <button type="button" className="touch-btn-primary" onClick={() => setShowModal(true)}>
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
              <button type="button" className="touch-btn-secondary min-h-12 w-full sm:w-auto"
                aria-label={`Gerenciar acessos de ${f.nome}`}
                onClick={() => { const permissions = [...(f.permissoesOperacao ?? [])]; setEditorError(''); setEditor({ usuario: f, original: permissions, draft: [...permissions] }); }}>
                Gerenciar acessos
              </button>
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

      {editor && <AcessosDialog title="Gerenciar acessos" onClose={closeEditor} footer={
        <>
        {editorError && <div role="alert" className="alert-error mb-3">{editorError}</div>}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="touch-btn-secondary min-h-12" disabled={permissoesMutation.isPending} onClick={discardEditor}>Cancelar</button>
          <button type="button" className="touch-btn-primary min-h-12" disabled={permissoesMutation.isPending} onClick={savePermissions}>{permissoesMutation.isPending ? 'Salvando...' : 'Salvar'}</button>
        </div>
        </>}>
        <div className="mb-4 min-w-0 break-words"><p className="font-bold">{editor.usuario.nome}</p><p className="text-sm text-ink-muted">{editor.usuario.email} · Atendente</p></div>
        <PermissoesAgrupadas permissions={editor.draft} disabled={permissoesMutation.isPending} onChange={draft => setEditor(current => current ? { ...current, draft } : current)} />
      </AcessosDialog>}

      {showModal && <AcessosDialog onClose={closeCreate} title="Novo Atendente" footer={
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="touch-btn-secondary min-h-12" disabled={createMutation.isPending} onClick={discardCreate}>Cancelar</button>
          <button type="submit" form="novo-atendente" className="touch-btn-primary min-h-12" disabled={createMutation.isPending}>{createMutation.isPending ? 'Cadastrando...' : 'Cadastrar'}</button>
        </div>}>

        <form id="novo-atendente" onSubmit={handleSubmit} className="space-y-4">
          {error && <div role="alert" className="alert-error">{error}</div>}

          <div>
            <label className="label" htmlFor="atendente-nome">Nome</label>
            <input id="atendente-nome" className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="atendente-email">E-mail</label>
            <input id="atendente-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="atendente-senha">Senha inicial</label>
            <input id="atendente-senha" type="password" className="input" autoComplete="new-password" minLength={6} required
              value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="atendente-confirmar">Confirmar senha</label>
            <input id="atendente-confirmar" type="password" className="input" autoComplete="new-password" minLength={6} required
              value={form.senhaConfirm} onChange={e => setForm({ ...form, senhaConfirm: e.target.value })} />
          </div>

          {permissionMode ? <PermissoesAgrupadas permissions={form.permissoesOperacao} disabled={createMutation.isPending} onChange={permissoesOperacao => setForm({ ...form, permissoesOperacao })} /> : (
            <PermissaoDescontoRow
              ativo={form.permissoesOperacao.includes('discount.apply')}
              onToggle={(ativo) => setForm({ ...form, permissoesOperacao: ativo ? ['discount.apply'] : [] })}
            />
          )}
        </form>
      </AcessosDialog>}
    </div>
  );
}
