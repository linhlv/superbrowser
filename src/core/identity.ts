export function chromeMajor(chromeVersion: string): string {
  return chromeVersion.split('.')[0] ?? chromeVersion;
}

export function userAgent(major: string): string {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** One entry of `Sec-CH-UA` / `navigator.userAgentData.brands`. */
export type Brand = { brand: string; version: string };

export const CHROME_BRAND = 'Google Chrome';

/** Chrome's six brand-list permutations; the major version picks one (`GenerateBrandVersionList` in Chromium). */
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;

/**
 * Electron's brand list (a GREASE brand and "Chromium") with "Google Chrome" `version` added, as Chrome
 * itself builds its list: Chrome puts GREASE, Chromium and its brand in the slots `ORDERS[seed % 6]` names
 * (seed = the major version), so the result is exactly what Chrome of that version sends. Electron's GREASE
 * entry is kept as is (Chromium derives its name and version from the same seed, branded or not). A list of
 * any other shape keeps its order and gets Google Chrome appended; one that already has it is returned as is.
 */
export function withChromeBrand(brands: readonly Brand[], version: string, seed: number): Brand[] {
  const out = brands.map((b) => ({ brand: b.brand, version: b.version }));
  if (out.some((b) => b.brand === CHROME_BRAND)) return out;
  const chrome = { brand: CHROME_BRAND, version };
  const chromium = out.filter((b) => b.brand === 'Chromium');
  const grease = out.filter((b) => b.brand !== 'Chromium');
  if (chromium.length !== 1 || grease.length !== 1 || !Number.isInteger(seed) || seed < 0) return [...out, chrome];
  const order = ORDERS[seed % ORDERS.length]!;
  const slots: Brand[] = [];
  slots[order[0]] = grease[0]!;
  slots[order[1]] = chromium[0]!;
  slots[order[2]] = chrome;
  return slots;
}

const ITEM = /\s*"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"((?:[^"\\]|\\.)*)"\s*(,|$)/y;
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
const escape = (s: string) => s.replace(/[\\"]/g, '\\$&');

/** A `Sec-CH-UA`-style header (`"Brand";v="1", …`) as brands; null when it isn't one. */
export function parseBrands(header: string): Brand[] | null {
  const out: Brand[] = [];
  ITEM.lastIndex = 0;
  while (ITEM.lastIndex < header.length) {
    const m = ITEM.exec(header);
    if (!m) return null;
    out.push({ brand: unescape(m[1]!), version: unescape(m[2]!) });
    if (m[3] === ',' && ITEM.lastIndex === header.length) return null; // trailing comma
  }
  return out.length > 0 ? out : null;
}

export function formatBrands(brands: readonly Brand[]): string {
  return brands.map((b) => `"${escape(b.brand)}";v="${escape(b.version)}"`).join(', ');
}

/** Adds Google Chrome to a brand header; a value that doesn't parse keeps its text and gets the entry appended. */
function addChromeBrand(header: string, version: string, seed: number): string {
  const brands = parseBrands(header);
  if (brands === null) return `${header}, ${formatBrands([{ brand: CHROME_BRAND, version }])}`;
  return formatBrands(withChromeBrand(brands, version, seed));
}

/**
 * Electron's `Sec-CH-UA` (major versions) and `Sec-CH-UA-Full-Version-List` (full versions) with Google Chrome
 * added (`withChromeBrand`); every other header is untouched. `chromeVersion` is `process.versions.chrome`.
 */
export function rewriteClientHints(headers: Record<string, string>, chromeVersion: string): Record<string, string> {
  const major = chromeMajor(chromeVersion);
  const seed = Number(major);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'sec-ch-ua') out[name] = addChromeBrand(value, major, seed);
    else if (lower === 'sec-ch-ua-full-version-list') out[name] = addChromeBrand(value, chromeVersion, seed);
    else out[name] = value;
  }
  return out;
}
