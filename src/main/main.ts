import path from 'node:path';
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { chromeMajor, userAgent } from '../core/identity.ts';
import { arrangeProfiles, mergeProfiles } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import type { Profile } from '../shared/types.ts';
import { createBrowserWindow, layoutWindow } from './browserWindow.ts';
import { readChromeProfiles } from './chrome.ts';
import { configureSessions } from './sessions.ts';
import { TabManager } from './tabManager.ts';

app.userAgentFallback = userAgent(chromeMajor(process.versions.chrome));

const log = (msg: string): void => console.error(`Superbrowser: ${msg}`);

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

    const window = createBrowserWindow(state);
    win = window;
    const tabs = new TabManager(window, () => {
      // Merge so tabs of profiles not loaded this run (hidden ones) are kept.
      state.tabs = { ...state.tabs, ...tabs.savedState() };
      state.activeProfile = tabs.snapshot().dir || state.activeProfile;
      store.save(state);
    }, log);
    tabs.setProfiles(profiles.map((p) => p.dir), state.tabs);
    layoutWindow(window, tabs, state.sidebarVisible);

    const saveBounds = () => {
      if (window.isFullScreen()) return;
      state.windowBounds = window.getBounds();
      store.save(state);
    };
    window.on('resize', () => {
      layoutWindow(window, tabs, state.sidebarVisible);
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
