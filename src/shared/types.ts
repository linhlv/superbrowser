export type Profile = { dir: string; name: string; color: string };
export type UiProfile = Profile & { shortcut: number | null; initials: string; chromeName: string }; // name is the label (display name or Chrome name)
export type UiPin = {
  key: string; dir: string; title: string; url: string; favicon: string | null;
  color: string; profileLabel: string; shortcut: number | null; active: boolean;
};
/** A tab as TabManager knows it; `favicon` is the page's, or one remembered from history until the page reports its own. */
export type TabInfo = { id: number; title: string; url: string; favicon: string | null; loading: boolean };
/** `canPin`: a web page; `pinned`: its site is pinned in this profile (the row's pin button). */
export type UiTab = TabInfo & { canPin: boolean; pinned: boolean };

export type DownloadState = { id: string; dir: string; filename: string; path: string; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; received: number; total: number };
export type UiState = {
  profiles: UiProfile[]; // visible profiles in bar order; shortcut 1–9 or null
  pins: UiPin[];
  activeProfile: string;
  tabs: UiTab[]; activeTabId: number | null;
  url: string; canGoBack: boolean; canGoForward: boolean;
  /** The address bar's star: the shown page can be bookmarked (a web page) and is bookmarked in this profile. */
  canBookmark: boolean; bookmarked: boolean;
  sidebarVisible: boolean; showNames: boolean;
  downloads: DownloadState[];   // the shown profile's only
  openSections: Section[];
};
export type UiCommand =
  | { type: 'selectProfile'; dir: string } | { type: 'profileMenu'; dir: string }
  | { type: 'reorderProfile'; dir: string; before: string | null } | { type: 'addProfileMenu' }
  | { type: 'selectTab'; id: number } | { type: 'closeTab'; id: number } | { type: 'newTab' }
  /** A tab row dropped just before tab `before` (null: last) in the shown profile. */
  | { type: 'reorderTab'; id: number; before: number | null }
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
  | { type: 'selectPin'; key: string } | { type: 'pinMenu'; key: string }
  /** A pin tile dropped just before pin `before` (null: after the last shown pin). */
  | { type: 'reorderPin'; key: string; before: string | null }
  | { type: 'tabMenu'; id: number } | { type: 'setDisplayName'; dir: string; name: string }
  /** The tab row's pin button: pins the tab's site in the shown profile, or unpins it. */
  | { type: 'togglePinTab'; id: number }
  /** The address bar's star: bookmarks the shown page, or removes its bookmarks. */
  | { type: 'toggleBookmark' }
  | { type: 'setSectionOpen'; section: Section; open: boolean }
  /** The toolbar view's height: the strip, or taller while the address suggestions are open. */
  | { type: 'toolbarHeight'; height: number }
  /** A left click on the toolbar's transparent part over the page (suggestions open), in the toolbar's coordinates. */
  | { type: 'toolbarClickThrough'; x: number; y: number };
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
  historyRecorded: 'ui:history-recorded', editProfileName: 'ui:edit-profile-name',
} as const;
