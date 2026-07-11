import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getPlatformSettings, savePlatformSettings } from './system-config.js';

const execFileAsync = promisify(execFile);

export const BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups');

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export interface BackupFileInfo {
  filename: string;
  size: number;
  createdAt: string;
}

export function listBackupFiles(): BackupFileInfo[] {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function dumpViaDocker(): Promise<string> {
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', 'cervejaria-db', 'pg_dump', '-U', 'cervejaria', '-d', 'cervejaria', '--no-owner', '--no-acl'],
    { maxBuffer: 100 * 1024 * 1024 },
  );
  return stdout;
}

async function dumpViaPgDump(): Promise<string> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada');
  const { stdout } = await execFileAsync('pg_dump', [url, '--no-owner', '--no-acl'], {
    maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
  });
  return stdout;
}

export async function runDatabaseBackup(): Promise<BackupFileInfo> {
  ensureBackupDir();
  let sql: string;
  try {
    sql = await dumpViaDocker();
  } catch {
    sql = await dumpViaPgDump();
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filepath, sql, 'utf8');
  const stat = fs.statSync(filepath);

  await savePlatformSettings({
    lastBackupAt: new Date().toISOString(),
    lastBackupFile: filename,
    lastBackupSize: stat.size,
  });

  await pruneOldBackups();

  return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
}

async function pruneOldBackups() {
  const settings = await getPlatformSettings();
  const retention = settings.backup.retentionDays;
  if (retention <= 0) return;

  const cutoff = Date.now() - retention * 24 * 60 * 60 * 1000;
  for (const file of listBackupFiles()) {
    if (new Date(file.createdAt).getTime() < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, file.filename));
    }
  }
}

export function getBackupFilePath(filename: string): string | null {
  if (!/^backup-[\dT-]+\.sql$/.test(filename)) return null;
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  return filepath;
}
