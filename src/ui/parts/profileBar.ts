import type { SuperbrowserApi } from '../../preload/ui.ts';
import { keyedMoves } from '../../core/reorder.ts';
import { textOn } from '../../core/colors.ts';
import type { UiProfile, UiState } from '../../shared/types.ts';
import { el, markCurrent } from './dom.ts';
import { setupProfileDrag } from './profileDrag.ts';

/** The pill's tooltip and accessible name: `ACME (⌃1)`, or `ACME — Chrome name (⌃1)` when a display name is set. */
function pillLabel(p: UiProfile): string {
  const name = p.name === p.chromeName ? p.name : `${p.name} — ${p.chromeName}`;
  return p.shortcut === null ? name : `${name} (⌃${p.shortcut})`;
}

type Edit = {
  dir: string;
  /** The pill's button, out of the DOM while editing. */
  pill: HTMLElement;
  /** Stands in the pill's place: the dot and the text field. Not a button, so typing never activates it. */
  holder: HTMLElement;
  input: HTMLInputElement;
  /** The field's value when the edit began; only a different (trimmed) value is sent. */
  original: string;
  /** Saved or cancelled by a press elsewhere; the holder stays until the press ends (see `commitEdit`). */
  closing: boolean;
};

/**
 * The profile pills in `bar` (`#profiles`): one `<button class="pf">` per visible profile, kept by dir and updated in
 * place (like tab rows), so a hovered pill keeps its element across pushes, including the push that follows a drop.
 * Drag a pill to reorder it (profileDrag.ts); the click that ends a drag doesn't switch profile.
 *
 * `startEdit(dir)` edits that profile's display name inline. The button is swapped for a `.pf.pf-editing` holder
 * with the same dir, so the text field never sits inside a button (Space or Enter typed there would activate it).
 * Enter, or a blur with a changed value, saves; Escape, or a blur with the value unchanged, cancels.
 */
