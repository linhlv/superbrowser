const SCHEME = /^(?:https?|file|about|data|view-source):/i;
const LOCALHOST = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

/** The Google search URL for `text`, whatever it looks like. */
export function googleSearchUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text.trim())}`;
}

export function toNavigableUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (SCHEME.test(text)) return text;
  if (!/\s/.test(text)) {
    if (LOCALHOST.test(text) || IPV4.test(text)) return `http://${text}`;
    if (DOMAIN.test(text)) return `https://${text}`;
  }
  return googleSearchUrl(text);
}

/** True for http(s) URLs that `new URL` parses (the only ones bookmarks and history store). */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Both are web pages of the same origin (scheme, host and port). */
export function sameOrigin(a: string, b: string): boolean {
  if (!isWebUrl(a) || !isWebUrl(b)) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
