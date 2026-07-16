export const CLIENTE_COOKIE_NAME = 'cliente_token';

export interface ClienteSessionPayload {
  type: 'cliente';
  cervejariaId: string;
  eventoId: string;
  trailerId: string;
  clienteId: string;
  comandaId: string;
  portalGeneration: number;
}

export function isClienteSessionPayload(value: unknown): value is ClienteSessionPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as ClienteSessionPayload;
  return (
    v.type === 'cliente' &&
    typeof v.cervejariaId === 'string' &&
    typeof v.eventoId === 'string' &&
    typeof v.trailerId === 'string' &&
    typeof v.clienteId === 'string' &&
    typeof v.comandaId === 'string' &&
    typeof v.portalGeneration === 'number'
  );
}
