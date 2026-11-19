export type Profile = { dir: string; name: string; color: string };
export type UiTab = { id: number; title: string; url: string; favicon: string | null; loading: boolean };

export type DownloadState = { id: string; dir: string; filename: string; path: string; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; received: number; total: number };
export type UiState = {
  profiles: (Profile & { shortcut: number | null })[]; // visible profiles in bar order; shortcut 1–9 or null
  activeProfile: string;
  tabs: UiTab[]; activeTabId: number | null;
  url: string; canGoBack: boolean; canGoForward: boolean;
  sidebarVisible: boolean; showNames: boolean;
  downloads: DownloadState[];   // the shown profile's only
  openSections: Section[];
};
export type UiCommand =
  | { type: 'selectProfile'; dir: string } | { type: 'profileMenu'; dir: string }
  | { type: 'reorderProfile'; dir: string; before: string | null } | { type: 'addProfileMenu' }
  | { type: 'selectTab'; id: number } | { type: 'closeTab'; id: number } | { type: 'newTab' }
  | { type: 'navigate'; input: string } | { type: 'back' } | { type: 'forward' } | { type: 'reload' }
  | { type: 'toggleSidebar' } | { type: 'revealDownload'; id: string }
  | { type: 'find'; text: string; forward: boolean } | { type: 'findClose' }
  | { type: 'suggest'; seq: number; text: string }
  | { type: 'historyPage'; seq: number; query: string; before: number | null }
  | { type: 'bookmarks'; seq: number }
  | { type: 'openUrl'; url: string; newTab: boolean }
  | { type: 'historyMenu'; url: string }
  | { type: 'bookmarkMenu'; id: number }
  | { type: 'renameBookmark'; id: number; title: string }
  | { type: 'setSectionOpen'; section: Section; open: boolean };
export type Suggestion = { url: string; title: string; bookmarked: boolean };
export type HistoryRow = { url: string; title: string; time: number; day: number; favicon: string | null };
export type BookmarkNode =
  | { id: number; kind: 'url'; title: string; url: string; added: number }
  | { id: number; kind: 'folder'; title: string; added: number; children: BookmarkNode[] };
export type LibraryReply =
  | { kind: 'suggestions'; seq: number; text: string; completion: string | null; items: Suggestion[] }
  | { kind: 'historyPage'; seq: number; rows: HistoryRow[]; more: boolean }
  | { kind: 'bookmarks'; seq: number; nodes: BookmarkNode[]; favicons: Record<string, string> };
export type Section = 'bookmarks' | 'history';
/** `open` is the section's state after the request; when open, the UI focuses its search. */
export type PanelRequest = { panel: Section; open: boolean; highlight: number | null };
export type FindResult = { active: number; matches: number };
export const IPC = {
  state: 'ui:state', command: 'ui:command', focusAddress: 'ui:focus-address',
  findResult: 'ui:find-result', findFocus: 'ui:find-focus',
  library: 'ui:library', libraryChanged: 'ui:library-changed', panel: 'ui:panel', startRename: 'ui:start-rename',
  historyRecorded: 'ui:history-recorded',
} as const;
