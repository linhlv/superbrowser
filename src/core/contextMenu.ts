/** The parts of Electron's `context-menu` params the page menu is built from. */
export type MenuParams = {
  linkURL: string; srcURL: string; mediaType: string; selectionText: string; isEditable: boolean;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
};
export type MenuItemSpec =
  | { id: 'openLinkInNewTab' | 'copyLink' | 'copyImage' | 'saveImage' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'searchSelection' | 'inspect'; label: string }
  | { id: 'separator' };

const SEARCH_LABEL_CHARS = 30;

/**
 * A page's right-click menu, Chrome-like: link, image, then edit or selection items, Inspect last.
 * Groups are separated by one separator; empty groups leave none behind.
 */
export function contextMenuSpec(p: MenuParams): MenuItemSpec[] {
  const groups: MenuItemSpec[][] = [];
  if (p.linkURL) {
    groups.push([{ id: 'openLinkInNewTab', label: 'Open Link in New Tab' }, { id: 'copyLink', label: 'Copy Link Address' }]);
  }
  if (p.mediaType === 'image' && p.srcURL) {
    groups.push([{ id: 'copyImage', label: 'Copy Image' }, { id: 'saveImage', label: 'Save Image As…' }]);
  }
  const selection = p.selectionText.trim().replace(/\s+/g, ' ');
  const search: MenuItemSpec[] = selection ? [{ id: 'searchSelection', label: `Search Google for “${truncate(selection)}”` }] : [];
  if (p.isEditable) {
    const f = p.editFlags;
    const edit: MenuItemSpec[] = [];
    if (f.canCut) edit.push({ id: 'cut', label: 'Cut' });
    if (f.canCopy) edit.push({ id: 'copy', label: 'Copy' });
    if (f.canPaste) edit.push({ id: 'paste', label: 'Paste' });
    if (f.canSelectAll) edit.push({ id: 'selectAll', label: 'Select All' });
    groups.push(edit, search);
  } else if (selection) {
    groups.push([{ id: 'copy', label: 'Copy' }, ...search]);
  }
  groups.push([{ id: 'inspect', label: 'Inspect' }]);

  const spec: MenuItemSpec[] = [];
  for (const group of groups.filter((g) => g.length > 0)) {
    if (spec.length > 0) spec.push({ id: 'separator' });
    spec.push(...group);
  }
  return spec;
}

/** The first 30 characters (code points, so an emoji is never cut in half) and "…" when there were more. */
function truncate(text: string): string {
  const chars = Array.from(text);
  return chars.length > SEARCH_LABEL_CHARS ? chars.slice(0, SEARCH_LABEL_CHARS).join('').trimEnd() + '…' : text;
}
