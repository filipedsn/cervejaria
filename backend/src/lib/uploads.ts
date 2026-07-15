import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveUploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.join(__dirname, '../../uploads');
}

const UPLOADS_ROOT = resolveUploadsRoot();
const LOGOS_DIR = path.join(UPLOADS_ROOT, 'logos');

export function getUploadsRoot(): string {
  return UPLOADS_ROOT;
}

export function getLogosDir(): string {
  return LOGOS_DIR;
}

export function ensureUploadsDir(): void {
  if (!fs.existsSync(LOGOS_DIR)) {
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
  }
}
