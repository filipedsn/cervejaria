import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppLogo } from '../components/AppLogo';
import { api, ApiError } from '../lib/api';

import { PasswordWithConfirmFields, validatePasswordPair } from '../components/PasswordWithConfirmFields';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const pwdErr = validatePasswordPair(senha, confirmar);
    if (pwdErr) {
      setError(pwdErr);
      return;
    }
    if (!token) {
      setError('Link inválido. Solicite um novo.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/api/auth/reset-password', { token, senha });
      navigate('/login', { state: { message: 'Senha redefinida! Faça login.' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao redefinir senha');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-canvas">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <AppLogo className="w-full mb-4" />
          <h1 className="text-2xl font-bold text-brand-600">Nova senha</h1>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && <div className="alert-error">{error}</div>}

          <PasswordWithConfirmFields
            senha={senha}
            confirmar={confirmar}
            onSenhaChange={setSenha}
            onConfirmarChange={setConfirmar}
            senhaLabel="Nova senha"
            required
          />

          <button type="submit" className="touch-btn-primary w-full" disabled={loading}>
            {loading ? 'Salvando...' : 'Redefinir senha'}
          </button>

          <Link to="/login" className="touch-btn-secondary w-full inline-flex items-center justify-center">
            Voltar ao login
          </Link>
        </form>
      </div>
    </div>
  );
}
