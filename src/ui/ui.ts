import type { SuperbrowserApi } from '../preload/ui.ts';
import { setupSuggestions } from './parts/suggestions.ts';
import { setupPanel } from './parts/panel.ts';
import type { DownloadState, UiState, UiTab } from '../shared/types.ts';

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
const profileBar = byId('profiles');

let current: UiState | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Address field: a click selects everything (mouseup would otherwise drop the selection).
address.addEventListener('mousedown', (e) => {
  if (document.activeElement !== address) { e.preventDefault(); address.focus(); }
});
address.addEventListener('focus', () => address.select());
const suggestions = setupSuggestions({ address, list: byId('suggest'), sb, currentUrl: () => current?.url ?? '' });
const panel = setupPanel({ sb, root: byId('panel'), tabs: byId('tabs') });
sb.onLibrary((r) => { if (r.kind === 'suggestions') suggestions.onReply(r); else panel.onReply(r); });
sb.onFocusAddress(() => { address.focus(); address.select(); });

backBtn.addEventListener('click', () => sb.send({ type: 'back' }));
forwardBtn.addEventListener('click', () => sb.send({ type: 'forward' }));
reloadBtn.addEventListener('click', () => sb.send({ type: 'reload' }));
byId('newtab').addEventListener('click', () => sb.send({ type: 'newTab' }));
byId('addprofile').addEventListener('click', () => sb.send({ type: 'addProfileMenu' }));
byId('toggle').addEventListener('click', () => sb.send({ type: 'toggleSidebar' }));

// Tab rows are kept by id and updated in place, so hover (and the × under the mouse) survives state pushes.
const tabRows = new Map<number, HTMLElement>();

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

const isImageUrl = (url: string | null): url is string => url !== null && /^(https?:|data:image\/)/i.test(url);

function setIcon(row: HTMLElement, favicon: string | null): void {
  const src = isImageUrl(favicon) ? favicon : '';
  if (row.dataset['favicon'] === src) return;
  row.dataset['favicon'] = src;
  const placeholder = () => el('span', 'icon ph');
  let icon: HTMLElement = placeholder();
  if (src) {
    const img = el('img', 'icon');
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(placeholder()));
    img.src = src;
    icon = img;
  }
  row.querySelector('.icon')!.replaceWith(icon);
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
}

// Profile pills are rebuilt only when the list itself changes, so a hovered pill doesn't collapse on every push.
let profilesKey = '';

function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function createPill(p: UiState['profiles'][number]): HTMLElement {
  const pill = el('div', 'pf');
  pill.dataset['dir'] = p.dir;
  pill.title = p.shortcut === null ? p.name : `${p.name}  (⌃${p.shortcut})`;
  const dot = el('span', 'dot', initial(p.name));
  dot.style.background = p.color;
  pill.append(dot, el('span', 'n', p.name));
  if (p.shortcut !== null) pill.append(el('span', 'k', `⌃${p.shortcut}`));
  pill.addEventListener('click', () => sb.send({ type: 'selectProfile', dir: p.dir }));
  pill.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    sb.send({ type: 'profileMenu', dir: p.dir });
  });
  return pill;
}

function renderProfiles(s: UiState): void {
  const key = JSON.stringify(s.profiles);
  if (key !== profilesKey) {
    profilesKey = key;
    profileBar.replaceChildren(...s.profiles.map(createPill));
  }
  for (const pill of Array.from(profileBar.children)) {
    if (pill instanceof HTMLElement) pill.classList.toggle('on', pill.dataset['dir'] === s.activeProfile);
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
    panel.onProfileChanged(s.activeProfile);
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
  renderProfiles(s);
  renderDownloads(s.downloads);
  if (first) requestAnimationFrame(() => document.body.classList.add('ready'));
});
