import { NavLink, Outlet } from 'react-router-dom';
import { useQuiosqueContexto } from '../../hooks/useQuiosqueContexto';

const ABAS = [
  { to: '/quiosque', label: 'Vender', end: true, somenteCozinha: false },
  { to: '/quiosque/comandas', label: 'Comandas', end: false, somenteCozinha: false },
  { to: '/quiosque/cozinha', label: 'Cozinha', end: false, somenteCozinha: true },
  { to: '/quiosque/catalogo', label: 'Catálogo', end: false, somenteCozinha: false },
];

/**
 * Abas da secao do quiosque. Ficam dentro da pagina em vez de na navegacao
 * principal para nao inflar a barra da empresa que tambem opera cervejaria.
 */
export function QuiosqueLayout() {
  const { contexto } = useQuiosqueContexto();
  const temCozinha = contexto.ativo && contexto.temCozinha;

  return (
    <div className="space-y-4">
      <nav className="segmented-control" aria-label="Seções do quiosque">
        {ABAS.filter((aba) => !aba.somenteCozinha || temCozinha).map((aba) => (
          <NavLink
            key={aba.to}
            to={aba.to}
            end={aba.end}
            className={({ isActive }) =>
              `segmented-control-btn ${isActive ? 'segmented-control-btn-active' : 'segmented-control-btn-inactive'}`
            }
          >
            {aba.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
