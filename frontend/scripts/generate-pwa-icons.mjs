import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const outDir = path.join(publicDir, 'icons');
const officialSource = path.resolve(__dirname, '../../Imagens/Logo Oficial.png');
const fallbackLogo = path.join(publicDir, 'logo.png');
const fallbackSvg = path.join(publicDir, 'favicon.svg');
const logoOut = path.join(publicDir, 'logo.png');

async function resolveSource() {
  for (const candidate of [officialSource, fallbackLogo, fallbackSvg]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('Nenhuma fonte de logo encontrada (Logo Oficial.png, logo.png ou favicon.svg)');
}

async function writeIcon(source, size, filename) {
  await sharp(source)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
    .toFile(path.join(outDir, filename));
}

const source = await resolveSource();

await mkdir(outDir, { recursive: true });

if (source === officialSource) {
  await copyFile(source, logoOut);
} else if (source !== logoOut) {
  await sharp(source).png().toFile(logoOut);
}

await writeIcon(logoOut, 180, 'apple-touch-icon.png');
await writeIcon(logoOut, 192, 'pwa-192.png');
await writeIcon(logoOut, 512, 'pwa-512.png');
console.log('Logo e icones PWA atualizados em frontend/public/');
