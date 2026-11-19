import path from 'node:path';
import { app, BrowserWindow, Menu, Notification, type WebContentsView } from 'electron';
import { chromeMajor, userAgent } from '../core/identity.ts';
import { mergeProfiles } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import { sameSavedTabs } from '../core/tabs.ts';
import { downloadsOf } from '../core/downloads.ts';
import { barProfiles, parseUiCommand } from '../core/uiProtocol.ts';
import { IPC, type DownloadState, type UiCommand, type UiState } from '../shared/types.ts';
import { createBrowserWindow, createUiView, FindBar, layoutWindow } from './browserWindow.ts';
import { openProfileInChrome, readChromeProfiles } from './chrome.ts';
import { ImportFlow } from './importFlow.ts';
import { buildMenu, type MenuContext } from './menu.ts';
import { ProfileManager } from './profileManager.ts';
import { configureSessions, revealDownload } from './sessions.ts';
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
  let downloads: DownloadState[] = [];
  /** Set once the UI exists; downloads only start from pages, after that. */
  let pushState = (): void => {};

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('before-quit', () => {
    try {
      store.flush();
    } catch (e) {
      log(`could not save state: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    configureSessions({
      log,
      mainWindow: () => win,
      // `tabs` is created below; sessions (and so permission requests) only exist once it has made a tab.
      shownProfile: () => tabs.snapshot().dir || null,
      profileName: (dir) => state.knownProfiles.find((p) => p.dir === dir)?.name ?? dir,
      getPermissions: () => state.permissions,
      setPermissions: (p) => {
        state.permissions = p;
        store.save(state);
      },
      downloadsDir: () => app.getPath('downloads'),
      onDownloadsChanged: (list) => {
        downloads = list;
        pushState();
      },
      notify: (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show();
      },
    });

    state.knownProfiles = mergeProfiles(readChromeProfiles(), state.knownProfiles);

    const window = createBrowserWindow(state);
    win = window;
    const ui = createUiView(window, log); // before any tab view, so it stays below them
    const findBar = new FindBar(window, log);
    window.setWindowButtonVisibility(state.sidebarVisible);

    pushState = (): void => {
      if (ui.webContents.isDestroyed()) return;
      const snap = tabs.snapshot();
      const uiState: UiState = {
        profiles: barProfiles(profiles.visible),
        activeProfile: snap.dir,
        tabs: snap.tabs,
        activeTabId: snap.activeTabId,
        url: snap.url,
        canGoBack: snap.canGoBack,
        canGoForward: snap.canGoForward,
        sidebarVisible: state.sidebarVisible,
        showNames: state.showNames,
        downloads: downloadsOf(downloads, snap.dir), // other profiles' file names stay out of view (screen sharing)
      };
      ui.webContents.send(IPC.state, uiState);
    };

    const tabs: TabManager = new TabManager(window, () => {
      // Merge so tabs of profiles not loaded this run (hidden ones) are kept. Saved only when something saved
      // changed: loading and favicon events come often and must not keep postponing the write.
      const saved = { ...state.tabs, ...tabs.savedState() };
      const activeProfile = tabs.snapshot().dir || state.activeProfile;
      if (activeProfile !== state.activeProfile || !sameSavedTabs(state.tabs, saved)) {
        state.tabs = saved;
        state.activeProfile = activeProfile;
        store.save(state);
      }
      findBar.follow(tabs.activeWebContents()); // switching tab or profile closes the find bar
      pushState();
    }, log);
    const profiles = new ProfileManager({
      state,
      tabs,
      window,
      log,
      rebuildMenu: () => rebuildMenu(),
      saveAndPush: () => {
        store.save(state);
        pushState();
      },
    });
    const imports = new ImportFlow({
      window,
      log,
      activeProfile: () => profiles.visible.find((p) => p.dir === tabs.snapshot().dir) ?? null,
      visibleProfiles: () => profiles.visible,
      reloadProfile: (dir) => tabs.reloadProfile(dir),
    });
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
      importLogins: (mode) => void imports.importCurrent(mode),
      importLoginsForAllProfiles: () => void imports.importAll(),
      openActiveProfileInChrome: () => {
        const dir = tabs.snapshot().dir;
        if (dir) openProfileInChrome(dir, log);
      },
      unhideProfile: (dir) => profiles.unhide(dir),
      selectTab: (n) => tabs.selectTabByShortcut(n),
    };
    const rebuildMenu = (): void => {
      Menu.setApplicationMenu(buildMenu({
        ...menuActions,
        profiles: profiles.visible,
        hiddenProfiles: profiles.hidden,
        showNames: state.showNames,
      }));
    };

    const run = (cmd: UiCommand): void => {
      switch (cmd.type) {
        case 'selectProfile': tabs.showProfile(cmd.dir); break;
        case 'profileMenu': profiles.showMenu(cmd.dir); break;
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
        case 'revealDownload': revealDownload(cmd.id); break;
        case 'find': findBar.find(cmd.text, cmd.forward); break;
        case 'findClose': findBar.close(true); break;
      }
    };
    // Validated against the profiles visible right now (profiles.dirs is replaced on every change).
    const listen = (view: WebContentsView, accepts: (cmd: UiCommand) => boolean): void => {
      view.webContents.ipc.on(IPC.command, (_e, raw: unknown) => {
        const cmd = parseUiCommand(raw, profiles.dirs);
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
    const first = profiles.visible.find((p) => p.dir === state.activeProfile) ?? profiles.visible[0];
    if (first) tabs.showProfile(first.dir);
    store.save(state);

    if (!state.firstRunDone) {
      // Once the window shows its bar and sidebar; asked once whatever the answer.
      ui.webContents.once('did-finish-load', () => void imports.offerOnFirstRun(() => {
        state.firstRunDone = true;
        store.save(state);
      }));
    }
  });
}

if (app.requestSingleInstanceLock()) start();
else app.quit();
