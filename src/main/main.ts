import path from 'node:path';
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { chromeMajor, userAgent } from '../core/identity.ts';
import { arrangeProfiles, mergeProfiles } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import { barProfiles, parseUiCommand } from '../core/uiProtocol.ts';
import { IPC, type Profile, type UiCommand, type UiState } from '../shared/types.ts';
import { createBrowserWindow, createUiView, layoutWindow } from './browserWindow.ts';
import { readChromeProfiles } from './chrome.ts';
import { configureSessions } from './sessions.ts';
import { TabManager } from './tabManager.ts';

app.userAgentFallback = userAgent(chromeMajor(process.versions.chrome));

const log = (msg: string): void => console.error(`Superbrowser: ${msg}`);

/** For logging an untrusted IPC payload: never throws, never huge. */
function describe(value: unknown): string {
  let text: string;
  try { text = JSON.stringify(value) ?? String(value); } catch { text = String(value); }
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

/** Temporary (Task 6 replaces it): standard menus plus ⌃1…9 to switch profile. */
function buildMenu(profiles: Profile[], show: (dir: string) => void): void {
  const profileItems: MenuItemConstructorOptions[] = profiles.slice(0, 9).map((p, i) => ({
    label: p.name,
    accelerator: `Ctrl+${i + 1}`,
    click: () => show(p.dir),
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'Profiles', submenu: profileItems },
    { role: 'windowMenu' },
  ]));
}

function start(): void {
  const store = createStore(path.join(app.getPath('userData'), 'state.json'));
  const state = store.load();
  let win: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('before-quit', () => store.flush());
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    configureSessions({ log });

    const all = mergeProfiles(readChromeProfiles(), state.knownProfiles);
    state.knownProfiles = all;
    const profiles = arrangeProfiles(all, state.profileOrder, state.hiddenProfiles).visible;
    if (profiles.length === 0) log('no Chrome profiles found');
    const profileDirs = new Set(profiles.map((p) => p.dir));

    const window = createBrowserWindow(state);
    win = window;
    const ui = createUiView(window, log); // before any tab view, so it stays below them
    window.setWindowButtonVisibility(state.sidebarVisible);

    const pushState = (): void => {
      if (ui.webContents.isDestroyed()) return;
      const snap = tabs.snapshot();
      const uiState: UiState = {
        profiles: barProfiles(profiles),
        activeProfile: snap.dir,
        tabs: snap.tabs,
        activeTabId: snap.activeTabId,
        url: snap.url,
        canGoBack: snap.canGoBack,
        canGoForward: snap.canGoForward,
        sidebarVisible: state.sidebarVisible,
        showNames: state.showNames,
        downloads: [],
      };
      ui.webContents.send(IPC.state, uiState);
    };

    const tabs: TabManager = new TabManager(window, () => {
      // Merge so tabs of profiles not loaded this run (hidden ones) are kept.
      state.tabs = { ...state.tabs, ...tabs.savedState() };
      state.activeProfile = tabs.snapshot().dir || state.activeProfile;
      store.save(state);
      pushState();
    }, log);
    tabs.setProfiles(profiles.map((p) => p.dir), state.tabs);
    const relayout = () => layoutWindow(window, ui, tabs, state.sidebarVisible);
    relayout();

    const setSidebarVisible = (visible: boolean): void => {
      state.sidebarVisible = visible;
      store.save(state);
      relayout();
      window.setWindowButtonVisibility(visible);
      pushState();
    };

    const run = (cmd: UiCommand): void => {
      switch (cmd.type) {
        case 'selectProfile': tabs.showProfile(cmd.dir); break;
        case 'profileMenu': break; // Task 6 builds the profile menu
        case 'selectTab': tabs.selectTab(cmd.id); break;
        case 'closeTab': tabs.closeTab(cmd.id); break;
        case 'newTab': tabs.newTab(); break;
        case 'navigate':
          tabs.navigate(cmd.input);
          tabs.activeWebContents()?.focus(); // like Chrome: the page, not the address field, has focus afterwards
          break;
        case 'back': tabs.back(); break;
        case 'forward': tabs.forward(); break;
        case 'reload': tabs.reload(); break;
        case 'toggleSidebar': setSidebarVisible(!state.sidebarVisible); break;
        case 'revealDownload': break; // Task 9 adds downloads
      }
    };
    ui.webContents.ipc.on(IPC.command, (_e, raw: unknown) => {
      const cmd = parseUiCommand(raw, profileDirs);
      if (cmd) run(cmd);
      else log(`ignored invalid UI command ${describe(raw)}`);
    });
    ui.webContents.on('did-finish-load', pushState);

    const saveBounds = () => {
      if (window.isFullScreen()) return;
      state.windowBounds = window.getBounds();
      store.save(state);
    };
    window.on('resize', () => {
      relayout();
      saveBounds();
    });
    window.on('move', saveBounds);
    window.on('closed', () => { win = null; });

    buildMenu(profiles, (dir) => tabs.showProfile(dir));
    const first = profiles.find((p) => p.dir === state.activeProfile) ?? profiles[0];
    if (first) tabs.showProfile(first.dir);
    store.save(state);
  });
}

if (app.requestSingleInstanceLock()) start();
else app.quit();
