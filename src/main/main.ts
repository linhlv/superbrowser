import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, Notification, type WebContents, type WebContentsView } from 'electron';
import { isWebUrl, toNavigableUrl } from '../core/address.ts';
import {
  addBookmark, addFolder, findByUrl, findNode, flattenBookmarks, folderChoices, moveNode, removeNode, renameNode, type BookmarkTree,
} from '../core/bookmarks.ts';
import type { HistoryEntry } from '../core/history.ts';
import { chromeMajor, userAgent } from '../core/identity.ts';
import { mergeProfiles } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import { sameSavedTabs } from '../core/tabs.ts';
import { downloadsOf } from '../core/downloads.ts';
import { bookmarkMenuSpec, historyMenuSpec } from '../core/libraryMenus.ts';
import { sectionToggle, withSection } from '../core/sections.ts';
import { splitWords } from '../core/searchText.ts';
import { trailingThrottle } from '../core/throttle.ts';
import { inlineCompletion, rankSuggestions } from '../core/suggest.ts';
import { barProfiles, parseUiCommand } from '../core/uiProtocol.ts';
import {
  IPC, type BookmarkNode, type DownloadState, type LibraryReply, type Section, type UiCommand, type UiState,
} from '../shared/types.ts';
import { createBrowserWindow, createUiView, FindBar, layoutWindow } from './browserWindow.ts';
import { newProfileInChrome, openProfileInChrome, readChromeProfiles } from './chrome.ts';
import { ImportFlow } from './importFlow.ts';
import { HistoryRecorder } from './historyRecorder.ts';
import { Library } from './library.ts';
import { buildAddProfileMenu, buildLibraryMenu, buildMenu, type MenuContext } from './menu.ts';
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

/** Visits older than the retention window are pruned when a profile's history opens, and this often after. */
const HISTORY_PRUNE_INTERVAL_MS = 24 * 3600e3;

/** History entries matching the typed words that suggestions are ranked from, and rows per History section page. */
const SUGGEST_CANDIDATES = 50, HISTORY_PAGE_SIZE = 100;

/** Visits and titles recorded in the shown profile reach the UI at most this often (trailing, so the last one lands). */
const HISTORY_NOTICE_MS = 1500;

/** Zoom levels (factor 1.2^level) step by half a level; Chromium allows factors 0.25–5. */
const ZOOM_STEP = 0.5, MIN_ZOOM = -7.5, MAX_ZOOM = 8.5;

