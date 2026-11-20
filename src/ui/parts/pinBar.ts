import type { SuperbrowserApi } from '../../preload/ui.ts';
import { pinLabel } from '../../core/pins.ts';
import { keyedMoves } from '../../core/reorder.ts';
import type { UiPin, UiState } from '../../shared/types.ts';
import { el, faviconIcon, isImageUrl, markCurrent } from './dom.ts';
import { setupRowDrag } from './rowDrag.ts';

/** The tile's tooltip and accessible name: `Inbox · ACME (⌥⌘1)`. */
const tileLabel = (p: UiPin): string => (p.shortcut === null ? pinLabel(p) : `${pinLabel(p)} (⌥⌘${p.shortcut})`);

/**
 * The pinned tabs in `bar` (`#pins`, at the bar's right): one `<button class="pin">` per shown pin, kept by key and
 * updated in place (like the pills), so a hovered tile keeps its element across pushes. A click goes to the pin's
 * profile and tab (main picks the tab); right-click opens its menu (Unpin, Move Left/Right). Drag a tile to reorder it
 * (rowDrag.ts), like the pills; the click that ends a drag doesn't open the pin.
 */
export function setupPinBar(opts: { bar: HTMLElement; sb: SuperbrowserApi }): { render(s: UiState): void } {
  const { bar, sb } = opts;
  const tiles = new Map<string, HTMLElement>();
  let pinsKey = '';
  let order = '';
  // Releasing anywhere in the bottom bar drops; releasing above it cancels.
  const pinDrag = setupRowDrag({
    list: bar, scroller: bar, zone: bar.parentElement ?? bar, axis: 'x', itemClass: 'pin',
    keyOf: (tile) => tile.dataset['key'] ?? '',
    drop: (key, before) => sb.send({ type: 'reorderPin', key, before }),
  });

  function createTile(key: string): HTMLElement {
    const tile = el('button', 'pin');
    tile.type = 'button';
    tile.dataset['key'] = key;
    tile.append(el('span', 'icon ph'), el('span', 'pin-dot'));
    tile.addEventListener('click', () => sb.send({ type: 'selectPin', key }));
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sb.send({ type: 'pinMenu', key });
    });
    tiles.set(key, tile);
    return tile;
  }

  function updateTile(tile: HTMLElement, p: UiPin): void {
    const label = tileLabel(p);
    if (tile.title !== label) tile.title = label;
    tile.setAttribute('aria-label', label);
    const src = isImageUrl(p.favicon) ? p.favicon : '';
    if (tile.dataset['favicon'] !== src) {
      tile.dataset['favicon'] = src;
      tile.querySelector('.icon')!.replaceWith(faviconIcon(src));
    }
    tile.querySelector<HTMLElement>('.pin-dot')!.style.background = p.color;
    markCurrent(tile, p.active);
  }

  function render(s: UiState): void {
    const key = JSON.stringify(s.pins);
    if (key === pinsKey) return;
    pinsKey = key;
    const nextOrder = s.pins.map((p) => p.key).join('\n');
    if (nextOrder !== order) pinDrag.cancel(); // its measurements are stale once a tile comes, goes or moves
    order = nextOrder;
    const keys = new Set(s.pins.map((p) => p.key));
    for (const [k, tile] of tiles) {
      if (!keys.has(k)) { tile.remove(); tiles.delete(k); }
    }
    for (const p of s.pins) updateTile(tiles.get(p.key) ?? createTile(p.key), p);
    const current = Array.from(bar.children, (c) => (c as HTMLElement).dataset['key'] ?? '');
    // Moving an element drops its hover: the hovered tile stays put and the others move around it.
    const keep = bar.querySelector<HTMLElement>(':scope > .pin:hover')?.dataset['key'] ?? null;
    for (const { key: k, before } of keyedMoves(current, s.pins.map((p) => p.key), keep)) {
      bar.insertBefore(tiles.get(k)!, before === null ? null : tiles.get(before)!);
    }
  }

  return { render };
}
