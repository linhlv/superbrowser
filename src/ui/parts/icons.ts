// One consistent line-icon set (24-unit grid, 2-unit stroke, round caps) drawn as inline SVG, instead of text glyphs
// whose size and weight differ per character. Built with createElementNS and presentation attributes only (our CSP
// forbids inline styles); sized and coloured by CSS (`.ic`, `currentColor`). Decorative: hidden from assistive tech,
// so the control around an icon carries the label.

const SVG = 'http://www.w3.org/2000/svg';

/** Each icon is a list of path data strings. */
const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
  reload: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
  sidebar: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 3v18'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6L6 18', 'M6 6l12 12'],
  chevron: ['M9 18l6-6-6-6'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
} as const;

export type IconName = keyof typeof ICONS;

/** An `<svg class="ic ic-<name>">`; `filled` paints the shape instead of stroking it (the bookmark star). */
export function icon(name: IconName, filled = false): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ic ic-${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Puts `name`'s icon in each element marked `data-icon="<name>"` under `root` (static buttons in our HTML pages). */
export function fillIcons(root: ParentNode): void {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-icon]'))) {
    const name = node.dataset['icon'] ?? '';
    if (Object.hasOwn(ICONS, name)) node.replaceChildren(icon(name as IconName)); // an unknown name leaves the node as is
  }
}
