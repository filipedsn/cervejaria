import { createBrowserRouter, RouterProvider, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { EventoProvider, useEvento } from './contexts/EventoContext';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { AdminCervejariasPage } from './pages/AdminCervejariasPage';
import { AdminConfiguracoesPage } from './pages/AdminConfiguracoesPage';
import { SelecionarTrailerPage } from './pages/SelecionarTrailerPage';
import { EventoPage } from './pages/EventoPage';
import { ComandasPage } from './pages/ComandasPage';
import { ComandaDetailPage } from './pages/ComandaDetailPage';
import { NovaComandaPage } from './pages/NovaComandaPage';
import { VendaAvulsaPage } from './pages/VendaAvulsaPage';
import { RankingPage } from './pages/RankingPage';
import { RankingPeriodoPage } from './pages/RankingPeriodoPage';
import { RankingSeriePage } from './pages/RankingSeriePage';
import { RankingFullscreenPage } from './pages/RankingFullscreenPage';
import { RankingSerieFullscreenPage } from './pages/RankingSerieFullscreenPage';
import { RankingPeriodoFullscreenPage } from './pages/RankingPeriodoFullscreenPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResumoExecutivoPage } from './pages/ResumoExecutivoPage';
import { ConfiguracoesPage } from './pages/ConfiguracoesPage';
import { ClientesPage } from './pages/ClientesPage';
import { ClienteDetailPage } from './pages/ClienteDetailPage';
import { CadastroLinkDescontinuadoPage } from './pages/CadastroLinkDescontinuadoPage';
import { PortalClientePage } from './pages/PortalClientePage';
import { Layout } from './components/Layout';
import { AdminLayout } from './components/AdminLayout';
import { InstallAppBanner } from './components/InstallAppBanner';
import { Loading } from './components/Loading';
import { ensureAppShellBranding } from './lib/app-branding';
import { resetBreweryTheme } from './lib/theme';
import { AuditTracker } from './components/AuditTracker';

function RootLayout() {
  const { pathname } = useLocation();
  const hideInstallBanner =
    pathname.startsWith('/ranking/tv') ||
    pathname.startsWith('/c/');

  return (
    <>
      {!hideInstallBanner && <InstallAppBanner />}
      <AuditTracker />
      <Outlet />
    </>
  );
}

function PublicAuthShell() {
  useEffect(() => {
    resetBreweryTheme();
    ensureAppShellBranding();

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? '#f7f8fa';
    themeMeta?.setAttribute('content', '#004c4c');
    document.body.classList.add('auth-screen');

    return () => {
      themeMeta?.setAttribute('content', prevTheme);
      document.body.classList.remove('auth-screen');
    };
  }, []);

  return <Outlet />;
}

function TenantEntryRedirect() {
  const { needsTrailerSelection, evento, isLoading } = useEvento();
  if (isLoading) return <Loading fullScreen />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
  if (evento?.status === 'ABERTO') return <Navigate to="/comandas" replace />;
  return <Navigate to="/eventos" replace />;
}

function PublicOnly() {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (isAuthenticated) return <Navigate to={isAdmin ? '/admin/cervejarias' : '/'} replace />;
  return <Outlet />;
}

function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireAdmin() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAdmin) return <Navigate to="/eventos" replace />;
  return <Outlet />;
}

function RequireTenant() {
  const { isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;
  return <Outlet />;
}

function RequireDono() {
  const { isDono, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isDono) return <Navigate to="/comandas" replace />;
  return <Outlet />;
}

function RequireTrailerContext() {
  const { needsTrailerSelection, isLoading } = useEvento();
  if (isLoading) return <Loading fullScreen />;
  if (needsTrailerSelection) return <Navigate to="/trailer" replace />;
  return <Outlet />;
}

function TenantShell() {
  return (
    <EventoProvider>
      <Layout />
    </EventoProvider>
  );
}

function CatchAll() {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? '/admin/cervejarias' : '/'} replace />;
}

