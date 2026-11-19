import type { SuperbrowserApi } from '../preload/ui.ts';
import { setupSuggestions } from './parts/suggestions.ts';
import { setupBookmarksSection } from './parts/bookmarksSection.ts';
import { setupHistorySection } from './parts/historySection.ts';
import { setupProfileBar } from './parts/profileBar.ts';
import { el, faviconIcon, isImageUrl } from './parts/dom.ts';
import type { DownloadState, Section, UiState, UiTab } from '../shared/types.ts';

declare global {
  interface Window { superbrowser: SuperbrowserApi }
}

const sb = window.superbrowser;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const address = byId<HTMLInputElement>('address');
const backBtn = byId<HTMLButtonElement>('back');
const forwardBtn = byId<HTMLButtonElement>('forward');
const reloadBtn = byId<HTMLButtonElement>('reload');
const tabList = byId('tablist');

let current: UiState | null = null;

// Address field: a click selects everything (mouseup would otherwise drop the selection).
address.addEventListener('mousedown', (e) => {
  if (document.activeElement !== address) { e.preventDefault(); address.focus(); }
});
address.addEventListener('focus', () => address.select());
const suggestions = setupSuggestions({ address, list: byId('suggest'), sb, currentUrl: () => current?.url ?? '' });
sb.onFocusAddress(() => { address.focus(); address.select(); });

// Bookmarks and History: collapsible sections right under the tabs, always in that order. Opening or folding one changes
// only layout (the tab rows stay as they are); a folded section asks the library for nothing.
const bookmarks = setupBookmarksSection({ sb, root: byId('sec-bookmarks') });
const history = setupHistorySection({ sb, root: byId('sec-history') });
const sections = {
  bookmarks: { root: byId('sec-bookmarks'), handle: bookmarks },
  history: { root: byId('sec-history'), handle: history },
};
// Main's saved openSections apply once, from the first state (which already reflects any panel request main sent
// before it); after a header click only clicks and panel requests decide, and main records both (later pushes may
// carry a value from before a click).
let sectionsSettled = false;

function setSection(section: Section, open: boolean): void {
  const { root, handle } = sections[section];
  root.classList.toggle('open', open);
  root.querySelector('.sec-a')!.textContent = open ? '▾' : '▸';
  handle.setOpen(open);
}

for (const section of ['bookmarks', 'history'] as const) {
  sections[section].root.querySelector('.sec-h')!.addEventListener('click', () => {
    sectionsSettled = true;
    const open = !sections[section].root.classList.contains('open');
    setSection(section, open);
    sb.send({ type: 'setSectionOpen', section, open });
    if (open) sections[section].handle.focusSearch();
  });
}

sb.onPanel((req) => {
  setSection(req.panel, req.open);
  if (!req.open) return;
  sections[req.panel].handle.focusSearch();
  if (req.panel === 'bookmarks' && req.highlight !== null) bookmarks.reveal(req.highlight);
});
sb.onLibrary((r) => {
  if (r.kind === 'suggestions') suggestions.onReply(r);
  else { bookmarks.onReply(r); history.onReply(r); }
});
sb.onLibraryChanged(() => { bookmarks.onLibraryChanged(); history.onLibraryChanged(); });
sb.onHistoryRecorded(() => history.onHistoryRecorded());
sb.onStartRename((id) => bookmarks.startRename(id));

// Profile pills: switch on click, reorder by drag, menu on right-click, display name edited in place.
const profileBar = setupProfileBar({ bar: byId('profiles'), sb });
sb.onEditProfileName((dir) => profileBar.startEdit(dir));

backBtn.addEventListener('click', () => sb.send({ type: 'back' }));
forwardBtn.addEventListener('click', () => sb.send({ type: 'forward' }));
reloadBtn.addEventListener('click', () => sb.send({ type: 'reload' }));
byId('newtab').addEventListener('click', () => sb.send({ type: 'newTab' }));
byId('addprofile').addEventListener('click', () => sb.send({ type: 'addProfileMenu' }));
byId('toggle').addEventListener('click', () => sb.send({ type: 'toggleSidebar' }));

// Tab rows are kept by id and updated in place, so hover (and the × under the mouse) survives state pushes.
const tabRows = new Map<number, HTMLElement>();
let scrolledToTab: number | null = null; // the active tab last scrolled into view

/** Keeps the active tab's row visible in the (possibly capped) tab list. */
function revealActiveTab(): void {
  const id = current?.activeTabId ?? null;
  if (id !== null) tabRows.get(id)?.scrollIntoView({ block: 'nearest' });
}
// The list's height changes when a section opens or folds, the window resizes or the sidebar is shown again.
new ResizeObserver(revealActiveTab).observe(byId('tabs'));

