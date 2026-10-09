import { useCozinhaDisplaySettings } from '../../hooks/useCozinhaDisplaySettings';

export function CozinhaVisualSettingsPanel() {
  const { settings, update, intervals } = useCozinhaDisplaySettings();
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface-lighter p-3" aria-labelledby="cozinha-visual-title">
      <div>
        <h3 id="cozinha-visual-title" className="font-semibold text-ink">Cozinha</h3>
        <p className="text-sm text-ink-muted">Preferência visual salva neste dispositivo e isolada por empresa e usuário. Não altera permissões nem dados dos pedidos.</p>
      </div>
      <label className="block space-y-1 text-sm font-medium text-ink">
        Perfil padrão neste dispositivo
        <select className="input w-full" value={settings.profile} onChange={(event) => update({ profile: event.target.value as typeof settings.profile })}>
          <option value="automatico">Automático</option>
          <option value="ampliada">Leitura ampliada</option>
          <option value="mais-pedidos">Mais pedidos</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-ink">
        Troca automática no modo TV
        <select className="input w-full" value={settings.intervalMs} onChange={(event) => update({ intervalMs: Number(event.target.value) })}>
          {intervals.map((ms) => <option key={ms} value={ms}>{ms / 1000} segundos</option>)}
        </select>
        <span className="block text-xs font-normal text-ink-muted">Disponível de 5 a 30 segundos. O modo operacional/tablet não avança sozinho.</span>
      </label>
    </section>
  );
}
