import { chromeBrands, formatBrands, rewriteClientHints } from './identity.ts';

/**
 * Client hints like Chrome's. Electron sends `Sec-CH-UA` and friends only with a page's own requests, not when a
 * page is loaded, and ignores `Accept-CH`, so it never sends the high-entropy hints. A Chrome UA without them is a
 * tell (Google's sign-in rejects such browsers), so the session adds them as Chrome would.
 */

/** The values the hints carry; the same ones `navigator.userAgentData.getHighEntropyValues` gives pages. */
export type HintValues = { major: string; fullVersion: string; platformVersion: string; arch: string; bitness: string };

/** The high-entropy hints Chrome sends once an origin asks for them with `Accept-CH`. */
export const HIGH_ENTROPY: readonly string[] = [
  'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version-list', 'sec-ch-ua-model',
  'sec-ch-ua-platform-version', 'sec-ch-ua-wow64', 'sec-ch-ua-form-factors',
];

/** The high-entropy hint names an `Accept-CH` value asks for (lower-cased; others ignored). */
export function parseAcceptCh(value: string): string[] {
  return value.split(',').map((h) => h.trim().toLowerCase()).filter((h) => HIGH_ENTROPY.includes(h));
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Chrome sends client hints only to secure origins: https, and http on the local host. */
export function isSecureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
  } catch {
    return false;
  }
}

/** macOS's version as Chrome reports it: three parts (`27.3` → `27.3.0`). */
export function platformVersion(systemVersion: string): string {
  const parts = systemVersion.split('.');
  while (parts.length < 3) parts.push('0');
  return parts.join('.');
}

/** Chrome's language list from the system's: each language, then its base language if not listed yet. */
export function acceptLanguages(tags: readonly string[]): string {
  const out: string[] = [];
  const add = (t: string) => { if (t && !out.includes(t)) out.push(t); };
  for (const tag of tags.length > 0 ? tags : ['en-US']) {
    add(tag);
    add(tag.split('-')[0] ?? '');
  }
  return out.join(',');
}

const has = (headers: Record<string, string>, name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name);

/**
 * A request's headers with Chrome's client hints: Electron's `Sec-CH-UA` rewritten to name Google Chrome
 * (`rewriteClientHints`), then, for a secure URL, the low-entropy three when missing and each high-entropy hint the
 * origin asked for (`requested`, from its `Accept-CH`).
 */
export function withClientHints(
  headers: Record<string, string>, url: string, v: HintValues, requested: ReadonlySet<string>,
): Record<string, string> {
  const out = rewriteClientHints(headers, v.fullVersion);
  if (!isSecureUrl(url)) return out;
  const values: Record<string, string> = {
    'sec-ch-ua': formatBrands(chromeBrands(v.major, v.major)),
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-arch': `"${v.arch}"`,
    'sec-ch-ua-bitness': `"${v.bitness}"`,
    'sec-ch-ua-full-version-list': formatBrands(chromeBrands(v.major, v.fullVersion)),
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform-version': `"${v.platformVersion}"`,
    'sec-ch-ua-wow64': '?0',
    'sec-ch-ua-form-factors': '"Desktop"',
  };
  const wanted = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', ...HIGH_ENTROPY.filter((h) => requested.has(h))];
  for (const name of wanted) {
    if (!has(out, name)) out[name] = values[name]!;
  }
  return out;
}
