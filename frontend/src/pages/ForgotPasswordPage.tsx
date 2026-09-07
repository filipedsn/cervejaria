import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLogo } from '../components/AppLogo';
import { api, ApiError } from '../lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await api.post<{ message: string }>('/api/auth/forgot-password', { email });
      setSuccess(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao solicitar recuperação');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-canvas">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <AppLogo className="w-full mb-4" />
          <h1 className="text-2xl font-bold text-brand-600">Recuperar senha</h1>
          <p className="text-ink-muted mt-1">Enviaremos um link para seu e-mail</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && <div className="alert-error">{error}</div>}
          {success && <div className="alert-success">{success}</div>}

          <div>
            <label className="label">E-mail</label>
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>

          <button type="submit" className="touch-btn-primary w-full" disabled={loading || !!success}>
            {loading ? 'Enviando...' : 'Enviar link'}
          </button>

          <Link to="/login" className="touch-btn-secondary w-full inline-flex items-center justify-center">
            Voltar ao login
          </Link>
        </form>
      </div>
    </div>
  );
}
