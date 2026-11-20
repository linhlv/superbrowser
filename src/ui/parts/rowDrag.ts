import { dropBefore, dropIndex, slotShift } from '../../core/dragOrder.ts';
import { keyedMoves } from '../../core/reorder.ts';

/** Movement (px) along the axis before a press on an item becomes a drag; below it the click acts as usual. */
const DRAG_THRESHOLD_PX = 4;
/** While dragging within this distance of the scroller's start or end edge, an overflowing list scrolls… */
const EDGE_PX = 24;
/** …by this much per animation frame. */
const EDGE_SCROLL_PX = 6;

export type RowDragOptions = {
  /** The items' parent. It gets the `dragging` class during a drag. */
  list: HTMLElement;
  /** What scrolls along the axis when the items overflow: `list` itself, or an ancestor of it. */
  scroller: HTMLElement;
  /** Releasing inside it drops; releasing outside it cancels. */
  zone: HTMLElement;
  /** 'x': a row (pills, pins); 'y': a column (tab rows). */
  axis: 'x' | 'y';
  /** The class every draggable child of `list` has. */
  itemClass: string;
  /** The item's key (`data-*`), the one sent in `drop`. */
  keyOf(item: HTMLElement): string;
  /** `key` was dropped just before `before` (null: last). The DOM is already in the new order. */
  drop(key: string, before: string | null): void;
};

type Drag = {
  items: HTMLElement[];
  keys: string[];
  from: number;
  /** Midpoints of every item along the axis in the scroller's content coordinates, measured when the drag started. */
  mids: number[];
  /** How far an item slides to open the gap: the dragged item's size plus the space between items. */
  step: number;
  /** Where the dragged item may be translated to without leaving the list. */
  min: number;
  max: number;
  to: number;
  frame: number;
};

type Press = {
  pointerId: number;
  item: HTMLElement;
  /** Where the press started along the axis, in the scroller's content coordinates (survives edge scrolling). */
  start: number;
  clientX: number;
  clientY: number;
  drag: Drag | null;
  /** A drag happened during this press (even if Esc ended it), so the click that follows does nothing. */
  dragged: boolean;
};

/**
 * Drag an item of `list` along its axis to reorder it. Delegated on the list, so items rebuilt by a state push keep
 * working. The others slide to open a gap; a release in `zone` calls `drop` once and leaves the DOM in the new
 * order, which the following state push keeps. Esc, a right-click, a cancelled or lost pointer, or a release outside
 * `zone` puts everything back and drops nothing; `cancel()` does the same (callers use it when the items change
 * mid-drag). The click that ends a drag is swallowed before it reaches the item.
 */
