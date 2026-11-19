import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type FindResult, type LibraryReply, type PanelRequest, type UiCommand, type UiState } from '../shared/types.ts';

/**
 * What the UI page (and the find bar, which shares this preload) sees as `window.superbrowser`.
 * IPC events never reach the page, only their payloads.
 */
export type SuperbrowserApi = {
  onState(cb: (state: UiState) => void): void;
  onFocusAddress(cb: () => void): void;
  onFindFocus(cb: () => void): void;
  onFindResult(cb: (result: FindResult) => void): void;
  /** A reply to a `suggest`, `historyPage` or `bookmarks` command (the shown profile's data; `seq` echoed). */
  onLibrary(cb: (reply: LibraryReply) => void): void;
  /** The shown profile's bookmarks or history changed: refetch what is on screen. */
  onLibraryChanged(cb: () => void): void;
  /** A visit or title was just recorded in the shown profile's history (throttled). */
  onHistoryRecorded(cb: () => void): void;
  /** Show History, Show Bookmarks or Bookmark This Page from the menu. */
  onPanel(cb: (request: PanelRequest) => void): void;
  /** Edit this bookmark's or folder's name inline (Rename…, New Folder…). */
  onStartRename(cb: (id: number) => void): void;
  /** Edit this profile's display name inline (the pill menu's Set Display Name…). */
  onEditProfileName(cb: (dir: string) => void): void;
  send(cmd: UiCommand): void;
};

const api: SuperbrowserApi = {
  onState: (cb) => { ipcRenderer.on(IPC.state, (_e, state: UiState) => cb(state)); },
  onFocusAddress: (cb) => { ipcRenderer.on(IPC.focusAddress, () => cb()); },
  onFindFocus: (cb) => { ipcRenderer.on(IPC.findFocus, () => cb()); },
  onFindResult: (cb) => { ipcRenderer.on(IPC.findResult, (_e, result: FindResult) => cb(result)); },
  onLibrary: (cb) => { ipcRenderer.on(IPC.library, (_e, reply: LibraryReply) => cb(reply)); },
  onLibraryChanged: (cb) => { ipcRenderer.on(IPC.libraryChanged, () => cb()); },
  onHistoryRecorded: (cb) => { ipcRenderer.on(IPC.historyRecorded, () => cb()); },
  onPanel: (cb) => { ipcRenderer.on(IPC.panel, (_e, request: PanelRequest) => cb(request)); },
  onStartRename: (cb) => { ipcRenderer.on(IPC.startRename, (_e, id: number) => cb(id)); },
  onEditProfileName: (cb) => { ipcRenderer.on(IPC.editProfileName, (_e, dir: string) => cb(dir)); },
  send: (cmd) => ipcRenderer.send(IPC.command, cmd),
};

contextBridge.exposeInMainWorld('superbrowser', api);
