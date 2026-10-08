import { z } from 'zod';
import { tenantPdvActivation } from '../pdv-tenant-activation.js';

/** Normalization only enforces identity; the display name is never rewritten. */
export function normalizarNomeCategoria(value: string): string {
  const equivalencias: Record<string, string> = { á: 'a', à: 'a', ã: 'a', â: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i', ó: 'o', ò: 'o', õ: 'o', ô: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c' };
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR').replace(/[áàãâäéèêëíìîïóòõôöúùûüç]/g, (letter) => equivalencias[letter]);
}

export const categoriaPdvInputSchema = z.object({
  nome: z.string().trim().min(1).max(80),
  gamificada: z.boolean().default(false),
});

/** Disabled by default so legacy requests never query the additive catalog. */
export function catalogoCategoriasCanonicoAtivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return tenantPdvActivation(undefined, env) ?? env.PDV_GAMIFIED_CATEGORY_CATALOG === '1';
}
