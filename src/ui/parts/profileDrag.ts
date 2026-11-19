import { dropBefore, dropIndex, slotShift } from '../../core/dragOrder.ts';

type ReorderCommand = { type: 'reorderProfile'; dir: string; before: string | null };

/** Horizontal movement (px) before a press on a pill becomes a drag; below it the click switches profile as usual. */
const DRAG_THRESHOLD_PX = 4;
/** While dragging within this distance of the bar's left or right edge, an overflowing bar scrolls… */
const EDGE_PX = 24;
/** …by this much per animation frame. */
const EDGE_SCROLL_PX = 6;

type Drag = {
  pills: HTMLElement[];
  dirs: string[];
  from: number;
  /** Midpoints of every pill in the bar's content coordinates, measured when the drag started. */
  mids: number[];
  /** How far a pill slides to open the gap: the dragged pill's width plus the bar's gap. */
  step: number;
  /** Where the dragged pill may be translated to without leaving the row. */
  minDx: number;
  maxDx: number;
  to: number;
  frame: number;
};

type Press = {
  pointerId: number;
  pill: HTMLElement;
  /** Where the press started, in the bar's content coordinates (survives edge scrolling). */
  startX: number;
  clientX: number;
  drag: Drag | null;
  /** A drag happened during this press (even if Esc ended it), so the click that follows is not a switch. */
  dragged: boolean;
};

/**
 * Drag a profile pill along `bar` (`#profiles`) to reorder it. Delegated on the bar, so pills rebuilt by a state
 * push keep working. The others slide to open a gap; a release in the bottom bar sends one `reorderProfile` and
 * leaves the DOM in the new order, which the following state push rebuilds identically. Esc, a cancelled or lost
 * pointer, or a release outside the bottom bar puts everything back and sends nothing.
 */
export function setupProfileDrag(opts: { bar: HTMLElement; send: (cmd: ReorderCommand) => void }): { suppressClick(): boolean } {
  const { bar, send } = opts;
  /** The bottom bar: releasing anywhere in it drops; releasing outside (above it) cancels. */
  const zone = bar.parentElement ?? bar;
  let press: Press | null = null;
  let suppress = false;

  const contentX = (clientX: number): number => clientX - bar.getBoundingClientRect().left + bar.scrollLeft;

  function begin(p: Press): void {
    const pills = Array.from(bar.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('pf'));
    const from = pills.indexOf(p.pill);
    if (from < 0) { press = null; return; }
    try { p.pill.setPointerCapture(p.pointerId); } catch { press = null; return; }
    p.dragged = true;
    suppress = true;
    // Classes first: they freeze every pill's look (the dragged one stays expanded, the others ignore hover),
    // so the rects measured below are the ones that hold for the whole drag.
    bar.classList.add('dragging');
    p.pill.classList.add('dragging');
    document.body.classList.add('pf-dragging');
    const left = bar.getBoundingClientRect().left - bar.scrollLeft;
    const rects = pills.map((pill) => pill.getBoundingClientRect());
    const own = rects[from]!;
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    p.drag = {
      pills,
      dirs: pills.map((pill) => pill.dataset['dir'] ?? ''),
      from,
      mids: rects.map((r) => r.left - left + r.width / 2),
      step: own.width + gap,
      minDx: rects[0]!.left - own.left,
      maxDx: rects[rects.length - 1]!.right - own.right,
      to: from,
      frame: requestAnimationFrame(edgeScroll),
    };
    window.addEventListener('keydown', onKey, true);
    update(p);
  }

  /** Moves the dragged pill under the pointer and slides the others to open the gap at the drop slot. */
  function update(p: Press): void {
    const d = p.drag;
    if (!d) return;
    const x = contentX(p.clientX);
    const dx = Math.min(d.maxDx, Math.max(d.minDx, x - p.startX));
    p.pill.style.transform = `translateX(${dx}px)`;
    const to = dropIndex(d.mids, d.from, x);
    if (to === d.to) return;
    d.to = to;
    d.pills.forEach((pill, i) => {
      if (i === d.from) return;
      const shift = slotShift(i, d.from, to);
      pill.style.transform = shift === 0 ? '' : `translateX(${shift * d.step}px)`;
    });
  }

  function edgeScroll(): void {
    const p = press;
    if (!p?.drag) return;
    const r = bar.getBoundingClientRect();
    const max = bar.scrollWidth - bar.clientWidth;
    const before = bar.scrollLeft;
    if (p.clientX < r.left + EDGE_PX && before > 0) bar.scrollLeft = Math.max(0, before - EDGE_SCROLL_PX);
    else if (p.clientX > r.right - EDGE_PX && before < max) bar.scrollLeft = Math.min(max, before + EDGE_SCROLL_PX);
    if (bar.scrollLeft !== before) update(p);
    p.drag.frame = requestAnimationFrame(edgeScroll);
  }

  /** Ends the drag's visuals: no transforms, no drag classes. Nothing is sent. */
  function stop(p: Press): void {
    const d = p.drag;
    if (!d) return;
    p.drag = null;
    cancelAnimationFrame(d.frame);
    window.removeEventListener('keydown', onKey, true);
    for (const pill of d.pills) { pill.style.transform = ''; pill.classList.remove('dragging'); }
    bar.classList.remove('dragging');
    document.body.classList.remove('pf-dragging');
    if (p.pill.hasPointerCapture(p.pointerId)) p.pill.releasePointerCapture(p.pointerId);
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

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.ctrlKey || !e.isPrimary) return;
    if (press) {
      if (e.pointerId !== press.pointerId) return; // one pointer at a time
      end(press); // the same pointer pressed again: its release happened where we couldn't hear it
    }
    const pill = e.target instanceof Element ? e.target.closest<HTMLElement>('.pf') : null;
    if (!pill || pill.parentElement !== bar) return;
    press = { pointerId: e.pointerId, pill, startX: contentX(e.clientX), clientX: e.clientX, drag: null, dragged: false };
  });

  window.addEventListener('pointermove', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.pointerId) return;
    if ((e.buttons & 1) === 0) { end(p); return; } // released somewhere we never heard about
    p.clientX = e.clientX;
    if (p.drag) update(p);
    else if (!p.dragged && Math.abs(contentX(e.clientX) - p.startX) >= DRAG_THRESHOLD_PX) begin(p);
  });

  window.addEventListener('pointerup', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.pointerId) return;
    const d = p.drag;
    const z = zone.getBoundingClientRect();
    const inside = e.clientX >= z.left && e.clientX <= z.right && e.clientY >= z.top && e.clientY <= z.bottom;
    end(p);
    if (!d || !inside || d.to === d.from) return;
    const before = dropBefore(d.dirs, d.from, d.to);
    // Same frame as clearing the transforms: the pill sits in its new slot, so nothing jumps.
    bar.insertBefore(p.pill, before === null ? null : d.pills[d.dirs.indexOf(before)]!);
    send({ type: 'reorderProfile', dir: d.dirs[d.from]!, before });
  });

  window.addEventListener('pointercancel', (e) => {
    if (press && e.pointerId === press.pointerId) end(press);
  });

  // Capture lost without a release (e.g. the pills were rebuilt mid-drag): cancel. After a release `press` is
  // already null, so the loss that follows every pointerup is ignored.
  window.addEventListener('lostpointercapture', (e) => {
    if (press?.drag && e.pointerId === press.pointerId) stop(press);
  });

  return {
    suppressClick(): boolean {
      const was = suppress;
      suppress = false;
      return was;
    },
  };
}
