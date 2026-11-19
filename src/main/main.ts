import path from 'node:path';
import { app, BrowserWindow, Menu, Notification, type WebContents, type WebContentsView } from 'electron';
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
import { isPopupWindow } from './pages.ts';
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

/** A rejected promise nobody awaits: logged, not an unhandled rejection. */
const logFailure = (what: string) => (e: unknown): void => log(`${what} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);

/** Startup loads each visible profile's active tab, the shown one first and the others this far apart. */
const STARTUP_STAGGER_MS = 300;

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

  const profileName = (dir: string): string => state.knownProfiles.find((p) => p.dir === dir)?.name ?? dir;

  void app.whenReady().then(() => {
    configureSessions({
      log,
      mainWindow: () => win,
      // `tabs` is created below; sessions (and so permission requests) only exist once it has made a tab.
      shownProfile: () => tabs.snapshot().dir || null,
      profileName,
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
    }, log, profileName);
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

    /** Sidebar shown and the address field focused (⌘T, ⌘L), in the main window even if a popup had focus. */
    const focusAddress = (): void => {
      if (!state.sidebarVisible) setSidebarVisible(true);
      window.focus();
      ui.webContents.focus();
      ui.webContents.send(IPC.focusAddress);
    };

    const setShowNames = (on: boolean): void => {
      state.showNames = on;
      store.save(state);
      rebuildMenu();
      pushState();
    };

    /** A popup (sign-in, pop-out) that has focus: page shortcuts act on it, not on the main window's tab. */
    const focusedPopup = (): BrowserWindow | null => {
      const focused = BrowserWindow.getFocusedWindow();
      return focused && !focused.isDestroyed() && isPopupWindow(focused) ? focused : null;
    };
    /** The page that ⌘R, ⌘P, zoom, DevTools, Back and Forward act on. */
    const targetPage = (): WebContents | null => focusedPopup()?.webContents ?? tabs.activeWebContents();

    const zoom = (step: -1 | 0 | 1): void => {
      const page = targetPage();
      if (!page) return;
      const level = step === 0 ? 0 : page.getZoomLevel() + step * ZOOM_STEP;
      page.setZoomLevel(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level)));
    };

    const toggleDevTools = (): void => {
      const page = targetPage();
      if (!page) return;
      if (page.isDevToolsOpened()) page.closeDevTools();
      else page.openDevTools({ mode: 'detach' });
    };

    const print = (): void => {
      targetPage()?.print({}, (ok, reason) => {
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
        const popup = focusedPopup();
        if (popup) {
          popup.close(); // ⌘W closes the popup (its page may still say "Leave site?")
          return;
        }
        const id = tabs.snapshot().activeTabId;
        if (id !== null) tabs.closeTab(id);
      },
      openLocation: focusAddress,
      print,
      // Popups have no find bar: find does nothing there rather than search the main window's tab.
      find: () => {
        const page = focusedPopup() ? null : tabs.activeWebContents();
        if (page) findBar.open(page);
      },
      findAgain: (forward) => {
        const page = focusedPopup() ? null : tabs.activeWebContents();
        if (page) findBar.findAgain(page, forward);
      },
      toggleSidebar: () => setSidebarVisible(!state.sidebarVisible),
      setShowNames,
      reload: () => {
        const popup = focusedPopup();
        if (popup) popup.webContents.reload();
        else tabs.reload();
      },
      zoom,
      toggleDevTools,
      back: () => {
        const history = focusedPopup()?.webContents.navigationHistory;
        if (!history) tabs.back();
        else if (history.canGoBack()) history.goBack();
      },
      forward: () => {
        const history = focusedPopup()?.webContents.navigationHistory;
        if (!history) tabs.forward();
        else if (history.canGoForward()) history.goForward();
      },
      showProfile: (dir) => tabs.showProfile(dir),
      importLogins: (mode) => void imports.importCurrent(mode).catch(logFailure('importing logins')),
      importLoginsForAllProfiles: () => void imports.importAll().catch(logFailure('importing logins')),
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
    // Closing the window quits the app (⌘Q closes it too): every page stops now, popups go with it, tabs stay saved.
    window.on('close', () => tabs.shutDown());
    window.on('closed', () => {
      win = null;
      for (const other of BrowserWindow.getAllWindows()) {
        if (isPopupWindow(other) && !other.isDestroyed()) other.destroy();
      }
      app.quit();
    });

    rebuildMenu();
    const first = profiles.visible.find((p) => p.dir === state.activeProfile) ?? profiles.visible[0];
    if (first) {
      tabs.showProfile(first.dir);
      // Every visible profile's active tab runs from the start (mail, calendar reminders); hidden ones stay lazy.
      tabs.loadActiveTabs(profiles.visible.map((p) => p.dir).filter((dir) => dir !== first.dir), STARTUP_STAGGER_MS);
    }
    store.save(state);

    if (!state.firstRunDone) {
      // Once the window shows its bar and sidebar; asked once whatever the answer.
      ui.webContents.once('did-finish-load', () => void imports.offerOnFirstRun(() => {
        state.firstRunDone = true;
        store.save(state);
      }).catch(logFailure('the first-run import offer')));
    }
  }).catch(logFailure('starting'));
}

if (app.requestSingleInstanceLock()) start();
else app.quit();
