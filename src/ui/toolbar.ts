import type { SuperbrowserApi } from '../preload/ui.ts';
import { setupSuggestions } from './parts/suggestions.ts';
import { fillIcons, icon } from './parts/icons.ts';
import type { UiState } from '../shared/types.ts';

declare global {
  interface Window { superbrowser: SuperbrowserApi }
}

/**
 * The toolbar view above the page: back, forward, reload and the address field with its suggestions. It is its own
 * view (like the find bar) so the suggestions card can drop down over the page: while the card shows, the view asks
 * main to grow to fit it, and shrinks back to the strip when it closes.
 */
const sb = window.superbrowser;
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const address = byId<HTMLInputElement>('address');
const list = byId('suggest');
const backBtn = byId<HTMLButtonElement>('back');
const forwardBtn = byId<HTMLButtonElement>('forward');
const reloadBtn = byId<HTMLButtonElement>('reload');
const starBtn = byId<HTMLButtonElement>('star');

let current: UiState | null = null;
fillIcons(document);

/** Room below the card for its shadow (0 8px 24px blur). */
const SHADOW_PX = 32;
let sentHeight = 0;
/**
 * Tells main how tall the view must be: 0 (just the strip) with the card closed, else down to the card's shadow. While
 * a keystroke's reply is pending the card is hidden but this isn't called, so the view keeps its size meanwhile.
 */
function reportHeight(): void {
  const height = list.hidden ? 0 : Math.ceil(list.getBoundingClientRect().bottom) + SHADOW_PX;
  if (height === sentHeight) return;
  sentHeight = height;
  sb.send({ type: 'toolbarHeight', height });
}

// A click selects everything (mouseup would otherwise drop the selection).
address.addEventListener('mousedown', (e) => {
  if (document.activeElement !== address) { e.preventDefault(); address.focus(); }
});
address.addEventListener('focus', () => address.select());
const suggestions = setupSuggestions({ address, list, sb, currentUrl: () => current?.url ?? '', onToggle: reportHeight });
sb.onFocusAddress(() => { address.focus(); address.select(); });
sb.onLibrary((r) => { if (r.kind === 'suggestions') suggestions.onReply(r); });

// While the card is open the view covers part of the page, transparent except the strip and the card. A left press on
// that transparent part closes the card (the field's blur does) and is passed on to the page, as in Chrome.
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || (e.target !== document.body && e.target !== document.documentElement)) return;
  sb.send({ type: 'toolbarClickThrough', x: Math.round(e.clientX), y: Math.round(e.clientY) });
});

backBtn.addEventListener('click', () => sb.send({ type: 'back' }));
forwardBtn.addEventListener('click', () => sb.send({ type: 'forward' }));
reloadBtn.addEventListener('click', () => sb.send({ type: 'reload' }));
// Bookmarks the page, or (filled) removes its bookmarks. A press must not take focus from the field being edited.
starBtn.addEventListener('mousedown', (e) => e.preventDefault());
starBtn.addEventListener('click', () => sb.send({ type: 'toggleBookmark' }));

function setStar(s: UiState): void {
  starBtn.hidden = !s.canBookmark;
  const state = s.bookmarked ? 'on' : 'off';
  if (starBtn.dataset['state'] === state) return;
  starBtn.dataset['state'] = state;
  starBtn.classList.toggle('on', s.bookmarked);
  starBtn.replaceChildren(icon('star', s.bookmarked));
  starBtn.title = s.bookmarked ? 'Remove Bookmark' : 'Bookmark This Page ⌘D';
  starBtn.setAttribute('aria-label', s.bookmarked ? 'Remove bookmark' : 'Bookmark this page');
  starBtn.setAttribute('aria-pressed', String(s.bookmarked));
}

sb.onState((s) => {
  if (current !== null && current.activeProfile !== s.activeProfile) suggestions.close();
  current = s;
  if (document.activeElement !== address) address.value = s.url;
  backBtn.disabled = !s.canGoBack;
  forwardBtn.disabled = !s.canGoForward;
  reloadBtn.disabled = s.activeTabId === null;
  setStar(s);
});
