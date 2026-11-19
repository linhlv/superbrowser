import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type UiCommand, type UiState } from '../shared/types.ts';

/** What the UI page sees as `window.superbrowser`. IPC events never reach the page, only their payloads. */
export type SuperbrowserApi = {
  onState(cb: (state: UiState) => void): void;
  onFocusAddress(cb: () => void): void;
  send(cmd: UiCommand): void;
};

const api: SuperbrowserApi = {
  onState: (cb) => { ipcRenderer.on(IPC.state, (_e, state: UiState) => cb(state)); },
  onFocusAddress: (cb) => { ipcRenderer.on(IPC.focusAddress, () => cb()); },
  send: (cmd) => ipcRenderer.send(IPC.command, cmd),
};

contextBridge.exposeInMainWorld('superbrowser', api);
