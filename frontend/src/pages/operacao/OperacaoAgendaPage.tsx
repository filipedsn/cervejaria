import { PageHeader } from '../../components/PageHeader';
import { AgendaOperacionalPanel } from '../../components/operacao/AgendaOperacionalPanel';
import { useOperacaoContexto } from '../../hooks/useOperacaoContexto';

export function OperacaoAgendaPage() {
  const { contexto } = useOperacaoContexto();
  return (
    <div className="space-y-5 pb-2">
      <PageHeader title="Agenda" />
      {contexto.operationalSettingsSource === 'CANONICAL_PDV'
        ? <AgendaOperacionalPanel />
        : <div className="card text-sm text-ink-muted">A agenda operacional não está habilitada neste ponto de venda.</div>}
    </div>
  );
}
