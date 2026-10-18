import { z, ZodIssueCode, type ZodErrorMap } from 'zod';

const formatNumber = (value: number | bigint) => (typeof value === 'bigint' ? value.toString() : value.toLocaleString('pt-BR'));

/** Messages written in a schema (`.min(0, '...')`) still win over this map. */
export const zodPtBrErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Campo obrigatório' };
      if (issue.expected === 'integer') return { message: 'Informe um número inteiro' };
      if (issue.expected === 'number') return { message: 'Informe um número válido' };
      if (issue.expected === 'string') return { message: 'Informe um texto válido' };
      if (issue.expected === 'boolean') return { message: 'Informe sim ou não' };
      if (issue.expected === 'date') return { message: 'Data inválida' };
      return { message: 'Tipo de dado inválido' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return { message: Number(issue.minimum) <= 1 ? 'Campo obrigatório' : `Informe pelo menos ${formatNumber(issue.minimum)} caracteres` };
      }
      if (issue.type === 'array' || issue.type === 'set') return { message: `Informe pelo menos ${formatNumber(issue.minimum)} item(ns)` };
      if (issue.type === 'number' || issue.type === 'bigint') {
        if (Number(issue.minimum) === 0) return { message: issue.inclusive ? 'O valor não pode ser negativo' : 'O valor deve ser maior que zero' };
        return { message: issue.inclusive ? `O valor deve ser maior ou igual a ${formatNumber(issue.minimum)}` : `O valor deve ser maior que ${formatNumber(issue.minimum)}` };
      }
      if (issue.type === 'date') return { message: 'Data anterior ao permitido' };
      return { message: 'Valor abaixo do mínimo permitido' };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Informe no máximo ${formatNumber(issue.maximum)} caracteres` };
      if (issue.type === 'array' || issue.type === 'set') return { message: `Informe no máximo ${formatNumber(issue.maximum)} item(ns)` };
      if (issue.type === 'number' || issue.type === 'bigint') {
        return { message: issue.inclusive ? `O valor deve ser menor ou igual a ${formatNumber(issue.maximum)}` : `O valor deve ser menor que ${formatNumber(issue.maximum)}` };
      }
      if (issue.type === 'date') return { message: 'Data posterior ao permitido' };
      return { message: 'Valor acima do máximo permitido' };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'E-mail inválido' };
      if (issue.validation === 'url') return { message: 'Endereço (URL) inválido' };
      if (issue.validation === 'uuid' || issue.validation === 'cuid' || issue.validation === 'cuid2') return { message: 'Identificador inválido' };
      if (issue.validation === 'datetime' || issue.validation === 'date') return { message: 'Data inválida' };
      return { message: 'Formato inválido' };
    case ZodIssueCode.invalid_enum_value:
    case ZodIssueCode.invalid_literal:
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_union_discriminator:
      return { message: 'Opção inválida' };
    case ZodIssueCode.invalid_date:
      return { message: 'Data inválida' };
    case ZodIssueCode.not_multiple_of:
      return { message: `O valor deve ser múltiplo de ${formatNumber(issue.multipleOf)}` };
    case ZodIssueCode.not_finite:
      return { message: 'Informe um número válido' };
    case ZodIssueCode.unrecognized_keys:
      return { message: 'Campos não reconhecidos na requisição' };
    case ZodIssueCode.custom:
      return { message: ctx.defaultError === 'Invalid input' ? 'Dados inválidos' : ctx.defaultError };
    default:
      return { message: 'Dados inválidos' };
  }
};

export function installZodPtBrErrorMap(): void {
  z.setErrorMap(zodPtBrErrorMap);
}
