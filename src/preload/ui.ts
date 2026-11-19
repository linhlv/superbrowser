import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type FindResult, type UiCommand, type UiState } from '../shared/types.ts';

/**
 * What the UI page (and the find bar, which shares this preload) sees as `window.superbrowser`.
 * IPC events never reach the page, only their payloads.
 */
export type SuperbrowserApi = {
  onState(cb: (state: UiState) => void): void;
  onFocusAddress(cb: () => void): void;
  onFindFocus(cb: () => void): void;
  onFindResult(cb: (result: FindResult) => void): void;
  send(cmd: UiCommand): void;
};

const api: SuperbrowserApi = {
  onState: (cb) => { ipcRenderer.on(IPC.state, (_e, state: UiState) => cb(state)); },
  onFocusAddress: (cb) => { ipcRenderer.on(IPC.focusAddress, () => cb()); },
  onFindFocus: (cb) => { ipcRenderer.on(IPC.findFocus, () => cb()); },
  onFindResult: (cb) => { ipcRenderer.on(IPC.findResult, (_e, result: FindResult) => cb(result)); },
  send: (cmd) => ipcRenderer.send(IPC.command, cmd),
};

contextBridge.exposeInMainWorld('superbrowser', api);
