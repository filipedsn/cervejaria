import { Outlet } from 'react-router-dom';

/** Rotas do quiosque usam a barra inferior global (Layout), como o modulo cervejaria. */
export function QuiosqueLayout() {
  return <Outlet />;
}
