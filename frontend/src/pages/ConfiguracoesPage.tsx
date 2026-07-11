import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from './FuncionariosPage';
import { CatalogoPage } from './CatalogoPage';
import { TrailersPage } from './TrailersPage';
import { AparenciaPage } from './AparenciaPage';
import { CardapiosPage } from './CardapiosPage';
import { PageHeader } from '../components/PageHeader';

const TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'trailers', label: 'Trailers' },
  { id: 'catalogo', label: 'Catálogo' },
  { id: 'cardapios', label: 'Cardápios' },
  { id: 'aparencia', label: 'Aparência' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isValidTab(tab: string | undefined): tab is TabId {
  return TABS.some((t) => t.id === tab);
}

export function ConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();

  if (!tab) return <Navigate to="/configuracoes/equipe" replace />;
  if (tab === 'carretos') return <Navigate to="/configuracoes/trailers" replace />;
  if (!isValidTab(tab)) return <Navigate to="/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle="Equipe, trailers, catálogo, cardápios e aparência" />

      <div className="segmented-control">
        {TABS.map(({ id, label }) => (
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
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
