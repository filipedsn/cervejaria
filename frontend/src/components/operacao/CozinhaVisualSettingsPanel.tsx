import { Link } from 'react-router-dom';
import {
  COZINHA_MAX_COLUNAS_MAX,
  COZINHA_MAX_COLUNAS_MIN,
  useCozinhaDisplaySettings,
} from '../../hooks/useCozinhaDisplaySettings';

const MAX_COLUNAS_OPTIONS = Array.from(
  { length: COZINHA_MAX_COLUNAS_MAX - COZINHA_MAX_COLUNAS_MIN + 1 },
  (_, index) => COZINHA_MAX_COLUNAS_MIN + index,
);

export function CozinhaVisualSettingsPanel() {
  const { settings, update } = useCozinhaDisplaySettings();
  const simulacaoPath = `/operacao/cozinha/tv?demo=1&maxColunas=${settings.maxColunasPorLinha}&pedidos=4`;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface-lighter p-3" aria-labelledby="cozinha-visual-title">
      <div>
        <h3 id="cozinha-visual-title" className="font-semibold text-ink">Cozinha</h3>
        <p className="text-sm text-ink-muted">Preferência visual salva neste dispositivo e isolada por empresa e usuário. Não altera permissões nem dados dos pedidos.</p>
      </div>
      <label className="block space-y-1 text-sm font-medium text-ink">
        Perfil padrão neste dispositivo
        <select
          className="input w-full"
          value={settings.profile}
          onChange={(event) => update({ profile: event.target.value as typeof settings.profile })}
        >
          <option value="automatico">Automático</option>
          <option value="ampliada">Leitura ampliada</option>
          <option value="mais-pedidos">Mais pedidos</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-ink">
        Máximo de pedidos por linha
        <select
          className="input w-full"
          value={settings.maxColunasPorLinha}
          onChange={(event) => update({ maxColunasPorLinha: Number(event.target.value) })}
        >
          {MAX_COLUNAS_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="block text-xs font-normal text-ink-muted">
          A tela usa o menor entre este valor e o que cabe na largura do aparelho.
        </span>
      </label>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">Simulação no PC</p>
        <p className="text-xs text-ink-muted">
          Abre a cozinha com pedidos fictícios e o teto atual ({settings.maxColunasPorLinha} por linha), sem precisar de tablet.
        </p>
        <Link
          to={simulacaoPath}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Abrir simulação
        </Link>
        <p className="break-all font-mono text-[0.7rem] text-ink-muted">{simulacaoPath}</p>
      </div>
    </section>
  );
}
