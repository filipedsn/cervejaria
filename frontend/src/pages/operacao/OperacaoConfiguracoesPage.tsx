import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from '../FuncionariosPage';
import { TrailersPage } from '../TrailersPage';
import { AparenciaPage } from '../AparenciaPage';
import { OperacaoPage } from '../OperacaoPage';
import { PageHeader } from '../../components/PageHeader';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { PdvTapsSection } from '../../components/operacao/PdvTapsSection';
import { AgendaOperacionalPanel } from '../../components/operacao/AgendaOperacionalPanel';
import { PdvPortalQrButton } from '../../components/PdvPortalQrButton';
import { Loading } from '../../components/Loading';
import { useAuth } from '../../contexts/AuthContext';

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

export function OperacaoConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();
  const { contexto, isLoading, isResolved } = useOperacaoContexto();
  const { isDono } = useAuth();
  if (isLoading) return <Loading />;
  if (!isResolved || !['LEGACY', 'CANONICAL_PDV'].includes(contexto.operationalSettingsSource ?? '')) {
    return <div className="alert-error" role="alert">Não foi possível validar o contexto do PDV. Recarregue a página ou procure o suporte.</div>;
  }
  const canonical = contexto.operationalSettingsSource === 'CANONICAL_PDV';
  const tabs = TABS.filter(({ id }) => id !== (canonical ? 'trailers' : 'pdv'));
  const candidate = contexto.pontosVenda.length === 1 ? contexto.pontosVenda[0] : null;
  const pdv = candidate?.ativo && candidate.id?.trim() ? candidate : null;
  if (canonical && tab === 'trailers') return <Navigate to="/operacao/configuracoes/pdv" replace />;
  if (!canonical && tab === 'pdv') return <Navigate to="/operacao/configuracoes/trailers" replace />;

  if (!tab) return <Navigate to="/operacao/configuracoes/equipe" replace />;
  if (!isValidTab(tab)) return <Navigate to="/operacao/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle={canonical ? 'Equipe, PDV, operação e aparência' : 'Equipe, trailers, operação e aparência'} />

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
      {tab === 'pdv' && canonical && (pdv ? <div className="space-y-4">
        <section className="card space-y-3">
          <h2 className="text-lg font-bold">{pdv.nome}</h2>
          <p className="text-sm text-ink-muted">PDV único desta assinatura. O portal e as torneiras pertencem a esta unidade. Evento é um contexto opcional da sessão Por Caixa.</p>
          <PdvPortalQrButton pontoVendaId={pdv.id} />
        </section>
        {isDono && <PdvTapsSection key={pdv.id} pontoVendaId={pdv.id} />}
      </div> : <div className="alert-error" role="alert">O contexto deve conter exatamente um PDV ativo. Procure o suporte para validar a unidade.</div>)}
      {tab === 'operacao' && <OperacaoPage embedded modo="operacao" />}
      {tab === 'operacao' && contexto.operationalSettingsSource === 'CANONICAL_PDV' && <AgendaOperacionalPanel />}
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
