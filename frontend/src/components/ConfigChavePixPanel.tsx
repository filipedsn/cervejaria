import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import type { Cervejaria } from '../types';

export function ConfigChavePixPanel() {
  const { cervejaria, updateCervejaria } = useAuth();
  const [chavePix, setChavePix] = useState(cervejaria?.chavePix ?? '');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  if (!cervejaria) return null;

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErro('');
    setSucesso('');
    try {
      const atualizado = await api.patch<Cervejaria>('/api/cervejaria/chave-pix', {
        chavePix: chavePix.trim() || null,
      });
      updateCervejaria(atualizado);
      setChavePix(atualizado.chavePix ?? '');
      setSucesso('Chave PIX salva. Ela será incluída nas mensagens de cobrança pendente.');
    } catch (cause) {
      setErro(cause instanceof ApiError ? cause.message : 'Não foi possível salvar a chave PIX.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <h3 className="font-semibold text-ink">Chave PIX da empresa</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Será incluída na mensagem de WhatsApp ao enviar a cobrança de uma conta pendente.
        </p>
      </div>
      <label className="block">
        <span className="label">Chave PIX</span>
        <input
          className="input"
          type="text"
          value={chavePix}
          onChange={(event) => setChavePix(event.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder="CPF, CNPJ, telefone, e-mail ou chave aleatória"
          aria-label="Chave PIX da empresa"
        />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-faint">Deixe em branco para remover a chave das mensagens.</p>
        <button type="submit" className="touch-btn-primary px-5" disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar chave PIX'}
        </button>
      </div>
      {erro && <p className="alert-error text-sm" role="alert">{erro}</p>}
      {sucesso && <p className="alert-success text-sm" role="status">{sucesso}</p>}
    </form>
  );
}
