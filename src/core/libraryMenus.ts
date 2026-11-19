import type { BookmarkNode } from '../shared/types.ts';

/** An item of a bookmark's, folder's or history entry's right-click menu; main turns the spec into a native menu. */
export type LibraryMenuItem =
  | { id: 'open' | 'openInNewTab' | 'copyLink' | 'rename' | 'delete' | 'newFolder' | 'deleteFromHistory'; label: string }
  | { id: 'moveTo'; label: string; choices: { id: number; path: string }[] }
  | { id: 'separator' };

/**
 * A bookmark: Open in New Tab, Copy Link, Rename…, Move to ▸ `choices`, Delete.
 * A folder: New Folder… (inside it), Rename…, Delete. Rename and New Folder edit inline in the panel.
 */
export function bookmarkMenuSpec(node: BookmarkNode, choices: { id: number; path: string }[]): LibraryMenuItem[] {
  if (node.kind === 'folder') {
    return [
      { id: 'newFolder', label: 'New Folder…' },
      { id: 'rename', label: 'Rename…' },
      { id: 'separator' },
      { id: 'delete', label: 'Delete' },
    ];
  }
  return [
    { id: 'openInNewTab', label: 'Open in New Tab' },
    { id: 'copyLink', label: 'Copy Link' },
    { id: 'separator' },
    { id: 'rename', label: 'Rename…' },
    { id: 'moveTo', label: 'Move to', choices },
    { id: 'separator' },
    { id: 'delete', label: 'Delete' },
  ];
}

/** A history entry: Open in New Tab, Copy Link, Delete from History (every visit to that URL). */
export function historyMenuSpec(): LibraryMenuItem[] {
  return [
    { id: 'openInNewTab', label: 'Open in New Tab' },
    { id: 'copyLink', label: 'Copy Link' },
    { id: 'separator' },
    { id: 'deleteFromHistory', label: 'Delete from History' },
  ];
}
