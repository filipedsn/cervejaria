import { Navigate, NavLink, useParams } from 'react-router-dom';
import { FuncionariosPage } from '../FuncionariosPage';
import { AparenciaPage } from '../AparenciaPage';
import { OperacaoPage } from '../OperacaoPage';
import { PageHeader } from '../../components/PageHeader';

const TABS = [
  { id: 'equipe', label: 'Equipe' },
  { id: 'operacao', label: 'Operação' },
  { id: 'aparencia', label: 'Aparência' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function isValidTab(tab: string | undefined): tab is TabId {
  return TABS.some((t) => t.id === tab);
}

export function QuiosqueConfiguracoesPage() {
  const { tab } = useParams<{ tab: string }>();

  if (!tab) return <Navigate to="/quiosque/configuracoes/equipe" replace />;
  if (!isValidTab(tab)) return <Navigate to="/quiosque/configuracoes/equipe" replace />;

  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Configurações" subtitle="Equipe, operação e aparência do quiosque" />

      <div className="segmented-control">
        {TABS.map(({ id, label }) => (
          <NavLink
            key={id}
            to={`/quiosque/configuracoes/${id}`}
            className={({ isActive }) =>
              `segmented-control-btn ${isActive ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>

      {tab === 'equipe' && <FuncionariosPage embedded />}
      {tab === 'operacao' && <OperacaoPage embedded modo="quiosque" />}
      {tab === 'aparencia' && <AparenciaPage embedded />}
    </div>
  );
}
