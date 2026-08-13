import { spawn } from 'node:child_process';

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Chamado a cada linha de stdout — usado pelo fixer para ler o stream-json do Cursor CLI. */
  onStdoutLine?: (line: string) => void;
};

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * No Windows, npm e npx sao shims .cmd e nao podem ser lancados com `shell: false`
 * sem a extensao explicita.
 */
const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'cursor-agent']);

export function resolveExecutable(command: string): string {
  if (process.platform !== 'win32') return command;
  if (!WINDOWS_CMD_SHIMS.has(command)) return command;
  return `${command}.cmd`;
}

/**
 * Executa um binario sem shell intermediario: os argumentos nunca sao interpretados,
 * o que evita injecao vinda de conteudo de alerta ou de Issue.
 */
export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const resolved = resolveExecutable(command);
  try {
    return await spawnOnce(resolved, args, options);
  } catch (err) {
    const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (notFound && resolved !== command) return spawnOnce(command, args, options);
    throw err;
  }
}

function spawnOnce(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.onStdoutLine) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) options.onStdoutLine(line);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending && options.onStdoutLine) options.onStdoutLine(pending);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

/** Igual a `run`, mas lanca quando o processo nao termina com exit 0. */
export async function runOrThrow(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-8).join('\n');
    throw new Error(
      `${command} ${args.join(' ')} falhou (exit ${result.code}${result.timedOut ? ', timeout' : ''}):\n${detail}`,
    );
  }
  return result;
}
