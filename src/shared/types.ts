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
};
export type UiCommand =
  | { type: 'selectProfile'; dir: string } | { type: 'profileMenu'; dir: string } | { type: 'addProfileMenu' }
  | { type: 'selectTab'; id: number } | { type: 'closeTab'; id: number } | { type: 'newTab' }
  | { type: 'navigate'; input: string } | { type: 'back' } | { type: 'forward' } | { type: 'reload' }
  | { type: 'toggleSidebar' } | { type: 'revealDownload'; id: string }
  | { type: 'find'; text: string; forward: boolean } | { type: 'findClose' };
export type FindResult = { active: number; matches: number };
export const IPC = {
  state: 'ui:state', command: 'ui:command', focusAddress: 'ui:focus-address',
  findResult: 'ui:find-result', findFocus: 'ui:find-focus',
} as const;
