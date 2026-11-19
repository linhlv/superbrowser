import type { PanelRequest, Section } from '../shared/types.ts';

export const SECTIONS: readonly Section[] = ['bookmarks', 'history'];

export function isSection(v: unknown): v is Section {
  return typeof v === 'string' && (SECTIONS as readonly string[]).includes(v);
}

/** `open` with `section` set to `isOpen`; unique, in SECTIONS order. */
export function withSection(open: readonly Section[], section: Section, isOpen: boolean): Section[] {
  return SECTIONS.filter((s) => (s === section ? isOpen : open.includes(s)));
}

/** ⌘Y / ⌥⌘B ('toggle') or ⌘D ('show'): the new open list and the request for the UI.
 *  A toggle that had to reveal the hidden sidebar opens the section instead of folding it. */
export function sectionToggle(
  open: readonly Section[], section: Section, mode: 'toggle' | 'show',
  highlight: number | null, revealedSidebar: boolean,
): { open: Section[]; request: PanelRequest } {
  const isOpen = mode === 'show' || revealedSidebar || !open.includes(section);
  return { open: withSection(open, section, isOpen), request: { panel: section, open: isOpen, highlight } };
}
