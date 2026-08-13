/**
 * Fase 0.3 — allowlist e denylist de caminhos que o agente pode tocar.
 *
 * Esta e a ultima linha de defesa do lado do orquestrador: mesmo que o Cursor CLI
 * escreva fora do escopo, o fixer inspeciona o diff do worktree antes de commitar
 * e aborta se qualquer arquivo violar a policy.
 */

/** Caminhos que o agente pode criar ou modificar (relativos a raiz do repo, com `/`). */
export const PATH_ALLOWLIST: readonly RegExp[] = [
  /^backend\/src\/.+\.ts$/,
  /^backend\/qa\/lib\/.+\.ts$/,
  /^frontend\/src\/.+\.(ts|tsx|css)$/,
  /^support-agent\/src\/.+\.ts$/,
];

/**
 * Caminhos proibidos em qualquer circunstancia. Avaliado antes do allowlist —
 * um caminho negado permanece negado mesmo que tambem case com o allowlist.
 */
export const PATH_DENYLIST: readonly RegExp[] = [
  /(^|\/)\.env($|\.)/,
  /^deploy\//,
  /^backend\/prisma\/migrations\//,
  /^backend\/prisma\/schema\.prisma$/,
  /^backend\/prisma\/rollbacks\//,
  /^\.cursor\/hooks\//,
  /^\.cursor\/cli\.json$/,
  /^\.github\/workflows\//,
  /^scripts\/prod\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)\.git\//,
];

export type PathVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'denylist' | 'fora-do-allowlist'; rule?: string };

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function checkPath(filePath: string): PathVerdict {
  const p = normalize(filePath);

  for (const rule of PATH_DENYLIST) {
    if (rule.test(p)) return { allowed: false, reason: 'denylist', rule: rule.source };
  }
  for (const rule of PATH_ALLOWLIST) {
    if (rule.test(p)) return { allowed: true };
  }
  return { allowed: false, reason: 'fora-do-allowlist' };
}

export type PolicyViolation = { path: string; reason: string };

/** Retorna as violacoes de uma lista de arquivos alterados. Vazio significa diff aprovado. */
export function checkChangedPaths(paths: readonly string[]): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  for (const p of paths) {
    const verdict = checkPath(p);
    if (verdict.allowed) continue;
    violations.push({
      path: p,
      reason:
        verdict.reason === 'denylist'
          ? `caminho na denylist (${verdict.rule})`
          : 'caminho fora do allowlist do agente',
    });
  }
  return violations;
}

/** Texto para injetar no prompt do Cursor CLI, para o agente saber o escopo antes de tentar. */
export function policyPromptSection(): string {
  return [
    'ESCOPO DE ARQUIVOS (obrigatorio):',
    'Voce PODE criar ou modificar apenas:',
    ...PATH_ALLOWLIST.map((r) => `  - ${r.source}`),
    'Voce NAO PODE tocar, em nenhuma hipotese:',
    '  - qualquer arquivo .env',
    '  - deploy/**',
    '  - backend/prisma/migrations/**, schema.prisma, rollbacks/**',
    '  - .cursor/hooks/**, .cursor/cli.json',
    '  - .github/workflows/**',
    '  - scripts/prod/**',
    '  - package-lock.json',
    'Se a correcao exigir mudanca de schema, migration ou infraestrutura, PARE e explique',
    'por que a correcao automatica nao e possivel em vez de tentar contornar o escopo.',
  ].join('\n');
}
