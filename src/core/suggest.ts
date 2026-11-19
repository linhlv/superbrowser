// Address-bar suggestion ranking and inline completion. Pure; imports types only.

import type { Suggestion } from '../shared/types.ts';
import type { HistoryEntry } from './history.ts';
import { DAY_MS, matchesAll, searchKey, splitWords } from './searchText.ts';

export const SUGGESTION_LIMIT = 6;

const RETENTION_DAYS = 90; // = HISTORY_RETENTION_DAYS in chromeLibrary.ts; recency fades to 0 over it
const TYPED_WEIGHT = 2;
const RECENCY_WEIGHT = 3;
const HOST_PREFIX_BONUS = 5;
const BOOKMARK_BONUS = 1.5;

type Row = { url: string; title: string; visitCount: number; typedCount: number; lastVisit: number; bookmarked: boolean };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function score(row: Row, firstWord: string, now: number): number {
  const ageDays = Math.max(0, (now - row.lastVisit) / DAY_MS);
  const recency = row.visitCount > 0 ? Math.max(0, 1 - ageDays / RETENTION_DAYS) : 0;
  let s = Math.log2(1 + row.visitCount) + TYPED_WEIGHT * Math.log2(1 + row.typedCount) + RECENCY_WEIGHT * recency;
  if (hostOf(row.url).startsWith(firstWord)) s += HOST_PREFIX_BONUS;
  if (row.bookmarked) s += BOOKMARK_BONUS;
  return s;
}

export function rankSuggestions(input: {
  text: string;
  history: HistoryEntry[];
  bookmarks: { url: string; title: string }[];
  now: number;
  limit?: number;
}): Suggestion[] {
  const words = splitWords(input.text);
  if (words.length === 0) return [];
  const matches = (url: string, title: string) => matchesAll(searchKey(url + ' ' + title), words);

  const rows = new Map<string, Row>();
  for (const h of input.history) {
    if (!matches(h.url, h.title)) continue;
    rows.set(h.url, { url: h.url, title: h.title, visitCount: h.visitCount, typedCount: h.typedCount, lastVisit: h.lastVisit, bookmarked: false });
  }
  for (const b of input.bookmarks) {
    if (!matches(b.url, b.title)) continue;
    const row = rows.get(b.url);
    if (row) {
      row.bookmarked = true;
      if (row.title === '') row.title = b.title;
    } else {
      rows.set(b.url, { url: b.url, title: b.title, visitCount: 0, typedCount: 0, lastVisit: 0, bookmarked: true });
    }
  }

  const scored = [...rows.values()].map((row) => ({ row, s: score(row, words[0]!, input.now) }));
  scored.sort((a, b) => b.s - a.s || b.row.visitCount - a.row.visitCount || (a.row.url < b.row.url ? -1 : a.row.url > b.row.url ? 1 : 0));
  return scored.slice(0, input.limit ?? SUGGESTION_LIMIT).map(({ row }) => ({ url: row.url, title: row.title, bookmarked: row.bookmarked }));
}

/** `text`: the URL without scheme or trailing '/', host lowercased, path and query as stored; `key`: `text` lowercased. */
type Stripped = { entry: HistoryEntry; text: string; key: string; host: string };

function better(a: Stripped, b: Stripped): boolean {
  return (
    a.entry.visitCount - b.entry.visitCount ||
    a.entry.typedCount - b.entry.typedCount ||
    a.entry.lastVisit - b.entry.lastVisit
  ) > 0;
}

function best(list: Stripped[]): Stripped | undefined {
  let top: Stripped | undefined;
  for (const x of list) if (!top || better(x, top)) top = x;
  return top;
}

/**
 * The full text the address field should show for `text`, or null: no scheme, no trailing '/'. Matching
 * ignores case; the host comes back lowercase and the path and query as stored (they can be case-sensitive).
 */
export function inlineCompletion(text: string, history: HistoryEntry[]): string | null {
  if (text === '' || /\s/.test(text) || text.includes('://')) return null;
  const typed = text.toLowerCase();
  const keepWww = typed.startsWith('www.');

  const all: Stripped[] = [];
  for (const entry of history) {
    if (!/^https?:\/\//i.test(entry.url)) continue;
    const rest = entry.url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const hostEnd = rest.search(/[/?#]/);
    let host = (hostEnd < 0 ? rest : rest.slice(0, hostEnd)).toLowerCase();
    if (!keepWww) host = host.replace(/^www\./, '');
    const text = host + (hostEnd < 0 ? '' : rest.slice(hostEnd));
    all.push({ entry, text, key: text.toLowerCase(), host });
  }

  let completion: string | undefined;
  if (typed.includes('/')) {
    completion = best(all.filter((x) => x.key.startsWith(typed)))?.text;
  } else {
    const top = best(all.filter((x) => x.host.startsWith(typed)));
    if (top) {
      const sameHost = all.filter((x) => x.host === top.host);
      completion = sameHost.some((x) => x.text === top.host) ? top.host : best(sameHost)!.text;
    }
  }
  return completion === undefined || completion.toLowerCase() === typed ? null : completion;
}
