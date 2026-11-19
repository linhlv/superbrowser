import { isWebUrl } from './address.ts';

export const HISTORY_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000; // 1601-01-01 to 1970-01-01

export type ChromeNode =
  | { kind: 'url'; title: string; url: string; added: number }
  | { kind: 'folder'; title: string; added: number; children: ChromeNode[] };
export type ChromeBookmarks = { bar: ChromeNode[]; other: ChromeNode[]; mobile: ChromeNode[] };
/** `visit_time` is µs since 1601, as text (so no precision is lost). */
export type ChromeVisitRow = { url: string; title: string; typed_count: number; hidden: number; visit_time: string };
/** `time` is ms since 1970. */
export type ImportVisit = { url: string; title: string; typedCount: number; time: number };
/** `failed`: a Chrome file was there but couldn't be read (a missing file isn't a failure). */
export type LibraryImportResult = {
  bookmarks: { added: number; skipped: number; failed: boolean };
  history: { pages: number; added: number; skipped: number; failed: boolean };
};

/** Chrome time (µs since 1601) to ms since 1970. Junk or non-positive input gives 0. */
export function chromeTimeToMs(t: string | number): number {
  try {
    const us = typeof t === 'number' ? BigInt(Math.trunc(t)) : BigInt(t.trim());
    if (us <= 0n) return 0;
    return Math.max(0, Number(us / 1000n) - CHROME_EPOCH_OFFSET_MS);
  } catch {
    return 0;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseNodes(list: unknown): ChromeNode[] {
  if (!Array.isArray(list)) return [];
  const out: ChromeNode[] = [];
  for (const r of list) {
    if (!isRecord(r)) continue;
    const title = typeof r.name === 'string' ? r.name : '';
    const rawAdded = typeof r.date_added === 'string' || typeof r.date_added === 'number' ? r.date_added : '0';
    const added = chromeTimeToMs(rawAdded);
    if (r.type === 'folder') out.push({ kind: 'folder', title, added, children: parseNodes(r.children) });
    else if (r.type === 'url' && typeof r.url === 'string') out.push({ kind: 'url', title, url: r.url, added });
  }
  return out;
}

/** Parses Chrome's `Bookmarks` / `AccountBookmarks` JSON. Null only when the text isn't a JSON object. */
export function parseChromeBookmarks(text: string): ChromeBookmarks | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isRecord(raw)) return null;
  const roots = isRecord(raw.roots) ? raw.roots : {};
  const children = (k: string) => parseNodes(isRecord(roots[k]) ? roots[k].children : undefined);
  return { bar: children('bookmark_bar'), other: children('other'), mobile: children('synced') };
}

/** Maps Chrome history rows to visits; drops hidden, non-web, untimed and too-old ones (counted in `skipped`). */
export function mapChromeVisits(rows: ChromeVisitRow[], nowMs: number, retentionDays = HISTORY_RETENTION_DAYS): { visits: ImportVisit[]; skipped: number } {
  const oldest = nowMs - retentionDays * DAY_MS;
  const visits: ImportVisit[] = [];
  let skipped = 0;
  for (const r of rows) {
    const time = chromeTimeToMs(r.visit_time);
    if (r.hidden !== 0 || typeof r.url !== 'string' || !isWebUrl(r.url) || time <= 0 || time < oldest) { skipped++; continue; }
    visits.push({ url: r.url, title: typeof r.title === 'string' ? r.title : '', typedCount: r.typed_count, time });
  }
  return { visits, skipped };
}

/**
 * "Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped)." A part that couldn't be read is
 * named instead of counted: "Personal: 175 bookmarks imported; history couldn't be read — try again."
 */
export function librarySummaryLine(profileName: string, r: LibraryImportResult): string {
  const n = (v: number) => v.toLocaleString('en-US');
  const b = r.bookmarks.added;
  const p = r.history.pages;
  // Failed bookmarks are still counted when one of Bookmarks/AccountBookmarks was read. Failed history read nothing.
  const someBookmarks = b + r.bookmarks.skipped > 0;
  const counted: string[] = [];
  if (!r.bookmarks.failed || someBookmarks) counted.push(`${n(b)} ${b === 1 ? 'bookmark' : 'bookmarks'}`);
  if (!r.history.failed) counted.push(`${n(p)} ${p === 1 ? 'page' : 'pages'} of history`);
  const unread: string[] = [];
  if (r.bookmarks.failed) unread.push(someBookmarks ? 'some bookmarks' : 'bookmarks');
  if (r.history.failed) unread.push('history');
  const skipped = r.bookmarks.skipped + r.history.skipped;
  const imported = counted.length === 0 ? '' : `${counted.join(', ')} imported` + (skipped > 0 ? ` (${n(skipped)} skipped)` : '');
  const failed = unread.length === 0 ? '' : `${unread.join(' and ')} couldn't be read — try again.`;
  if (!failed) return `${profileName}: ${imported}.`;
  return `${profileName}: ${imported ? `${imported}; ` : ''}${failed}`;
}

/**
 * The sheet after importing every profile's bookmarks and history; `null` is a profile whose import threw.
 * A warning when anything failed; the title says nothing was imported when every profile failed outright.
 */
export function libraryImportOutcome(results: (LibraryImportResult | null)[]): { warning: boolean; title: string } {
  const failedOutright = (r: LibraryImportResult | null) =>
    r === null || (r.bookmarks.failed && r.history.failed && r.bookmarks.added === 0 && r.history.added === 0);
  const warning = results.some((r) => r === null || r.bookmarks.failed || r.history.failed);
  const title = results.length > 0 && results.every(failedOutright)
    ? 'No bookmarks or history were imported.'
    : 'Imported bookmarks and history from Chrome.';
  return { warning, title };
}
