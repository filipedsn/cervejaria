import { Outlet } from 'react-router-dom';

/** Rotas do operacao usam a barra inferior global (Layout), como o modulo cervejaria. */
export function OperacaoLayout() {
  return <Outlet />;
}
