import { NavLink, Outlet } from 'react-router-dom';

const ABAS = [
  { to: '/quiosque', label: 'Vender', end: true },
  { to: '/quiosque/comandas', label: 'Comandas', end: false },
  { to: '/quiosque/catalogo', label: 'Catálogo', end: false },
];

/**
 * Abas da secao do quiosque. Ficam dentro da pagina em vez de na navegacao
 * principal para nao inflar a barra da empresa que tambem opera cervejaria.
 */
export function QuiosqueLayout() {
  return (
    <div className="space-y-4">
      <nav className="segmented-control" aria-label="Seções do quiosque">
        {ABAS.map((aba) => (
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
