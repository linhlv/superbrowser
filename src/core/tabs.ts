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

export function fromSaved(saved: SavedTabs, nextId: () => number): ProfileTabs {
  const tabs = saved.tabs.map(({ url, title }) => ({ id: nextId(), url, title }));
  const active = tabs[Math.min(Math.max(saved.activeIndex, 0), tabs.length - 1)];
  return { tabs, activeId: active?.id ?? null, closed: [] };
}
