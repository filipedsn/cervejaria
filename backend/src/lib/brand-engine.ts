import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import {
  generateBrandPalette,
  hexToHsl,
  hslToHex,
  rgbToHsl,
  type BrandPalette,
} from './brand-colors.js';

export interface SurfaceColors {
  base: string;
  light: string;
  lighter: string;
}

export interface BrandThemeV2 {
  v: 2;
  brand: BrandPalette;
  surface: SurfaceColors;
  corSecundaria: string | null;
}

const DEFAULT_PRIMARY = '#e69500';

type Bucket = {
  count: number;
  r: number;
  g: number;
  b: number;
  hue: number;
  sat: number;
};

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function bucketAvg(bucket: Bucket): string {
  return rgbToHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count);
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 360 - diff);
}

function addToBucket(map: Map<number, Bucket>, hueBin: number, r: number, g: number, b: number, h: number, s: number) {
  const bucket = map.get(hueBin) ?? { count: 0, r: 0, g: 0, b: 0, hue: h, sat: s };
  bucket.count += 1;
  bucket.r += r;
  bucket.g += g;
  bucket.b += b;
  bucket.hue = h;
  bucket.sat = Math.max(bucket.sat, s);
  map.set(hueBin, bucket);
}

function bestBucket(map: Map<number, Bucket>, score?: (b: Bucket) => number): Bucket | null {
  let best: Bucket | null = null;
  let bestScore = -1;
  for (const bucket of map.values()) {
    const s = score ? score(bucket) : bucket.count;
    if (s > bestScore) {
      bestScore = s;
      best = bucket;
    }
  }
  return best;
}

export function generateSurfaces(primaryHex: string, darkSampleHex?: string): SurfaceColors {
  const primary = hexToHsl(primaryHex);
  let h = primary.h;
  let s = Math.min(0.55, Math.max(0.22, primary.s * 0.9));

  if (darkSampleHex) {
    const dark = hexToHsl(darkSampleHex);
    if (dark.s > 0.06) {
      h = dark.h;
      s = Math.min(0.5, Math.max(0.18, dark.s + 0.12));
    }
  }

  return {
    base: hslToHex(h, s, 0.07),
    light: hslToHex(h, s * 0.95, 0.11),
    lighter: hslToHex(h, s * 0.9, 0.15),
  };
}

export function buildTheme(
  corPrimaria: string,
  corSecundaria: string | null,
  darkSampleHex?: string
): BrandThemeV2 {
  return {
    v: 2,
    brand: generateBrandPalette(corPrimaria),
    surface: generateSurfaces(corPrimaria, darkSampleHex),
    corSecundaria,
  };
}

export async function extractBrandTheme(buffer: Buffer): Promise<{
  corPrimaria: string;
  corSecundaria: string | null;
  theme: BrandThemeV2;
}> {
  const { data } = await sharp(buffer)
    .resize(120, 120, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const vibrantBuckets = new Map<number, Bucket>();
  const darkBuckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 80) continue;

    const { h, s, l } = rgbToHsl(r, g, b);
    const hueBin = Math.floor(h / 15);

    if (l < 0.28 && s >= 0.06) {
      addToBucket(darkBuckets, hueBin, r, g, b, h, s);
    }

    if (s >= 0.18 && l >= 0.18 && l <= 0.78) {
      addToBucket(vibrantBuckets, hueBin, r, g, b, h, s);
    }
  }

  const primaryBucket =
    bestBucket(vibrantBuckets, (b) => b.count * (0.5 + b.sat)) ??
    bestBucket(darkBuckets, (b) => b.count * (0.3 + b.sat));

  const corPrimaria = primaryBucket ? bucketAvg(primaryBucket) : DEFAULT_PRIMARY;
  const primaryHue = primaryBucket?.hue ?? hexToHsl(corPrimaria).h;

  const darkBucket =
    bestBucket(darkBuckets, (b) => {
      const hueBonus = hueDistance(b.hue, primaryHue) < 45 ? 2.5 : 1;
      return b.count * hueBonus * (0.4 + b.sat);
    }) ?? bestBucket(darkBuckets);

  const darkSampleHex = darkBucket ? bucketAvg(darkBucket) : undefined;

  let corSecundaria: string | null = null;
  const secondaryBucket = bestBucket(vibrantBuckets, (b) => {
    if (hueDistance(b.hue, primaryHue) < 45) return 0;
    return b.count * b.sat;
  });
  if (secondaryBucket && secondaryBucket.count >= 3 && secondaryBucket.sat >= 0.22) {
    corSecundaria = bucketAvg(secondaryBucket);
  }

  const theme = buildTheme(corPrimaria, corSecundaria, darkSampleHex);
  return { corPrimaria, corSecundaria, theme };
}

export function isBrandThemeV2(value: unknown): value is BrandThemeV2 {
  if (!value || typeof value !== 'object') return false;
  const v = value as BrandThemeV2;
  if (v.v !== 2) return false;
  if (!v.brand || !v.surface) return false;
  const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
  if (!shades.every((s) => typeof v.brand[s] === 'string')) return false;
  if (typeof v.surface.base !== 'string') return false;
  if (typeof v.surface.light !== 'string') return false;
  if (typeof v.surface.lighter !== 'string') return false;
  return true;
}

export function isLegacyPalette(value: unknown): value is BrandPalette {
  if (!value || typeof value !== 'object') return false;
  const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
  return shades.every((s) => typeof (value as BrandPalette)[s] === 'string');
}

export function normalizeTheme(
  corPaleta: unknown,
  corPrimaria: string | null
): BrandThemeV2 | null {
  if (isBrandThemeV2(corPaleta)) return corPaleta;

  if (isLegacyPalette(corPaleta)) {
    const primary = corPrimaria ?? corPaleta['500'] ?? corPaleta['400'];
    return buildTheme(primary, null, corPaleta['900']);
  }

  return null;
}

export function themeToStorage(theme: BrandThemeV2): Prisma.InputJsonObject {
  return {
    v: theme.v,
    brand: { ...theme.brand },
    surface: { ...theme.surface },
    corSecundaria: theme.corSecundaria,
  };
}
