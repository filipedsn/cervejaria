import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import sharp from 'sharp';
import { prisma } from './prisma.js';
import {
  extractBrandTheme,
  buildTheme,
  normalizeTheme,
  themeToStorage,
  type BrandThemeV2,
} from './brand-engine.js';
import { ensureUploadsDir, getLogosDir, getPortalBackgroundsDir } from './uploads.js';

export interface CervejariaAuthPayload {
  id: string;
  nome: string;
  slug: string;
  chavePix: string | null;
  logoUrl: string | null;
  corPrimaria: string | null;
  corSecundaria: string | null;
  corPaleta: BrandThemeV2 | null;
  exibirKpisComanda: boolean;
  comandasColunaUnica: boolean;
  usaCardapio: boolean;
  updatedAt: string;
  /** Versão do arquivo/registro da logo para invalidar o cache do navegador. */
  logoVersion: string | null;
  portalBackgroundUrl: string | null;
  portalBackgroundVersion: string | null;
}

type CervejariaBrandingRow = {
  id: string;
  nome: string;
  slug: string;
  chavePix?: string | null;
  logoUrl: string | null;
  corPrimaria: string | null;
  corPaleta: unknown;
  exibirKpisComanda: boolean;
  comandasColunaUnica: boolean;
  usaCardapio: boolean;
  updatedAt: Date;
  portalBackgroundUrl?: string | null;
};

export function resolveLogoVersion(
  cervejaria: Pick<CervejariaBrandingRow, 'logoUrl' | 'updatedAt'>,
): string | null {
  if (!cervejaria.logoUrl) return null;

  const filename = path.basename(cervejaria.logoUrl);
  const logoPath = path.join(getLogosDir(), filename);
  try {
    const stat = fs.statSync(logoPath);
    return new Date(Math.max(stat.mtimeMs, cervejaria.updatedAt.getTime())).toISOString();
  } catch {
    return cervejaria.updatedAt.toISOString();
  }
}

export function formatCervejariaAuth(cervejaria: CervejariaBrandingRow): CervejariaAuthPayload {
  const theme = normalizeTheme(cervejaria.corPaleta, cervejaria.corPrimaria);
  return {
    id: cervejaria.id,
    nome: cervejaria.nome,
    slug: cervejaria.slug,
    chavePix: cervejaria.chavePix ?? null,
    logoUrl: cervejaria.logoUrl,
    corPrimaria: cervejaria.corPrimaria,
    corSecundaria: theme?.corSecundaria ?? null,
    corPaleta: theme,
    exibirKpisComanda: cervejaria.exibirKpisComanda,
    comandasColunaUnica: cervejaria.comandasColunaUnica,
    // Compatibilidade para clientes antigos: cardápios salvos sempre disponíveis.
    usaCardapio: true,
    updatedAt: cervejaria.updatedAt.toISOString(),
    logoVersion: resolveLogoVersion(cervejaria),
    portalBackgroundUrl: cervejaria.portalBackgroundUrl ?? null,
    portalBackgroundVersion: resolvePortalBackgroundVersion(cervejaria),
  };
}

function resolvePortalBackgroundVersion(cervejaria: CervejariaBrandingRow): string | null {
  if (!cervejaria.portalBackgroundUrl) return null;
  try {
    const filePath = path.join(getPortalBackgroundsDir(), path.basename(cervejaria.portalBackgroundUrl));
    return new Date(fs.statSync(filePath).mtimeMs).toISOString();
  } catch {
    return cervejaria.updatedAt.toISOString();
  }
}

async function brandingFromBuffer(buffer: Buffer) {
  const { corPrimaria, corSecundaria, theme } = await extractBrandTheme(buffer);
  return { corPrimaria, corSecundaria, theme };
}

/** Remove apenas o fundo claro conectado às bordas, preservando áreas brancas internas da logo. */
async function removeLightBackground(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const isLightBackground = (index: number) => {
    const offset = index * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    return r >= 218 && g >= 218 && b >= 218 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;
  };

  const enqueue = (index: number) => {
    if (!visited[index] && isLightBackground(index)) {
      visited[index] = 1;
      queue.push(index);
    }
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * channels + 3] = 0;
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y < height - 1) enqueue(index + width);
  }

  return sharp(data, { raw: info }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
}

export async function saveLogoAndExtractBranding(cervejariaId: string, buffer: Buffer) {
  ensureUploadsDir();
  const logosDir = getLogosDir();

  const transparentBuffer = await removeLightBackground(buffer);
  const webpBuffer = await sharp(transparentBuffer)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();

  const filename = `${cervejariaId}.webp`;
  await fsp.writeFile(path.join(logosDir, filename), webpBuffer);

  const { corPrimaria, theme } = await brandingFromBuffer(webpBuffer);
  const logoUrl = `/uploads/logos/${filename}`;

  return prisma.cervejaria.update({
    where: { id: cervejariaId },
    data: { logoUrl, corPrimaria, corPaleta: themeToStorage(theme) },
  });
}

export async function savePortalBackground(cervejariaId: string, buffer: Buffer) {
  ensureUploadsDir();
  const webpBuffer = await sharp(buffer)
    .rotate()
    .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toBuffer();
  const filename = `${cervejariaId}.webp`;
  await fsp.writeFile(path.join(getPortalBackgroundsDir(), filename), webpBuffer);
  return prisma.cervejaria.update({
    where: { id: cervejariaId },
    data: { portalBackgroundUrl: `/uploads/portal-backgrounds/${filename}` },
  });
}

export async function reextractBrandingFromLogo(cervejariaId: string) {
  const logoPath = path.join(getLogosDir(), `${cervejariaId}.webp`);
  try {
    const buffer = await fsp.readFile(logoPath);
    const { corPrimaria, theme } = await brandingFromBuffer(buffer);
    return prisma.cervejaria.update({
      where: { id: cervejariaId },
      data: { corPrimaria, corPaleta: themeToStorage(theme) },
    });
  } catch {
    const err = new Error('Logo não encontrada. Envie uma nova imagem.') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
}

export async function updateBrandingColors(cervejariaId: string, corPrimaria: string) {
  const existing = await prisma.cervejaria.findUnique({ where: { id: cervejariaId } });
  const prevTheme = normalizeTheme(existing?.corPaleta, existing?.corPrimaria ?? null);
  const theme = buildTheme(corPrimaria, prevTheme?.corSecundaria ?? null, prevTheme?.surface.base);
  return prisma.cervejaria.update({
    where: { id: cervejariaId },
    data: { corPrimaria, corPaleta: themeToStorage(theme) },
  });
}
