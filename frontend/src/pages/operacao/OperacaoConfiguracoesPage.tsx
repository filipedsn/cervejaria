import type { ReactNode } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from '../FuncionariosPage';
import { TrailersPage } from '../TrailersPage';
import { AparenciaPage } from '../AparenciaPage';
import { OperacaoPage } from '../OperacaoPage';
import { PageHeader } from '../../components/PageHeader';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { PdvTapsSection } from '../../components/operacao/PdvTapsSection';
import { PdvPortalQrButton } from '../../components/PdvPortalQrButton';
import { Loading } from '../../components/Loading';
import { useAuth } from '../../contexts/AuthContext';
import { OperationalCapabilitiesPanel } from '../../components/OperationalCapabilitiesPanel';
import { ConfigMesasOperacaoPanel } from '../../components/ConfigMesasOperacaoPanel';
import { ConfigKpisComandaPanel } from '../../components/ConfigKpisComandaPanel';
import { ConfigComandasLayoutPanel } from '../../components/ConfigComandasLayoutPanel';
import { CategoriasComandaOrdemPanel } from '../../components/CategoriasComandaOrdemPanel';
import { CategoriasProdutoOrdemPanel } from '../../components/operacao/CategoriasProdutoOrdemPanel';
import { ConfigChavePixPanel } from '../../components/ConfigChavePixPanel';
import { OnboardingManualEntry } from '../../components/OnboardingManualEntry';
import { CozinhaVisualSettingsPanel } from '../../components/operacao/CozinhaVisualSettingsPanel';

const TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'trailers', label: 'Trailers' },
  { id: 'pdv', label: 'PDV' },
  { id: 'operacao', label: 'Operação' },
  { id: 'aparencia', label: 'Aparência' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function isValidTab(tab: string | undefined): tab is TabId {
  return TABS.some((t) => t.id === tab);
}

function ConfigurationGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="overflow-hidden rounded-xl border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{title}</span>
        <span aria-hidden="true" className="text-ink-faint">⌄</span>
      </summary>
      <div className="space-y-4 border-t border-line p-3 sm:p-4">{children}</div>
    </details>
  );
}

export function OperacaoConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();
  const { contexto, isLoading, isResolved } = useOperacaoContexto();
  const { isDono } = useAuth();
  if (isLoading) return <Loading />;
  if (!isResolved || !['LEGACY', 'CANONICAL_PDV'].includes(contexto.operationalSettingsSource ?? '')) {
    return <div className="alert-error" role="alert">Não foi possível validar o contexto do PDV. Recarregue a página ou procure o suporte.</div>;
  }
  const canonical = contexto.operationalSettingsSource === 'CANONICAL_PDV';
  const tabs = TABS.filter(({ id }) => canonical ? id !== 'trailers' && id !== 'operacao' : id !== 'pdv');
  const candidate = contexto.pontosVenda.length === 1 ? contexto.pontosVenda[0] : null;
  const pdv = candidate?.ativo && candidate.id?.trim() ? candidate : null;
  if (canonical && (tab === 'trailers' || tab === 'operacao')) return <Navigate to="/operacao/configuracoes/pdv" replace />;
  if (!canonical && tab === 'pdv') return <Navigate to="/operacao/configuracoes/trailers" replace />;

  if (!tab) return <Navigate to="/operacao/configuracoes/equipe" replace />;
  if (!isValidTab(tab)) return <Navigate to="/operacao/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle={canonical ? 'Equipe, PDV e aparência' : 'Equipe, trailers, operação e aparência'} />

      <div className="segmented-control">
        {tabs.map(({ id, label }) => (
          <NavLink
            key={id}
            to={`/operacao/configuracoes/${id}`}
            className={({ isActive }) =>
              `segmented-control-btn ${isActive ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      {tab === 'equipe' && <FuncionariosPage embedded />}
      {tab === 'trailers' && !canonical && <TrailersPage embedded />}
      {tab === 'pdv' && canonical && (pdv ? <div className="space-y-4" data-testid="canonical-pdv-settings">
        <ConfigurationGroup title="Recursos do PDV">
          <OperationalCapabilitiesPanel section="resources" />
        </ConfigurationGroup>
        <ConfigurationGroup title="Atendimento e comandas">
          <ConfigMesasOperacaoPanel />
          <OperationalCapabilitiesPanel section="attendance" />
        </ConfigurationGroup>
        <ConfigurationGroup title="Tela de comandas">
          <ConfigKpisComandaPanel />
          <ConfigComandasLayoutPanel />
          <CategoriasComandaOrdemPanel />
        </ConfigurationGroup>
        <ConfigurationGroup title="Cozinha">
          <CozinhaVisualSettingsPanel />
        </ConfigurationGroup>
        <ConfigurationGroup title="Catálogo">
          <CategoriasProdutoOrdemPanel />
        </ConfigurationGroup>
        <ConfigurationGroup title="Pagamentos e notificações">
          <ConfigChavePixPanel />
          <OperationalCapabilitiesPanel section="notifications" />
        </ConfigurationGroup>
        <ConfigurationGroup title="Portal do cliente">
          <p className="text-sm text-ink-muted">QR Code e link do portal usam este PDV.</p>
          <PdvPortalQrButton pontoVendaId={pdv.id} />
        </ConfigurationGroup>
        {isDono && contexto.tapsEnabled === true && <ConfigurationGroup title="Torneiras">
          <PdvTapsSection key={pdv.id} pontoVendaId={pdv.id} />
        </ConfigurationGroup>}
        <OnboardingManualEntry />
      </div> : <div className="alert-error" role="alert">O contexto deve conter exatamente um PDV ativo. Procure o suporte para validar a unidade.</div>)}
      {tab === 'operacao' && <OperacaoPage embedded modo="operacao" />}
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
