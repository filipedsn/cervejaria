import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const outDir = path.join(publicDir, 'icons');
const officialSource = path.resolve(__dirname, '../../assets/logo/Logo Oficial.jpeg');
const fallbackLogo = path.join(publicDir, 'logo.png');
const fallbackSvg = path.join(publicDir, 'favicon.svg');
const logoOut = path.join(publicDir, 'logo.png');
const EXTERIOR_WHITE_MIN = 238;
const EXTERIOR_WHITE_CHROMA_MAX = 16;

async function resolveSource() {
  for (const candidate of [officialSource, fallbackLogo, fallbackSvg]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('Nenhuma fonte de logo encontrada (Logo Oficial.jpeg, logo.png ou favicon.svg)');
}

function isExteriorWhite(data, pixelIndex) {
  const offset = pixelIndex * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return min >= EXTERIOR_WHITE_MIN && max - min <= EXTERIOR_WHITE_CHROMA_MAX;
}

async function writeTransparentLogo(source, destination) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueue = (pixelIndex) => {
    if (visited[pixelIndex] || !isExteriorWhite(data, pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixelIndex = queue[head];
    head += 1;
    data[pixelIndex * 4 + 3] = 0;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  await sharp(data, { raw: info }).png().toFile(destination);
}

async function writeIcon(source, size, filename) {
  await sharp(source)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(outDir, filename));
}

const source = await resolveSource();

await mkdir(outDir, { recursive: true });

if (source === officialSource) {
  await writeTransparentLogo(source, logoOut);
} else if (source !== logoOut) {
  await sharp(source).png().toFile(logoOut);
}

await writeIcon(logoOut, 180, 'apple-touch-icon.png');
await writeIcon(logoOut, 192, 'pwa-192.png');
await writeIcon(logoOut, 512, 'pwa-512.png');
console.log('Logo e icones PWA atualizados em frontend/public/');
