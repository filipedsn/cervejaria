import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..', '..');

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

export function loadAppEnv(): void {
  const envName = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const envFile = path.join(backendRoot, `.env.${envName}`);

  if (!fs.existsSync(envFile)) {
    const legacy = path.join(backendRoot, '.env');
    if (fs.existsSync(legacy)) return;
    // Em producao os segredos ficam fora de prod-artifacts e sao injetados pelo
    // launcher. Nessa situacao a ausencia do arquivo no artefato e esperada.
    const injectedRuntimeEnv = Boolean(process.env.DATABASE_URL && process.env.JWT_SECRET);
    if (!injectedRuntimeEnv) {
      console.warn(`[env] Arquivo nao encontrado: ${envFile}`);
    }
    return;
  }

  const vars = parseEnvFile(fs.readFileSync(envFile, 'utf8'));
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadAppEnv();
