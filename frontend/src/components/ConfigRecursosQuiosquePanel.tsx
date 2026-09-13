import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useQuiosqueContexto } from '../hooks/useQuiosqueContexto';
import { ToggleAtivo } from './ToggleAtivo';
import {
  mensagemConfirmacaoEstoque,
  QUIOSQUE_CAPACIDADES_INVALIDATION_KEYS,
} from '../lib/quiosque-capacidades';

type CampoCapacidade = 'temCozinha' | 'controlaEstoque';

export function ConfigRecursosQuiosquePanel() {
  const { contexto } = useQuiosqueContexto();
  const queryClient = useQueryClient();
  const [salvando, setSalvando] = useState<CampoCapacidade | null>(null);
  const [erro, setErro] = useState('');
  const [estoqueReativado, setEstoqueReativado] = useState(false);

  if (!contexto.ativo) return null;
  const temCozinha = contexto.temCozinha;
  const controlaEstoque = contexto.controlaEstoque;

  async function invalidarContexto() {
    await Promise.all(
      QUIOSQUE_CAPACIDADES_INVALIDATION_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] }),
      ),
    );
  }

  async function alternarCozinha() {
    setSalvando('temCozinha');
    setErro('');
    setEstoqueReativado(false);
    try {
      await api.patch('/api/quiosque/capacidades', { temCozinha: !temCozinha });
      await invalidarContexto();
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível alterar a cozinha');
    } finally {
      setSalvando(null);
    }
  }

  async function alternarEstoque() {
    const ativar = !controlaEstoque;
    if (!confirm(mensagemConfirmacaoEstoque(ativar))) return;

    setSalvando('controlaEstoque');
    setErro('');
    setEstoqueReativado(false);
    try {
      await api.patch('/api/quiosque/capacidades', {
        controlaEstoque: ativar,
        confirmacaoEstoque: true,
      });
      await invalidarContexto();
      setEstoqueReativado(ativar);
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível alterar o estoque');
    } finally {
      setSalvando(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="recursos-quiosque-title">
      <div>
        <h2 id="recursos-quiosque-title" className="text-base font-bold text-ink">
          Recursos do Quiosque
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Ative somente o que faz parte da operação atual.</p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Controlar estoque</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">Baixa na venda, reposição e perdas.</p>
        </div>
        <ToggleAtivo
          ativo={controlaEstoque}
          loading={salvando !== null}
          onToggle={alternarEstoque}
          labelAtivo="Desativar controle de estoque"
          labelInativo="Ativar controle de estoque"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Tem cozinha</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">Fila de preparo e painel da cozinha.</p>
        </div>
        <ToggleAtivo
          ativo={temCozinha}
          loading={salvando !== null}
          onToggle={alternarCozinha}
          labelAtivo="Desativar cozinha"
          labelInativo="Ativar cozinha"
        />
      </div>

      {erro && <div className="alert-error text-sm">{erro}</div>}
      {estoqueReativado && (
        <div className="alert-success text-sm">
          Controle reativado. Revise os saldos antes da próxima venda.{' '}
          <Link className="font-semibold underline" to="/quiosque/estoque">
            Revisar estoque
          </Link>
        </div>
      )}
    </section>
  );
}