function start(): void {
  const store = createStore(path.join(app.getPath('userData'), 'state.json'));
  const state = store.load();
  // Each profile's bookmarks and history, opened on first use.
  const library = new Library(app.getPath('userData'), log);
  const recorder = new HistoryRecorder(library, log);
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
  app.on('will-quit', () => library.closeAll());
  app.on('window-all-closed', () => app.quit());
  setInterval(() => library.pruneAll(), HISTORY_PRUNE_INTERVAL_MS).unref();

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
        openSections: state.openSections,
        downloads: downloadsOf(downloads, snap.dir), // other profiles' file names stay out of view (screen sharing)
      };
      ui.webContents.send(IPC.state, uiState);
    };
    /** Sends to the UI view unless it is gone (the window is closing). */
    const toUi = (channel: string, ...args: unknown[]): void => {
      if (!ui.webContents.isDestroyed()) ui.webContents.send(channel, ...args);
    };
    /** The shown profile's bookmarks or history changed: an open section refetches. */
    const libraryChanged = (): void => toUi(IPC.libraryChanged);

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
    }, log, profileName, recorder);
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
      library,
      libraryChanged,
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

    // Bookmarks and history: every command and menu item acts on the profile shown when it arrives.
    const shownDir = (): string | null => tabs.snapshot().dir || null;

    // A visit or title recorded in the shown profile (never another one): an open History section scrolled to the
    // top and not searching refetches its first page. Not libraryChanged, which reloads everything unconditionally.
    const historyNotice = trailingThrottle(() => toUi(IPC.historyRecorded), HISTORY_NOTICE_MS);
    recorder.onRecorded = (dir) => { if (dir === shownDir()) historyNotice.call(); };

    /** `fn()`, or `fallback` if it throws (history that can't open, a failed write): logged, and the caller carries on. */
    const orElse = <T>(what: string, fallback: T, fn: () => T): T => {
      try {
        return fn();
      } catch (e) {
        logFailure(what)(e);
        return fallback;
      }
    };

    /** Saves the edited tree (false if that failed) and tells the UI. */
    const editBookmarks = (dir: string, fn: (t: BookmarkTree) => BookmarkTree): boolean => {
      const saved = orElse(`saving the bookmarks of ${dir}`, false, () => {
        library.updateBookmarks(dir, fn);
        return true;
      });
      libraryChanged();
      return saved;
    };

    /** A sheet on the main window; true when `button` (not Cancel) was chosen. */
    const confirm = async (message: string, button: string): Promise<boolean> => {
      const { response } = await dialog.showMessageBox(window, { type: 'question', message, buttons: [button, 'Cancel'], defaultId: 0, cancelId: 1 });
      return response === 0;
    };

    /** In the main window even if a popup has focus; the sidebar is shown first if hidden (and the section then opened, never folded). */
    const showPanel = (panel: Section, mode: 'toggle' | 'show', highlight: number | null): void => {
      const reveal = !state.sidebarVisible;
      if (reveal) setSidebarVisible(true);
      const r = sectionToggle(state.openSections, panel, mode, highlight, reveal);
      state.openSections = r.open;
      store.save(state);
      if (r.request.open) {
        window.focus();
        ui.webContents.focus(); // so the section's search box can take the keyboard
      } else if (ui.webContents.isFocused()) {
        tabs.activeWebContents()?.focus(); // the folding section may hold the keyboard: give it to the page, not to nothing
      }
      toUi(IPC.panel, r.request);
    };

    /** The answer to a request from the UI; history that can't be read gives empty results, never no reply. */
    const libraryReply = (cmd: Extract<UiCommand, { type: 'suggest' | 'historyPage' | 'bookmarks' }>): LibraryReply => {
      const dir = shownDir();
      const historyOr = <T>(fallback: T, read: (dir: string) => T): T =>
        dir ? orElse(`reading the history of ${dir}`, fallback, () => read(dir)) : fallback;
      switch (cmd.type) {
        case 'suggest': {
          const { seq, text } = cmd;
          const history = historyOr<HistoryEntry[]>([], (d) => library.history(d).candidates(splitWords(text), SUGGEST_CANDIDATES));
          const bookmarks = dir ? flattenBookmarks(library.bookmarks(dir).nodes).map(({ url, title }) => ({ url, title })) : [];
          return { kind: 'suggestions', seq, text, completion: inlineCompletion(text, history), items: rankSuggestions({ text, history, bookmarks, now: Date.now() }) };
        }
        case 'historyPage': {
          const { query, before } = cmd;
          const page = historyOr({ rows: [], more: false }, (d) => library.history(d).page(query, before, HISTORY_PAGE_SIZE, new Date().getTimezoneOffset()));
          return { kind: 'historyPage', seq: cmd.seq, ...page };
        }
        case 'bookmarks': {
          const nodes = dir ? library.bookmarks(dir).nodes : [];
          const favicons = historyOr({}, (d) => library.history(d).faviconsFor(flattenBookmarks(nodes).map((b) => b.url)));
          return { kind: 'bookmarks', seq: cmd.seq, nodes, favicons };
        }
      }
    };

    const showHistoryMenu = (url: string): void => {
      const dir = shownDir();
      if (!dir) return;
      buildLibraryMenu(historyMenuSpec(), (choice) => {
        switch (choice.id) {
          case 'openInNewTab': tabs.newTab(url, { dir }); break;
          case 'copyLink': clipboard.writeText(url); break;
          case 'deleteFromHistory':
            orElse(`deleting a page from the history of ${dir}`, undefined, () => library.history(dir).deleteUrl(url));
            libraryChanged();
            break;
        }
      }).popup({ window });
    };

    /** Deleting a folder with something in it asks first. */
    const deleteBookmark = async (dir: string, node: BookmarkNode): Promise<void> => {
      if (node.kind === 'folder' && node.children.length > 0
        && !await confirm(`Delete “${node.title || 'Untitled'}” and everything in it?`, 'Delete')) return;
      editBookmarks(dir, (t) => removeNode(t, node.id));
    };

    const showBookmarkMenu = (id: number): void => {
      const dir = shownDir();
      const tree = dir ? library.bookmarks(dir) : null;
      const node = tree ? findNode(tree, id)?.node : undefined;
      if (!dir || !tree || !node) {
        log(`ignored a menu for bookmark ${id}: not in the shown profile`);
        return;
      }
      buildLibraryMenu(bookmarkMenuSpec(node, folderChoices(tree, id)), (choice) => {
        switch (choice.id) {
          case 'openInNewTab': if (node.kind === 'url') tabs.newTab(node.url, { dir }); break;
          case 'copyLink': if (node.kind === 'url') clipboard.writeText(node.url); break;
          case 'rename': toUi(IPC.startRename, id); break;
          case 'moveTo': editBookmarks(dir, (t) => moveNode(t, id, choice.folderId)); break;
          case 'newFolder': {
            const added = addFolder(library.bookmarks(dir), id, 'New Folder', Date.now());
            if (added.id !== null && editBookmarks(dir, () => added.tree)) toUi(IPC.startRename, added.id);
            break;
          }
          case 'delete': void deleteBookmark(dir, node).catch(logFailure('deleting a bookmark')); break;
        }
      }).popup({ window });
    };

    const renameBookmark = (id: number, title: string): void => {
      const dir = shownDir();
      if (dir && findNode(library.bookmarks(dir), id)) editBookmarks(dir, (t) => renameNode(t, id, title));
      else log(`ignored renaming bookmark ${id}: not in the shown profile`);
    };

    /** The main window's active tab (never a popup's): bookmarked unless it already is, then shown in the Bookmarks section. */
    const bookmarkPage = (): void => {
      const snap = tabs.snapshot();
      const dir = snap.dir;
      if (!dir) return;
      let highlight: number | null = null;
      if (isWebUrl(snap.url)) {
        const tree = library.bookmarks(dir);
        const existing = findByUrl(tree, snap.url);
        if (existing) {
          highlight = existing.id;
        } else {
          const title = snap.tabs.find((t) => t.id === snap.activeTabId)?.title || snap.url;
          const added = addBookmark(tree, { title, url: snap.url }, Date.now());
          if (added.id !== null && editBookmarks(dir, () => added.tree)) highlight = added.id;
        }
      }
      showPanel('bookmarks', 'show', highlight);
    };

    const clearHistory = async (): Promise<void> => {
      const dir = shownDir();
      if (!dir || !await confirm(`Clear all history for ${profileName(dir)}?`, 'Clear History')) return;
      orElse(`clearing the history of ${dir}`, undefined, () => library.history(dir).clear());
      libraryChanged();
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
      showHistory: () => showPanel('history', 'toggle', null),
      clearHistory: () => void clearHistory().catch(logFailure('clearing history')),
      bookmarkPage,
      showBookmarks: () => showPanel('bookmarks', 'toggle', null),
      showProfile: (dir) => tabs.showProfile(dir),
      importLogins: (mode) => void imports.importCurrent(mode).catch(logFailure('importing logins')),
      importLoginsForAllProfiles: () => void imports.importAll().catch(logFailure('importing logins')),
      importLibrary: () => void imports.importLibraryAll().catch(logFailure('importing bookmarks and history')),
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
        case 'reorderProfile': profiles.place(cmd.dir, cmd.before); break;
        case 'addProfileMenu':
          buildAddProfileMenu({
            importLogins: () => menuActions.importLogins('add'),
            importLoginsForAllProfiles: () => menuActions.importLoginsForAllProfiles(),
            importLibrary: () => menuActions.importLibrary(),
            newProfileInChrome: () => newProfileInChrome(log),
          }).popup({ window });
          break;
        case 'selectTab': tabs.selectTab(cmd.id); break;
        case 'closeTab': tabs.closeTab(cmd.id); break;
        case 'newTab': tabs.newTab(); break;
        case 'navigate': {
          // Typed in the address field: the tab's next navigation ranks higher in suggestions.
          const id = tabs.snapshot().activeTabId;
          if (id !== null && toNavigableUrl(cmd.input) !== null) recorder.markTyped(id);
          tabs.navigate(cmd.input);
          tabs.activeWebContents()?.focus(); // like Chrome: the page, not the address field, has focus afterwards
          break;
        }
        case 'back': tabs.back(); break;
        case 'forward': tabs.forward(); break;
        case 'reload': tabs.reload(); break;
        case 'toggleSidebar': setSidebarVisible(!state.sidebarVisible); break;
        case 'revealDownload': revealDownload(cmd.id); break;
        case 'find': findBar.find(cmd.text, cmd.forward); break;
        case 'findClose': findBar.close(true); break;
        case 'suggest':
        case 'historyPage':
        case 'bookmarks':
          toUi(IPC.library, libraryReply(cmd));
          break;
        case 'openUrl':
          if (cmd.newTab) tabs.newTab(cmd.url);
          else tabs.navigate(cmd.url);
          break;
        case 'historyMenu': showHistoryMenu(cmd.url); break;
        case 'bookmarkMenu': showBookmarkMenu(cmd.id); break;
        case 'renameBookmark': renameBookmark(cmd.id, cmd.title); break;
        case 'setSectionOpen':
          state.openSections = withSection(state.openSections, cmd.section, cmd.open);
          store.save(state);
          break;
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
    // Back from Chrome (e.g. after creating a profile there): pick up the new profile.
    window.on('focus', () => profiles.refresh(readChromeProfiles()));

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
