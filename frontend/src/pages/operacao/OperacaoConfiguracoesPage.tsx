import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from '../FuncionariosPage';
import { TrailersPage } from '../TrailersPage';
import { AparenciaPage } from '../AparenciaPage';
import { OperacaoPage } from '../OperacaoPage';
import { PageHeader } from '../../components/PageHeader';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';
import { PdvTapsSection } from '../../components/operacao/PdvTapsSection';
import { AgendaOperacionalPanel } from '../../components/operacao/AgendaOperacionalPanel';

const TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'trailers', label: 'Trailers' },
  { id: 'operacao', label: 'Operação' },
  { id: 'aparencia', label: 'Aparência' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function isValidTab(tab: string | undefined): tab is TabId {
  return TABS.some((t) => t.id === tab);
}

export function OperacaoConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();
  const { contexto } = useOperacaoContexto();

  if (!tab) return <Navigate to="/operacao/configuracoes/equipe" replace />;
  if (!isValidTab(tab)) return <Navigate to="/operacao/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle="Equipe, trailers, operação e aparência" />

      <div className="segmented-control">
        {TABS.map(({ id, label }) => (
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
      {tab === 'trailers' && <TrailersPage embedded />}
      {tab === 'operacao' && <OperacaoPage embedded modo="operacao" />}
      {tab === 'operacao' && <AgendaOperacionalPanel />}
      {tab === 'operacao' && contexto.operationalSettingsSource === 'CANONICAL_PDV' && contexto.pontosVenda.length === 1 && <PdvTapsSection pontoVendaId={contexto.pontosVenda[0]!.id} />}
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
