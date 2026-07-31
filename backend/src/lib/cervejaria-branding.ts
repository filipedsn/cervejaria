import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { prisma } from './prisma.js';
import {
  extractBrandTheme,
  buildTheme,
  normalizeTheme,
  themeToStorage,
  type BrandThemeV2,
} from './brand-engine.js';
import { ensureUploadsDir, getLogosDir } from './uploads.js';

export interface CervejariaAuthPayload {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  corSecundaria: string | null;
  corPaleta: BrandThemeV2 | null;
  updatedAt: string;
}

type CervejariaBrandingRow = {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  corPaleta: unknown;
  updatedAt: Date;
};

export function formatCervejariaAuth(cervejaria: CervejariaBrandingRow): CervejariaAuthPayload {
  const theme = normalizeTheme(cervejaria.corPaleta, cervejaria.corPrimaria);
  return {
    id: cervejaria.id,
    nome: cervejaria.nome,
    slug: cervejaria.slug,
    logoUrl: cervejaria.logoUrl,
    corPrimaria: cervejaria.corPrimaria,
    corSecundaria: theme?.corSecundaria ?? null,
    corPaleta: theme,
    updatedAt: cervejaria.updatedAt.toISOString(),
  };
}

async function brandingFromBuffer(buffer: Buffer) {
  const { corPrimaria, corSecundaria, theme } = await extractBrandTheme(buffer);
  return { corPrimaria, corSecundaria, theme };
}

export async function saveLogoAndExtractBranding(cervejariaId: string, buffer: Buffer) {
  ensureUploadsDir();
  const logosDir = getLogosDir();

  const webpBuffer = await sharp(buffer)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  const filename = `${cervejariaId}.webp`;
  await fs.writeFile(path.join(logosDir, filename), webpBuffer);

  const { corPrimaria, theme } = await brandingFromBuffer(webpBuffer);
  const logoUrl = `/uploads/logos/${filename}`;

  return prisma.cervejaria.update({
    where: { id: cervejariaId },
    data: { logoUrl, corPrimaria, corPaleta: themeToStorage(theme) },
  });
}

export async function reextractBrandingFromLogo(cervejariaId: string) {
  const logoPath = path.join(getLogosDir(), `${cervejariaId}.webp`);
  try {
    const buffer = await fs.readFile(logoPath);
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
