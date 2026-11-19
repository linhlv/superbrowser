import type { SavedTabs } from './appState.ts';

export type TabRecord = { id: number; url: string; title: string };
/** `closed`: most recently closed last, at most `MAX_CLOSED`. */
export type ProfileTabs = { tabs: TabRecord[]; activeId: number | null; closed: TabRecord[] };

const MAX_CLOSED = 25;

export function emptyTabs(): ProfileTabs {
  return { tabs: [], activeId: null, closed: [] };
}

/** With `afterId`, inserts right after that tab; otherwise (or if it is unknown) appends. */
export function openTab(s: ProfileTabs, tab: TabRecord, opts: { activate: boolean; afterId?: number }): ProfileTabs {
  const after = opts.afterId === undefined ? -1 : s.tabs.findIndex((x) => x.id === opts.afterId);
  const at = after === -1 ? s.tabs.length : after + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  return { ...s, tabs, activeId: opts.activate ? tab.id : s.activeId };
}

/** Closing the active tab activates its right neighbour, else its left, else nothing. */
export function closeTab(s: ProfileTabs, id: number): ProfileTabs {
  const i = s.tabs.findIndex((x) => x.id === id);
  if (i === -1) return s;
  const tabs = s.tabs.filter((x) => x.id !== id);
  const activeId = s.activeId !== id ? s.activeId : (tabs[i] ?? tabs[i - 1])?.id ?? null;
  const closed = [...s.closed, s.tabs[i]!].slice(-MAX_CLOSED);
  return { tabs, activeId, closed };
}

/** Re-adds the most recently closed tab at the end, activated. */
export function reopenClosed(s: ProfileTabs): { state: ProfileTabs; tab: TabRecord } | null {
  const tab = s.closed.at(-1);
  if (!tab) return null;
  return { state: { tabs: [...s.tabs, tab], activeId: tab.id, closed: s.closed.slice(0, -1) }, tab };
}

export function activateTab(s: ProfileTabs, id: number): ProfileTabs {
  return s.tabs.some((x) => x.id === id) ? { ...s, activeId: id } : s;
}

export function updateTab(s: ProfileTabs, id: number, patch: Partial<Pick<TabRecord, 'url' | 'title'>>): ProfileTabs {
  return { ...s, tabs: s.tabs.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

/** Chrome's ⌘1–⌘8 pick a position, ⌘9 the last tab. */
export function tabIdForShortcut(s: ProfileTabs, n: number): number | null {
  const tab = n === 9 ? s.tabs.at(-1) : s.tabs[n - 1];
  return tab?.id ?? null;
}

export function toSaved(s: ProfileTabs): SavedTabs {
  const i = s.tabs.findIndex((x) => x.id === s.activeId);
  return { tabs: s.tabs.map(({ url, title }) => ({ url, title })), activeIndex: Math.max(i, 0) };
}

/** True when saving `b` would write the same tabs as `a`: per profile the same urls, titles, order and active tab. */
export function sameSavedTabs(a: Record<string, SavedTabs>, b: Record<string, SavedTabs>): boolean {
  const dirs = Object.keys(a);
  if (dirs.length !== Object.keys(b).length) return false;
  return dirs.every((dir) => {
    const x = a[dir]!, y = b[dir];
    return y !== undefined && x.activeIndex === y.activeIndex && x.tabs.length === y.tabs.length
      && x.tabs.every((t, i) => t.url === y.tabs[i]!.url && t.title === y.tabs[i]!.title);
  });
}

export function fromSaved(saved: SavedTabs, nextId: () => number): ProfileTabs {
  const tabs = saved.tabs.map(({ url, title }) => ({ id: nextId(), url, title }));
  const active = tabs[Math.min(Math.max(saved.activeIndex, 0), tabs.length - 1)];
  return { tabs, activeId: active?.id ?? null, closed: [] };
}

/** What every view or window showing a profile's pages gets besides its session (see `pageWebPreferences`). */
export const PAGE_WEB_PREFERENCES = { sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true } as const;

/**
 * A popup (`window.open` with features, e.g. "Sign in with Google") is a small window in the opener's
 * profile: same partition (so same cookies, UA and frame preloads), same page preferences as a tab.
 */
export function popupWindowOptions(dir: string): {
  width: number; height: number;
  webPreferences: { partition: string } & typeof PAGE_WEB_PREFERENCES;
} {
  return { width: 520, height: 680, webPreferences: { partition: 'persist:' + dir, ...PAGE_WEB_PREFERENCES } };
}

/**
 * A popup's window title: the host of the page it shows now (punycode for IDN hosts, as the URL API gives it;
 * a blob: URL's origin host), then the page title and the profile — a page can't pose as another site or profile.
 */
export function popupTitle(url: string, pageTitle: string, profileName: string): string {
  let host = '';
  try {
    const u = new URL(url);
    host = u.protocol === 'blob:' ? new URL(u.pathname).host : u.host;
  } catch {
    // not a URL with a host: shown as is below
  }
  const where = host || url.slice(0, 100) || 'about:blank';
  return `${where}${pageTitle ? ` — ${pageTitle}` : ''} (${profileName})`;
}

export type OpenDisposition = 'default' | 'foreground-tab' | 'background-tab' | 'new-window' | 'other';
export type OpenTarget = { kind: 'tab'; activate: boolean } | { kind: 'popup' } | { kind: 'deny' };

/**
 * Where a page's `window.open` / target=_blank / ⌘-click goes. Links become tabs next to their opener
 * (⌘-click: in the background). `window.open` with features, a blank window its opener will fill in, and a
 * blob: URL (the page's own data, e.g. a PDF invoice; it must load from the page, since the page may revoke it
 * right after) become popups. Popups keep `window.opener`. Only http(s), blob: and about:blank may open.
 */
export function windowOpenTarget(d: { url: string; disposition: OpenDisposition; features: string }): OpenTarget {
  const blank = d.url === '' || d.url === 'about:blank';
  const blob = /^blob:/i.test(d.url);
  if (!blank && !blob && !/^https?:\/\//i.test(d.url)) return { kind: 'deny' };
  if (blank || blob || (d.disposition === 'new-window' && d.features.trim() !== '')) return { kind: 'popup' };
  return { kind: 'tab', activate: d.disposition !== 'background-tab' };
}

/** A link the context menu may open in a new tab: a web page, or the page's own blob: data (same partition). */
export function isOpenableLink(url: string): boolean {
  return /^(?:https?:\/\/|blob:)/i.test(url);
}