function RankingTvShell({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const demoCount = Number.parseInt(searchParams.get('demo') ?? '', 10);
  const isDemo = Number.isFinite(demoCount) && demoCount > 0;

  if (isDemo) {
    return <div className="qt-tv">{children}</div>;
  }

  if (isLoading) return <Loading fullScreen />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to="/admin/cervejarias" replace />;

  return (
    <div className="qt-tv">
      <EventoProvider>{children}</EventoProvider>
    </div>
  );
}

function RankingTvEntry() {
  return (
    <RankingTvShell>
      <RankingFullscreenPage />
    </RankingTvShell>
  );
}

function RankingSerieTvEntry() {
  return (
    <RankingTvShell>
      <RankingSerieFullscreenPage />
    </RankingTvShell>
  );
}

function RankingPeriodoTvEntry() {
  return (
    <RankingTvShell>
      <RankingPeriodoFullscreenPage />
    </RankingTvShell>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/ranking/tv/serie/:serieId', element: <RankingSerieTvEntry /> },
      { path: '/ranking/tv/periodo/:eventoId', element: <RankingPeriodoTvEntry /> },
      { path: '/ranking/tv/:eventoId', element: <RankingTvEntry /> },
      { path: '/c/:slug/cadastro', element: <CadastroLinkDescontinuadoPage /> },
      { path: '/c/:slug/t/:trailerId', element: <PortalClientePage /> },
      {
        element: <PublicOnly />,
        children: [
          {
            element: <PublicAuthShell />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
              { path: '/reset-password', element: <ResetPasswordPage /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireAdmin />,
            children: [
              {
                path: '/admin/cervejarias',
                element: (
                  <AdminLayout>
                    <AdminCervejariasPage />
                  </AdminLayout>
                ),
              },
              {
                path: '/admin/configuracoes',
                element: (
                  <AdminLayout>
                    <AdminConfiguracoesPage />
                  </AdminLayout>
                ),
              },
              { path: '/admin/*', element: <Navigate to="/admin/cervejarias" replace /> },
            ],
          },
          {
            element: <RequireTenant />,
            children: [
              {
                path: '/',
                element: <TenantShell />,
                children: [
                  { index: true, element: <TenantEntryRedirect /> },
                  { path: 'trailer', element: <SelecionarTrailerPage /> },
                  { path: 'eventos', element: <EventoPage /> },
                  { path: 'ranking/serie/:serieId', element: <RankingSeriePage /> },
                  { path: 'ranking/periodo/:eventoId', element: <RankingPeriodoPage /> },
                  { path: 'clientes', element: <ClientesPage /> },
                  { path: 'clientes/:id', element: <ClienteDetailPage /> },
                  {
                    element: <RequireTrailerContext />,
                    children: [
                      { path: 'comandas', element: <ComandasPage /> },
                      { path: 'comandas/nova', element: <NovaComandaPage /> },
                      { path: 'comandas/venda-avulsa', element: <VendaAvulsaPage /> },
                      { path: 'comandas/:id', element: <ComandaDetailPage /> },
                      { path: 'ranking/:eventoId?', element: <RankingPage /> },
                    ],
                  },
                  {
                    element: <RequireDono />,
                    children: [
                      { path: 'dashboard', element: <DashboardPage /> },
                      { path: 'eventos/:eventoId/resumo', element: <ResumoExecutivoPage /> },
                      { path: 'configuracoes', element: <Navigate to="/configuracoes/equipe" replace /> },
                      { path: 'configuracoes/:tab', element: <ConfiguracoesPage /> },
                      { path: 'catalogo', element: <Navigate to="/configuracoes/catalogo" replace /> },
                      { path: 'funcionarios', element: <Navigate to="/configuracoes/equipe" replace /> },
                      { path: 'aparencia', element: <Navigate to="/configuracoes/aparencia" replace /> },
                      { path: 'relatorios', element: <Navigate to="/dashboard" replace /> },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <CatchAll /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
