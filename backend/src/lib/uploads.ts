import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
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