export function setupRowDrag(opts: RowDragOptions): { cancel(): void } {
  const { list, scroller, zone, axis, itemClass, keyOf, drop } = opts;
  const horizontal = axis === 'x';
  let press: Press | null = null;
  let suppress = false;

  const along = (clientX: number, clientY: number): number => (horizontal ? clientX : clientY);
  const startOf = (r: DOMRect): number => (horizontal ? r.left : r.top);
  const endOf = (r: DOMRect): number => (horizontal ? r.right : r.bottom);
  const scrollPos = (): number => (horizontal ? scroller.scrollLeft : scroller.scrollTop);
  const setScrollPos = (v: number): void => { if (horizontal) scroller.scrollLeft = v; else scroller.scrollTop = v; };
  const maxScroll = (): number => (horizontal ? scroller.scrollWidth - scroller.clientWidth : scroller.scrollHeight - scroller.clientHeight);
  const content = (clientX: number, clientY: number): number =>
    along(clientX, clientY) - startOf(scroller.getBoundingClientRect()) + scrollPos();
  const inZone = (clientX: number, clientY: number): boolean => {
    const z = zone.getBoundingClientRect();
    return clientX >= z.left && clientX <= z.right && clientY >= z.top && clientY <= z.bottom;
  };
  const translate = (d: number): string => (d === 0 ? '' : `translate${horizontal ? 'X' : 'Y'}(${d}px)`);

  function begin(p: Press): void {
    const items = Array.from(list.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains(itemClass));
    const from = items.indexOf(p.item);
    if (from < 0) { press = null; return; }
    try { p.item.setPointerCapture(p.pointerId); } catch { press = null; return; }
    p.dragged = true;
    suppress = true;
    // Classes first: they freeze every item's look (the dragged one keeps its hover look, the others ignore hover),
    // so the rects measured below are the ones that hold for the whole drag.
    list.classList.add('dragging');
    p.item.classList.add('dragging');
    document.body.classList.add('row-dragging');
    const origin = startOf(scroller.getBoundingClientRect()) - scrollPos();
    const rects = items.map((item) => item.getBoundingClientRect());
    const own = rects[from]!;
    // Flex gap or margins alike: the space between the first two items.
    const gap = rects.length > 1 ? Math.max(0, startOf(rects[1]!) - endOf(rects[0]!)) : 0;
    p.drag = {
      items,
      keys: items.map(keyOf),
      from,
      mids: rects.map((r) => (startOf(r) + endOf(r)) / 2 - origin),
      step: endOf(own) - startOf(own) + gap,
      min: startOf(rects[0]!) - startOf(own),
      max: endOf(rects[rects.length - 1]!) - endOf(own),
      to: from,
      frame: requestAnimationFrame(edgeScroll),
    };
    window.addEventListener('keydown', onKey, true);
    update(p);
  }

  /**
   * Moves the dragged item under the pointer and slides the others to open the gap at the drop slot. Outside the
   * zone a release cancels, so the others slide back to show the original slot.
   */
  function update(p: Press): void {
    const d = p.drag;
    if (!d) return;
    const at = content(p.clientX, p.clientY);
    p.item.style.transform = translate(Math.min(d.max, Math.max(d.min, at - p.start)));
    const to = inZone(p.clientX, p.clientY) ? dropIndex(d.mids, d.from, at) : d.from;
    if (to === d.to) return;
    d.to = to;
    d.items.forEach((item, i) => {
      if (i !== d.from) item.style.transform = translate(slotShift(i, d.from, to) * d.step);
    });
  }

  function edgeScroll(): void {
    const p = press;
    if (!p?.drag) return;
    const r = scroller.getBoundingClientRect();
    const at = along(p.clientX, p.clientY);
    const before = scrollPos();
    if (at < startOf(r) + EDGE_PX && before > 0) setScrollPos(Math.max(0, before - EDGE_SCROLL_PX));
    else if (at > endOf(r) - EDGE_PX && before < maxScroll()) setScrollPos(Math.min(maxScroll(), before + EDGE_SCROLL_PX));
    if (scrollPos() !== before) update(p);
    p.drag.frame = requestAnimationFrame(edgeScroll);
  }

  /** Ends the drag's visuals: no transforms, no drag classes. Nothing is dropped. */
  function stop(p: Press): void {
    const d = p.drag;
    if (!d) return;
    p.drag = null;
    cancelAnimationFrame(d.frame);
    window.removeEventListener('keydown', onKey, true);
    for (const item of d.items) { item.style.transform = ''; item.classList.remove('dragging'); }
    list.classList.remove('dragging');
    document.body.classList.remove('row-dragging');
    if (p.item.hasPointerCapture(p.pointerId)) p.item.releasePointerCapture(p.pointerId);
  }

  /** The press is over. A click that follows a drag is swallowed; if none comes, the flag doesn't outlive this task. */
  function end(p: Press): void {
    stop(p);
    press = null;
    if (p.dragged) setTimeout(() => { suppress = false; }, 0);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !press?.drag) return;
    e.preventDefault();
    e.stopPropagation();
    stop(press); // the press goes on until the button is released, but never drags again
  }

  list.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey || !e.isPrimary) return;
    if (press) {
      if (e.pointerId !== press.pointerId) return; // one pointer at a time
      end(press); // the same pointer pressed again: its release happened where we couldn't hear it
    }
    const item = e.target instanceof Element ? e.target.closest<HTMLElement>(`.${itemClass}`) : null;
    if (!item || item.parentElement !== list) return;
    press = {
      pointerId: e.pointerId, item, start: content(e.clientX, e.clientY), clientX: e.clientX, clientY: e.clientY, drag: null, dragged: false,
    };
  });

  window.addEventListener('pointermove', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.pointerId) return;
    if ((e.buttons & 1) === 0) { end(p); return; } // released somewhere we never heard about
    p.clientX = e.clientX;
    p.clientY = e.clientY;
    if (p.drag) update(p);
    else if (!p.dragged && Math.abs(content(e.clientX, e.clientY) - p.start) >= DRAG_THRESHOLD_PX) begin(p);
  });

  window.addEventListener('pointerup', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.pointerId) return;
    const d = p.drag;
    const inside = inZone(e.clientX, e.clientY);
    end(p);
    if (!d || !inside || d.to === d.from) return;
    const key = d.keys[d.from]!;
    const before = dropBefore(d.keys, d.from, d.to);
    const desired = d.keys.filter((k) => k !== key);
    desired.splice(before === null ? desired.length : desired.indexOf(before), 0, key);
    // Same frame as clearing the transforms: the items sit in their new slots, so nothing jumps. The dropped item
    // (under the pointer) stays where it is in the DOM so it keeps its hover; the others move around it. With
    // `before` null the dropped item goes after the last item, ahead of any non-item children (New Tab).
    const after = d.items[d.items.length - 1]!.nextSibling;
    for (const m of keyedMoves(d.keys, desired, key)) {
      list.insertBefore(d.items[d.keys.indexOf(m.key)]!, m.before === null ? after : d.items[d.keys.indexOf(m.before)]!);
    }
    drop(key, before);
  });

  window.addEventListener('pointercancel', (e) => {
    if (press && e.pointerId === press.pointerId) end(press);
  });

  // Capture lost without a release (e.g. the items were rebuilt mid-drag): cancel. After a release `press` is
  // already null, so the loss that follows every pointerup is ignored.
  window.addEventListener('lostpointercapture', (e) => {
    if (press?.drag && e.pointerId === press.pointerId) stop(press);
  });

  // A right-click while dragging cancels the drag instead of opening the item's menu.
  window.addEventListener('contextmenu', (e) => {
    if (!press?.drag) return;
    e.preventDefault();
    e.stopPropagation();
    stop(press);
  }, true);

  // A favicon <img> would start the browser's own image drag, which ends ours with a pointercancel.
  list.addEventListener('dragstart', (e) => e.preventDefault());

  // The click that a drag's release makes never reaches the item (no profile switch, tab select or pin open).
  list.addEventListener('click', (e) => {
    if (!suppress) return;
    suppress = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  return {
    cancel(): void {
      if (press?.drag) stop(press);
    },
  };
}
