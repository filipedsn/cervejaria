import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from './FuncionariosPage';
import { CatalogoPage } from './CatalogoPage';
import { TrailersPage } from './TrailersPage';
import { AparenciaPage } from './AparenciaPage';
import { OperacaoPage } from './OperacaoPage';
import { CardapiosPage } from './CardapiosPage';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';

const BASE_TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'trailers', label: 'Trailers' },
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'cardapios', label: 'Cardápios', requiresCardapio: true },
  { id: 'operacao', label: 'Operação' },
  { id: 'aparencia', label: 'Aparência' },
] as const;

type TabId = (typeof BASE_TABS)[number]['id'];

function isValidTab(tab: string | undefined): tab is TabId {
  return BASE_TABS.some((t) => t.id === tab);
}

export function ConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();
  const { cervejaria } = useAuth();
  const usaCardapio = cervejaria?.usaCardapio ?? false;

  const tabs = BASE_TABS.filter((t) => !('requiresCardapio' in t && t.requiresCardapio) || usaCardapio);

  if (!tab) return <Navigate to="/configuracoes/equipe" replace />;
  if (tab === 'carretos') return <Navigate to="/configuracoes/trailers" replace />;
  if (tab === 'clientes') return <Navigate to="/configuracoes/trailers" replace />;
  if (tab === 'cardapios' && !usaCardapio) return <Navigate to="/configuracoes/operacao" replace />;
  if (!isValidTab(tab)) return <Navigate to="/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle="Equipe, trailers, catálogo e aparência" />

      <div className="segmented-control">
        {tabs.map(({ id, label }) => (
          <NavLink
            key={id}
            to={`/configuracoes/${id}`}
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
      {tab === 'catalogo' && <CatalogoPage embedded />}
      {tab === 'cardapios' && <CardapiosPage embedded />}
      {tab === 'operacao' && <OperacaoPage embedded />}
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
