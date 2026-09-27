import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { formatPhone } from '../lib/phone';
import { PageHeader } from '../components/PageHeader';

export function NovoClientePage() {
  const navigate = useNavigate();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      await api.post('/api/clientes', { nome: nome.trim(), telefone: formatPhone(telefone), email: email.trim() || undefined });
      navigate('/clientes');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o cliente');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader title="Novo cliente" backTo="/clientes" backLabel="Clientes" />
      <form className="space-y-4" onSubmit={salvar}>
        {erro && <div className="alert-error">{erro}</div>}
        <div><label className="label">Nome</label><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus /></div>
        <div><label className="label">Telefone</label><input className="input" type="tel" inputMode="numeric" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} placeholder="(11) 9 9999-9999" required /></div>
        <div><label className="label">E-mail (opcional)</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <button className="touch-btn-primary w-full" disabled={salvando}>{salvando ? 'Salvando...' : 'Cadastrar cliente'}</button>
        <button type="button" className="touch-btn-secondary w-full" onClick={() => navigate('/clientes')}>Cancelar</button>
      </form>
    </div>
  );
}