function createTabRow(id: number): HTMLElement {
  const row = el('div', 'tab');
  const close = el('button', 'x', '×');
  close.title = 'Close Tab';
  row.append(el('span', 'icon ph'), el('span', 't'), close);
  row.addEventListener('click', () => sb.send({ type: 'selectTab', id }));
  close.addEventListener('click', (e) => { e.stopPropagation(); sb.send({ type: 'closeTab', id }); });
  tabRows.set(id, row);
  return row;
}

function setIcon(row: HTMLElement, favicon: string | null): void {
  const src = isImageUrl(favicon) ? favicon : '';
  if (row.dataset['favicon'] === src) return;
  row.dataset['favicon'] = src;
  row.querySelector('.icon')!.replaceWith(faviconIcon(src));
}

function updateTabRow(row: HTMLElement, tab: UiTab, active: boolean): void {
  row.classList.toggle('on', active);
  setIcon(row, tab.favicon);
  const label = tab.title || tab.url || 'New Tab';
  const text = (tab.loading ? '⋯ ' : '') + label;
  const t = row.querySelector('.t')!;
  if (t.textContent !== text) t.textContent = text;
  if (row.title !== label) row.title = label;
}

function renderTabs(s: UiState): void {
  const seen = new Set<number>();
  let prev: Element | null = null;
  for (const tab of s.tabs) {
    const row = tabRows.get(tab.id) ?? createTabRow(tab.id);
    updateTabRow(row, tab, tab.id === s.activeTabId);
    const expected: Element | null = prev ? prev.nextElementSibling : tabList.firstElementChild;
    if (expected !== row) tabList.insertBefore(row, expected);
    prev = row;
    seen.add(tab.id);
  }
  for (const [id, row] of tabRows) {
    if (!seen.has(id)) { row.remove(); tabRows.delete(id); }
  }
  if (s.activeTabId !== scrolledToTab) { // a tab switch, ⌘T or a profile change; not every push
    scrolledToTab = s.activeTabId;
    revealActiveTab(); // `current` is already `s`
  }
}

// Download rows are kept by id too; newest first. A click shows the file in Finder.
const downloadsSection = byId('downloads');
const downloadList = byId('dllist');
const downloadRows = new Map<string, HTMLElement>();

function createDownloadRow(id: string): HTMLElement {
  const row = el('div', 'dl');
  row.append(el('div', 'f'), el('progress', ''), el('div', 's'));
  row.addEventListener('click', () => sb.send({ type: 'revealDownload', id }));
  downloadRows.set(id, row);
  return row;
}

const downloadStatus = (d: DownloadState): string =>
  d.state === 'cancelled' ? 'Cancelled' : d.state === 'interrupted' ? 'Failed' : '';

function updateDownloadRow(row: HTMLElement, d: DownloadState): void {
  const name = row.querySelector('.f')!;
  if (name.textContent !== d.filename) name.textContent = d.filename;
  row.title = d.state === 'completed' ? 'Show in Finder' : d.filename;
  const bar = row.querySelector('progress')!;
  bar.hidden = d.state !== 'progressing';
  if (d.total > 0) { bar.max = d.total; bar.value = d.received; } else bar.removeAttribute('value'); // size unknown: indeterminate
  row.querySelector('.s')!.textContent = downloadStatus(d);
}

function renderDownloads(list: DownloadState[]): void {
  downloadsSection.hidden = list.length === 0;
  const newestFirst = [...list].reverse();
  const seen = new Set<string>();
  let prev: Element | null = null;
  for (const d of newestFirst) {
    const row = downloadRows.get(d.id) ?? createDownloadRow(d.id);
    updateDownloadRow(row, d);
    const expected: Element | null = prev ? prev.nextElementSibling : downloadList.firstElementChild;
    if (expected !== row) downloadList.insertBefore(row, expected);
    prev = row;
    seen.add(d.id);
  }
  for (const [id, row] of downloadRows) {
    if (!seen.has(id)) { row.remove(); downloadRows.delete(id); }
  }
}

sb.onState((s) => {
  const first = current === null;
  if (current !== null && current.activeProfile !== s.activeProfile) {
    suggestions.close();
    bookmarks.onProfileChanged();
    history.onProfileChanged();
  }
  current = s;
  document.body.classList.toggle('collapsed', !s.sidebarVisible);
  document.body.classList.toggle('names', s.showNames);
  const color = s.profiles.find((p) => p.dir === s.activeProfile)?.color;
  if (color) document.body.style.setProperty('--tint', color);

  if (document.activeElement !== address) address.value = s.url;
  backBtn.disabled = !s.canGoBack;
  forwardBtn.disabled = !s.canGoForward;
  reloadBtn.disabled = s.activeTabId === null;
  renderTabs(s);
  profileBar.render(s);
  renderDownloads(s.downloads);
  if (!sectionsSettled) {
    sectionsSettled = true;
    for (const section of ['bookmarks', 'history'] as const) setSection(section, s.openSections.includes(section));
  }
  if (first) requestAnimationFrame(() => document.body.classList.add('ready'));
});
