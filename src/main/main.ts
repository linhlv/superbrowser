import path from 'node:path';
import { app, BrowserWindow, Menu, type WebContentsView } from 'electron';
import { chromeMajor, userAgent } from '../core/identity.ts';
import { arrangeProfiles, hideProfile, mergeProfiles, moveProfile } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import { barProfiles, parseUiCommand } from '../core/uiProtocol.ts';
import { IPC, type Profile, type UiCommand, type UiState } from '../shared/types.ts';
import { createBrowserWindow, createUiView, FindBar, layoutWindow } from './browserWindow.ts';
import { openProfileInChrome, readChromeProfiles } from './chrome.ts';
import { buildMenu, buildProfileMenu, type MenuContext } from './menu.ts';
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

/** Zoom levels (factor 1.2^level) step by half a level; Chromium allows factors 0.25–5. */
const ZOOM_STEP = 0.5, MIN_ZOOM = -7.5, MAX_ZOOM = 8.5;

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

    state.knownProfiles = mergeProfiles(readChromeProfiles(), state.knownProfiles);
    // Recomputed by profilesChanged() whenever the order or the hidden set changes.
    let profiles: Profile[] = [];
    let hiddenProfiles: Profile[] = [];
    let profileDirs = new Set<string>();
    const arrange = (): void => {
      let arranged = arrangeProfiles(state.knownProfiles, state.profileOrder, state.hiddenProfiles);
      if (arranged.visible.length === 0 && arranged.hidden.length > 0) {
        log('every profile was hidden; showing them all');
        state.hiddenProfiles = [];
        arranged = arrangeProfiles(state.knownProfiles, state.profileOrder, []);
      }
      profiles = arranged.visible;
      hiddenProfiles = arranged.hidden;
      profileDirs = new Set(profiles.map((p) => p.dir));
    };
    arrange();
    if (profiles.length === 0) log('no Chrome profiles found');

    const window = createBrowserWindow(state);
    win = window;
    const ui = createUiView(window, log); // before any tab view, so it stays below them
    const findBar = new FindBar(window, log);
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
      findBar.follow(tabs.activeWebContents()); // switching tab or profile closes the find bar
      pushState();
    }, log);
    tabs.setProfiles(profiles.map((p) => p.dir), state.tabs);
    const relayout = () => layoutWindow(window, ui, findBar, tabs, state.sidebarVisible);
    relayout();

    const setSidebarVisible = (visible: boolean): void => {
      state.sidebarVisible = visible;
      store.save(state);
      relayout();
      window.setWindowButtonVisibility(visible);
      pushState();
    };

    /** Sidebar shown and the address field focused (⌘T, ⌘L). */
    const focusAddress = (): void => {
      if (!state.sidebarVisible) setSidebarVisible(true);
      ui.webContents.focus();
      ui.webContents.send(IPC.focusAddress);
    };

    const setShowNames = (on: boolean): void => {
      state.showNames = on;
      store.save(state);
      rebuildMenu();
      pushState();
    };

    const zoom = (step: -1 | 0 | 1): void => {
      const page = tabs.activeWebContents();
      if (!page) return;
      const level = step === 0 ? 0 : page.getZoomLevel() + step * ZOOM_STEP;
      page.setZoomLevel(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level)));
    };

    const toggleDevTools = (): void => {
      const page = tabs.activeWebContents();
      if (!page) return;
      if (page.isDevToolsOpened()) page.closeDevTools();
      else page.openDevTools({ mode: 'detach' });
    };

    const print = (): void => {
      tabs.activeWebContents()?.print({}, (ok, reason) => {
        if (!ok && !/cancel/i.test(reason)) log(`print failed: ${reason}`);
      });
    };

    const menuActions: Omit<MenuContext, 'profiles' | 'hiddenProfiles' | 'showNames'> = {
      newTab: () => {
        tabs.newTab();
        focusAddress();
      },
      reopenClosedTab: () => tabs.reopenClosedTab(),
      closeTab: () => {
        const id = tabs.snapshot().activeTabId;
        if (id !== null) tabs.closeTab(id);
      },
      openLocation: focusAddress,
      print,
      find: () => {
        const page = tabs.activeWebContents();
        if (page) findBar.open(page);
      },
      findAgain: (forward) => {
        const page = tabs.activeWebContents();
        if (page) findBar.findAgain(page, forward);
      },
      toggleSidebar: () => setSidebarVisible(!state.sidebarVisible),
      setShowNames,
      reload: () => tabs.reload(),
      zoom,
      toggleDevTools,
      back: () => tabs.back(),
      forward: () => tabs.forward(),
      showProfile: (dir) => tabs.showProfile(dir),
      openActiveProfileInChrome: () => {
        const dir = tabs.snapshot().dir;
        if (dir) openProfileInChrome(dir, log);
      },
      unhideProfile: (dir) => {
        state.hiddenProfiles = state.hiddenProfiles.filter((d) => d !== dir);
        profilesChanged();
      },
      selectTab: (n) => tabs.selectTabByShortcut(n),
    };
    const rebuildMenu = (): void => {
      Menu.setApplicationMenu(buildMenu({ ...menuActions, profiles, hiddenProfiles, showNames: state.showNames }));
    };

    /** After the order or the hidden set changed: bar, ⌃N, menu, accepted commands and the shown profile follow. */
    const profilesChanged = (): void => {
      arrange();
      tabs.setProfiles(profiles.map((p) => p.dir), state.tabs); // a hidden profile's tabs stay (in state too)
      rebuildMenu();
      const first = profiles[0];
      if (!profileDirs.has(tabs.snapshot().dir) && first) {
        tabs.showProfile(first.dir); // saves and pushes via onChange
      } else {
        store.save(state);
        pushState();
      }
    };

    const showProfileMenu = (dir: string): void => {
      const order = (step: -1 | 1) => moveProfile(state.knownProfiles, state.profileOrder, state.hiddenProfiles, dir, step);
      const hidden = () => hideProfile(state.knownProfiles, state.hiddenProfiles, dir);
      buildProfileMenu({
        canMoveLeft: order(-1) !== null,
        canMoveRight: order(1) !== null,
        canHide: hidden() !== null,
        move: (step) => {
          const next = order(step);
          if (next) { state.profileOrder = next; profilesChanged(); }
        },
        hide: () => {
          const next = hidden();
          if (next) { state.hiddenProfiles = next; profilesChanged(); }
        },
        openInChrome: () => openProfileInChrome(dir, log),
      }).popup({ window });
    };

    const run = (cmd: UiCommand): void => {
      switch (cmd.type) {
        case 'selectProfile': tabs.showProfile(cmd.dir); break;
        case 'profileMenu': showProfileMenu(cmd.dir); break;
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
        case 'find': findBar.find(cmd.text, cmd.forward); break;
        case 'findClose': findBar.close(true); break;
      }
    };
    // Validated against the profiles visible right now (profileDirs is reassigned on every change).
    const listen = (view: WebContentsView, accepts: (cmd: UiCommand) => boolean): void => {
      view.webContents.ipc.on(IPC.command, (_e, raw: unknown) => {
        const cmd = parseUiCommand(raw, profileDirs);
        if (cmd && accepts(cmd)) run(cmd);
        else log(`ignored invalid UI command ${describe(raw)}`);
      });
    };
    const isFind = (cmd: UiCommand) => cmd.type === 'find' || cmd.type === 'findClose';
    listen(ui, (cmd) => !isFind(cmd));
    listen(findBar.view, isFind);
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

    rebuildMenu();
    const first = profiles.find((p) => p.dir === state.activeProfile) ?? profiles[0];
    if (first) tabs.showProfile(first.dir);
    store.save(state);
  });
}

if (app.requestSingleInstanceLock()) start();
else app.quit();
