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
