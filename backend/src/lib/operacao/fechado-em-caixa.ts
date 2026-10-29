export class FechadoEmCaixaInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FechadoEmCaixaInvalidoError';
  }
}

/**
 * Resolve o instante de encerramento financeiro do caixa.
 * Default = agora. Se informado, deve estar entre abertura / última comanda e agora.
 */
export function resolverFechadoEmInformado(params: {
  informado?: Date | null;
  agora?: Date;
  abertoEm: Date;
  ultimaComandaFechadaEm: Date | null;
}): Date {
  const agora = params.agora ?? new Date();
  const fechadoEm = params.informado ?? agora;

  if (Number.isNaN(fechadoEm.getTime())) {
    throw new FechadoEmCaixaInvalidoError('Data/hora de encerramento inválida');
  }
  if (fechadoEm.getTime() > agora.getTime() + 60_000) {
    throw new FechadoEmCaixaInvalidoError('A data/hora de encerramento não pode ser no futuro');
  }
  if (fechadoEm.getTime() < params.abertoEm.getTime()) {
    throw new FechadoEmCaixaInvalidoError('A data/hora de encerramento deve ser posterior à abertura do caixa');
  }
  if (
    params.ultimaComandaFechadaEm
    && fechadoEm.getTime() < params.ultimaComandaFechadaEm.getTime()
  ) {
    throw new FechadoEmCaixaInvalidoError(
      'A data/hora de encerramento deve ser posterior ao fechamento da última comanda do turno',
    );
  }
  return fechadoEm;
}
