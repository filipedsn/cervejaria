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
import { ensureUploadsDir, getLogosDir } from './uploads.js';

export interface CervejariaAuthPayload {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  corSecundaria: string | null;
  corPaleta: BrandThemeV2 | null;
  exibirKpisComanda: boolean;
  comandasColunaUnica: boolean;
  usaCardapio: boolean;
  updatedAt: string;
  /** Mtime do arquivo de logo — invalida cache do navegador quando o arquivo muda sem update no banco. */
  logoVersion: string | null;
}

type CervejariaBrandingRow = {
  id: string;
  nome: string;
  slug: string;
  logoUrl: string | null;
  corPrimaria: string | null;
  corPaleta: unknown;
  exibirKpisComanda: boolean;
  comandasColunaUnica: boolean;
  usaCardapio: boolean;
  updatedAt: Date;
};

function resolveLogoVersion(cervejaria: CervejariaBrandingRow): string | null {
  if (!cervejaria.logoUrl) return null;

  const filename = path.basename(cervejaria.logoUrl);
  const logoPath = path.join(getLogosDir(), filename);
  try {
    const stat = fs.statSync(logoPath);
    return new Date(stat.mtimeMs).toISOString();
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
    logoUrl: cervejaria.logoUrl,
    corPrimaria: cervejaria.corPrimaria,
    corSecundaria: theme?.corSecundaria ?? null,
    corPaleta: theme,
    exibirKpisComanda: cervejaria.exibirKpisComanda,
    comandasColunaUnica: cervejaria.comandasColunaUnica,
    usaCardapio: cervejaria.usaCardapio,
    updatedAt: cervejaria.updatedAt.toISOString(),
    logoVersion: resolveLogoVersion(cervejaria),
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
  await fsp.writeFile(path.join(logosDir, filename), webpBuffer);

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