export function setupProfileBar(opts: { bar: HTMLElement; sb: SuperbrowserApi }): {
  render(s: UiState): void;
  startEdit(dir: string): void;
} {
  const { bar, sb } = opts;
  const pills = new Map<string, HTMLElement>();
  /** The latest pushed profile for each pill, so an edit starts from it and a pill catches up when its edit ends. */
  const latest = new Map<string, UiProfile>();
  let profilesKey = '';
  let activeProfile = '';
  let editing: Edit | null = null;
  const profileDrag = setupProfileDrag({ bar, send: (cmd) => sb.send(cmd) });

  // Whether the primary button is pressed in this page, and what waits for its release. Only the primary button
  // counts: a right-click opens a native menu that swallows its release, which would leave the flag stuck.
  let pressing = false;
  let afterPress: (() => void)[] = [];
  const released = (): void => {
    pressing = false;
    const run = afterPress;
    afterPress = [];
    if (run.length > 0) setTimeout(() => { for (const f of run) f(); }, 0); // after the click the release makes
  };
  window.addEventListener('pointerdown', (e) => { if (e.isPrimary && e.button === 0) pressing = true; }, true);
  window.addEventListener('pointerup', (e) => { if (e.isPrimary) released(); }, true);
  window.addEventListener('pointercancel', (e) => { if (e.isPrimary) released(); }, true);
  window.addEventListener('pointermove', (e) => { if (pressing && e.isPrimary && e.buttons === 0) released(); }, true);

  /** What stands in the bar for `dir`: its holder while it is being edited, else its pill. */
  const nodeOf = (dir: string): HTMLElement | undefined => (editing?.dir === dir ? editing.holder : pills.get(dir));

  function createPill(dir: string): HTMLElement {
    const pill = el('button', 'pf');
    pill.type = 'button';
    pill.dataset['dir'] = dir;
    pill.append(el('span', 'dot'), el('span', 'n'));
    pill.addEventListener('click', () => {
      if (profileDrag.suppressClick()) return;
      sb.send({ type: 'selectProfile', dir });
    });
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      sb.send({ type: 'profileMenu', dir });
    });
    pills.set(dir, pill);
    return pill;
  }

  function updatePill(pill: HTMLElement, p: UiProfile): void {
    const label = pillLabel(p);
    if (pill.title !== label) pill.title = label;
    pill.setAttribute('aria-label', label);
    const dot = pill.querySelector<HTMLElement>('.dot')!;
    dot.textContent = p.initials;
    dot.style.background = p.color;
    dot.style.color = textOn(p.color); // dark initials on a light profile colour
    pill.querySelector('.n')!.textContent = p.name;
  }

  /**
   * Puts the pill back, showing the latest pushed profile. Nothing is sent. `keepFocus` (Enter, Escape) moves the
   * focus from the field to the pill, so a keyboard user keeps their place.
   */
  function endEdit(keepFocus = false): void {
    const e = editing;
    if (!e) return;
    const focused = keepFocus && document.activeElement === e.input;
    editing = null; // first: the field's blur when it leaves the DOM must not count
    const p = latest.get(e.dir);
    if (p) updatePill(e.pill, p);
    markCurrent(e.pill, e.dir === activeProfile);
    e.holder.replaceWith(e.pill);
    if (focused) e.pill.focus();
  }

  /**
   * Saves a changed value and ends the edit. When a press took the focus away (a click on another pill, say), the
   * holder stays until that press ends: swapping the wider holder for the pill now would slide the other pills, and
   * the click would miss the pill it was aimed at.
   */
  function commitEdit(onBlur = false, keepFocus = false): void {
    const e = editing;
    if (!e) return;
    if (e.closing) { endEdit(); return; }
    const name = e.input.value.trim();
    if (name !== e.original) sb.send({ type: 'setDisplayName', dir: e.dir, name });
    if (!onBlur || !pressing) { endEdit(keepFocus); return; }
    e.closing = true;
    afterPress.push(() => { if (editing === e) endEdit(); });
  }

  function startEdit(dir: string): void {
    // Main asks for an edit from the pill's menu, after a right-click; whatever press came before is over.
    pressing = false;
    if (editing?.dir === dir && !editing.closing) { editing.input.focus(); editing.input.select(); return; }
    commitEdit(); // another pill's edit: as if its field lost focus
    const pill = pills.get(dir);
    const p = latest.get(dir);
    if (!pill || !p || !pill.isConnected) return;
    profileDrag.cancel();
    const holder = el('div', 'pf pf-editing');
    holder.dataset['dir'] = dir;
    markCurrent(holder, dir === activeProfile);
    const dot = el('span', 'dot', p.initials);
    dot.style.background = p.color;
    dot.style.color = textOn(p.color); // dark initials on a light profile colour
    const input = el('input', 'pf-edit');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.maxLength = 40;
    input.placeholder = p.chromeName;
    input.value = p.name === p.chromeName ? '' : p.name;
    input.setAttribute('aria-label', `Display name for ${p.chromeName}`);
    holder.append(dot, input);
    // Pressing anywhere in the holder neither starts a drag (delegated on the bar) nor reaches anything else; on the
    // dot it also keeps the focus in the field, so the press doesn't end the edit.
    holder.addEventListener('pointerdown', (e) => e.stopPropagation());
    holder.addEventListener('mousedown', (e) => { if (e.target !== input) e.preventDefault(); });
    for (const type of ['click', 'dblclick', 'contextmenu']) holder.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Esc here cancels the edit and nothing else
      if (e.isComposing) return;
      // preventDefault: no keypress follows, so the Enter can't reach the pill that takes the focus.
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(false, true); }
      else if (e.key === 'Escape') { e.preventDefault(); endEdit(true); }
    });
    // Unlike bookmark rename, blur saves a changed value: setDisplayName names its profile, so it can't land elsewhere.
    input.addEventListener('blur', () => { if (editing?.input === input && !editing.closing) commitEdit(true); });
    editing = { dir, pill, holder, input, original: input.value, closing: false };
    pill.replaceWith(holder);
    holder.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    input.focus();
    input.select();
  }

  function render(s: UiState): void {
    activeProfile = s.activeProfile;
    const key = JSON.stringify(s.profiles);
    if (key !== profilesKey) {
      profilesKey = key;
      profileDrag.cancel(); // its measurements are stale once a pill changes
      latest.clear();
      for (const p of s.profiles) latest.set(p.dir, p);
      if (editing && !latest.has(editing.dir)) { // hidden, or gone from Chrome: drop the edit silently
        const { holder } = editing;
        editing = null;
        holder.remove();
      }
      for (const [dir, pill] of pills) {
        if (!latest.has(dir)) { pill.remove(); pills.delete(dir); }
      }
      // The pill being edited is left alone; it catches up when the edit ends.
      for (const p of s.profiles) {
        const pill = pills.get(p.dir) ?? createPill(p.dir);
        if (editing?.dir !== p.dir) updatePill(pill, p);
      }
      const dirs = s.profiles.map((p) => p.dir);
      const current = Array.from(bar.children, (c) => (c as HTMLElement).dataset['dir'] ?? '');
      // Moving an element drops its hover, and the field being edited would lose its focus: those stay put.
      const keep = editing?.dir ?? bar.querySelector<HTMLElement>(':scope > .pf:hover')?.dataset['dir'] ?? null;
      for (const { key: dir, before } of keyedMoves(current, dirs, keep)) {
        bar.insertBefore(nodeOf(dir)!, before === null ? null : nodeOf(before)!);
      }
    }
    for (const dir of pills.keys()) markCurrent(nodeOf(dir)!, dir === s.activeProfile);
  }

  return { render, startEdit };
}
