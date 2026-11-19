export type Profile = { dir: string; name: string; color: string };
export type UiTab = { id: number; title: string; url: string; favicon: string | null; loading: boolean };

export type DownloadState = { id: string; filename: string; path: string; state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; received: number; total: number };
export type UiState = {
  profiles: (Profile & { shortcut: number | null })[]; // visible profiles in bar order; shortcut 1–9 or null
  activeProfile: string;
  tabs: UiTab[]; activeTabId: number | null;
  url: string; canGoBack: boolean; canGoForward: boolean;
  sidebarVisible: boolean; showNames: boolean;
  downloads: DownloadState[];   // filled in Task 9; [] until then
};
export type UiCommand =
  | { type: 'selectProfile'; dir: string } | { type: 'profileMenu'; dir: string }
  | { type: 'selectTab'; id: number } | { type: 'closeTab'; id: number } | { type: 'newTab' }
  | { type: 'navigate'; input: string } | { type: 'back' } | { type: 'forward' } | { type: 'reload' }
  | { type: 'toggleSidebar' } | { type: 'revealDownload'; id: string };
export const IPC = { state: 'ui:state', command: 'ui:command', focusAddress: 'ui:focus-address' } as const;
