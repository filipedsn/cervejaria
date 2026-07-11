export type BrandPalette = Record<'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900', string>;

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsl(r, g, b);
}

export function generateBrandPalette(primaryHex: string): BrandPalette {
  const { h, s } = hexToHsl(primaryHex);
  const baseS = Math.min(1, Math.max(0.45, s));

  return {
    '50': hslToHex(h, baseS * 0.25, 0.96),
    '100': hslToHex(h, baseS * 0.35, 0.9),
    '200': hslToHex(h, baseS * 0.55, 0.78),
    '300': hslToHex(h, baseS * 0.75, 0.65),
    '400': hslToHex(h, baseS, 0.52),
    '500': hslToHex(h, baseS, 0.45),
    '600': hslToHex(h, baseS * 0.95, 0.38),
    '700': hslToHex(h, baseS * 0.9, 0.32),
    '800': hslToHex(h, baseS * 0.85, 0.24),
    '900': hslToHex(h, baseS * 0.8, 0.16),
  };
}

export function isValidPalette(value: unknown): value is BrandPalette {
  if (!value || typeof value !== 'object') return false;
  return SHADES.every((shade) => typeof (value as BrandPalette)[shade] === 'string');
}
