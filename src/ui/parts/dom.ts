// Small DOM helpers shared by the sidebar's parts. Data goes in through textContent only.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Favicons we show: web or inline images only. */
export const isImageUrl = (url: string | null | undefined): url is string => !!url && /^(https?:|data:image\/)/i.test(url);

/** A 16 px favicon `<img class="icon">`, or a grey `.icon.ph` placeholder if there is none or it fails to load. */
export function faviconIcon(favicon: string | null | undefined): HTMLElement {
  if (!isImageUrl(favicon)) return el('span', 'icon ph');
  const img = el('img', 'icon');
  img.alt = '';
  img.addEventListener('error', () => img.replaceWith(el('span', 'icon ph')));
  img.src = favicon;
  return img;
}

/**
 * Makes a clickable row reachable and usable from the keyboard: it joins the Tab order and Enter or Space on it acts
 * as a click (⌘ held carries over, e.g. ⌘Enter opens a library row in a new tab). Keys typed in a field inside the
 * row (an inline rename) are left alone.
 */
export function activatable(node: HTMLElement): void {
  node.tabIndex = 0;
  if (!node.hasAttribute('role')) node.setAttribute('role', 'button');
  node.addEventListener('keydown', (e) => {
    if (e.target !== node || e.isComposing || (e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.repeat) { e.preventDefault(); return; } // holding Enter must not open a page again and again
    e.preventDefault();
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: e.metaKey }));
  });
}

/** The current profile pill or active pin tile: the `on` look plus `aria-current` for assistive tech (removed when not). */
export function markCurrent(node: HTMLElement, on: boolean): void {
  node.classList.toggle('on', on);
  if (on) node.setAttribute('aria-current', 'true');
  else node.removeAttribute('aria-current');
}
