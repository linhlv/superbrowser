// Colour maths for readable UI on any profile colour (WCAG 2 relative luminance and contrast).

const HEX = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]): string => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance of `#rrggbb` (0 black … 1 white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The lightest the window gradient's top (70 % tint over black, ui.css) may be. At this luminance white text has about
 * 8:1 contrast, so the sidebar's secondary text (white at ≥ 80 % opacity) still clears 4.5:1.
 */
export const MAX_TOP_LUMINANCE = 0.08;

/**
 * The profile colour to tint the window with: the colour itself when white text reads on the gradient made from it,
 * else the same hue darkened just enough. Anything that is not `#rrggbb` is returned unchanged.
 */
export function readableTint(hex: string): string {
  if (!HEX.test(hex)) return hex;
  const rgb = channels(hex);
  for (let k = 1; k > 0; k -= 0.02) {
    const scaled = rgb.map((v) => Math.round(v * k)); // what is returned, so the check sees the same colour
    if (luminance(toHex(scaled.map((v) => v * 0.7))) <= MAX_TOP_LUMINANCE) return k === 1 ? hex.toLowerCase() : toHex(scaled);
  }
  return '#000000';
}

/** Text colour for a label drawn on `hex` (a profile avatar): near-black on light fills, white otherwise. */
export function textOn(hex: string): '#111111' | '#ffffff' {
  if (!HEX.test(hex)) return '#ffffff';
  return contrast('#111111', hex) > contrast('#ffffff', hex) ? '#111111' : '#ffffff';
}
