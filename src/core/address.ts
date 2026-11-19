const SCHEME = /^(?:https?|file|about|data|view-source):/i;
const LOCALHOST = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;

export function toNavigableUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (SCHEME.test(text)) return text;
  if (!/\s/.test(text)) {
    if (LOCALHOST.test(text) || IPV4.test(text)) return `http://${text}`;
    if (DOMAIN.test(text)) return `https://${text}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
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
