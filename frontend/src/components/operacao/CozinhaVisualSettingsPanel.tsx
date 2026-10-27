import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COZINHA_MAX_COLUNAS_DEFAULT,
  COZINHA_MAX_COLUNAS_MAX,
  COZINHA_MAX_COLUNAS_MIN,
  clampMaxColunasPorLinha,
  useCozinhaDisplaySettings,
} from '../../hooks/useCozinhaDisplaySettings';

const MAX_COLUNAS_OPTIONS = Array.from(
  { length: COZINHA_MAX_COLUNAS_MAX - COZINHA_MAX_COLUNAS_MIN + 1 },
  (_, index) => COZINHA_MAX_COLUNAS_MIN + index,
);

const SIM_COLUNAS_PADRAO = 4;
const SIM_PEDIDOS_PADRAO = 7;
const SIM_PEDIDOS_MIN = 1;
const SIM_PEDIDOS_MAX = 30;

function clampSimPedidos(value: number) {
  if (!Number.isFinite(value)) return SIM_PEDIDOS_PADRAO;
  return Math.min(SIM_PEDIDOS_MAX, Math.max(SIM_PEDIDOS_MIN, Math.round(value)));
}

export function CozinhaVisualSettingsPanel() {
  const { settings, update } = useCozinhaDisplaySettings();
  // Só para a URL de teste — não grava em localStorage/banco.
  const [simColunas, setSimColunas] = useState(SIM_COLUNAS_PADRAO);
  const [simPedidos, setSimPedidos] = useState(SIM_PEDIDOS_PADRAO);

  const simulacaoPath = useMemo(
    () => `/operacao/cozinha/tv?demo=1&maxColunas=${clampMaxColunasPorLinha(simColunas)}&pedidos=${clampSimPedidos(simPedidos)}`,
    [simColunas, simPedidos],
  );

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
          A tela usa o menor entre este valor e o que cabe na largura do aparelho. Padrão salvo: {COZINHA_MAX_COLUNAS_DEFAULT}.
        </span>
      </label>
      <div className="space-y-2">
        <div>
          <p className="text-sm font-medium text-ink">Simulação no PC</p>
          <p className="text-xs text-ink-muted">
            Valores só para o teste — não são gravados. Abre pedidos fictícios no layout tablet.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-[7rem] flex-1 space-y-1 text-sm font-medium text-ink">
            Colunas
            <select
              className="input w-full"
              value={simColunas}
              onChange={(event) => setSimColunas(clampMaxColunasPorLinha(Number(event.target.value)))}
            >
              {MAX_COLUNAS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[7rem] flex-1 space-y-1 text-sm font-medium text-ink">
            Pedidos
            <input
              type="number"
              className="input w-full"
              min={SIM_PEDIDOS_MIN}
              max={SIM_PEDIDOS_MAX}
              value={simPedidos}
              onChange={(event) => setSimPedidos(clampSimPedidos(Number(event.target.value)))}
            />
          </label>
          <Link
            to={simulacaoPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Abrir simulação
          </Link>
        </div>
        <p className="break-all font-mono text-[0.7rem] text-ink-muted">{simulacaoPath}</p>
      </div>
    </section>
  );
}
