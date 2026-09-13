import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLogo } from '../components/AppLogo';
import { InstallAppBanner } from '../components/InstallAppBanner';
import { IconEye, IconEyeOff } from '../components/NavIcons';
import { useAuth } from '../contexts/AuthContext';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell fixed inset-0 flex min-h-dvh flex-col overflow-y-auto overscroll-none px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-6">
        <InstallAppBanner variant="login" />
        <div className="mb-8 flex flex-col items-center text-center sm:mb-10">
          <AppLogo className="h-56 w-full max-w-full object-contain sm:h-64" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="login-label mb-1.5 block text-sm font-medium">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="login-input w-full rounded-xl px-4 py-3.5 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
              placeholder="seu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="login-label mb-1.5 block text-sm font-medium">
              Senha
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="login-input w-full rounded-xl px-4 py-3.5 pr-12 text-base outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/60 hover:text-white"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-white/85">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-white/30 bg-white/10 accent-brand-400"
              />
              Lembrar-me
            </label>
            <Link to="/forgot-password" className="login-link font-medium hover:underline">
              Esqueci minha senha?
            </Link>
          </div>

          {error && (
            <p className="rounded-xl bg-red-500/20 px-4 py-3 text-sm text-red-100" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="login-btn-primary w-full">
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-8 text-center text-sm leading-relaxed text-white/60">
          Ainda não tem uma conta?{' '}
          <span className="text-white/80">Entre em contato com o administrador</span>
        </p>
      </div>
    </div>
  );
}
