import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, Menu, Notification, type WebContents, type WebContentsView } from 'electron';
import { isWebUrl, toNavigableUrl } from '../core/address.ts';
import {
  addBookmark, addFolder, findByUrl, findNode, flattenBookmarks, folderChoices, moveNode, removeNode, renameNode, type BookmarkTree,
} from '../core/bookmarks.ts';
import type { HistoryEntry } from '../core/history.ts';
import { chromeMajor, userAgent } from '../core/identity.ts';
import {
  addPin, keyOf, movePin, pinKey, pinLabel, pinTarget, rememberShown, removePin, withFavicon, type Pin,
} from '../core/pins.ts';
import { mergeProfiles, profileLabel, setDisplayName, withDisplayNames } from '../core/profiles.ts';
import { createStore } from '../core/store.ts';
import { sameSavedTabs } from '../core/tabs.ts';
import { downloadsOf } from '../core/downloads.ts';
import { bookmarkMenuSpec, historyMenuSpec } from '../core/libraryMenus.ts';
import { sectionToggle, withSection } from '../core/sections.ts';
import { splitWords } from '../core/searchText.ts';
import { trailingThrottle } from '../core/throttle.ts';
import { inlineCompletion, rankSuggestions } from '../core/suggest.ts';
import { barPins, barProfiles, parseUiCommand } from '../core/uiProtocol.ts';
import {
  IPC, type BookmarkNode, type DownloadState, type LibraryReply, type Section, type UiCommand, type UiState,
} from '../shared/types.ts';
import { createBrowserWindow, createUiView, FindBar, layoutWindow } from './browserWindow.ts';
import { newProfileInChrome, openProfileInChrome, readChromeProfiles } from './chrome.ts';
import { ImportFlow } from './importFlow.ts';
import { HistoryRecorder } from './historyRecorder.ts';
import { Library } from './library.ts';
import { buildAddProfileMenu, buildLibraryMenu, buildMenu, buildPinMenu, buildTabMenu, type MenuContext } from './menu.ts';
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
  /** Each pin's remembered tab (by pin key): the tab last shown on the pin's host in its profile. This run only. */
  let remembered = new Map<string, number>();
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

  const profileName = (dir: string): string => {
    const found = state.knownProfiles.find((p) => p.dir === dir);
    return found ? profileLabel(found, state.displayNames) : dir;
  };

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
        profiles: barProfiles(profiles.visible, state.displayNames),
        pins: barPins(state.pins, profiles.visible, state.displayNames, snap),
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
      // A pin follows its host: the shown tab on a pinned host becomes that pin's tab, and lends it its favicon.
      noteShownTab();
      const snap = tabs.snapshot();
      const key = snap.dir ? pinKey(snap.dir, snap.url) : null;
      const favicon = snap.tabs.find((t) => t.id === snap.activeTabId)?.favicon ?? null;
      const pins = key === null ? state.pins : withFavicon(state.pins, key, favicon);
      if (pins !== state.pins) {
        state.pins = pins;
        store.save(state);
      }
      syncPinTabItem();
      findBar.follow(tabs.activeWebContents()); // switching tab or profile closes the find bar
      pushState();
    }, log, profileName, recorder);
    const profiles = new ProfileManager({
      state,
      tabs,
      window,
      log,
      rebuildMenu: () => rebuildMenu(),
      editDisplayName: (dir) => {
        window.focus();
        ui.webContents.focus();
        toUi(IPC.editProfileName, dir);
      },
      saveAndPush: () => {
        store.save(state);
        pushState();
      },
    });
    const imports = new ImportFlow({
      window,
      log,
      activeProfile: () => withDisplayNames(profiles.visible, state.displayNames).find((p) => p.dir === tabs.snapshot().dir) ?? null,
      visibleProfiles: () => withDisplayNames(profiles.visible, state.displayNames),
      reloadProfile: (dir) => tabs.reloadProfile(dir),
      library,
      libraryChanged,
    });

    // Pinned tabs: saved sites (profile + URL) in the bar. A pin's tab is only ever opened in the pin's own profile,
    // through TabManager; pins of hidden profiles are left out of the bar, the menu and ⌥⌘N.
    const noteShownTab = (): void => {
      const snap = tabs.snapshot();
      remembered = rememberShown(remembered, state.pins, { dir: snap.dir, tabId: snap.activeTabId, url: snap.url });
    };
    const isPinned = (pin: Pin): boolean => {
      const key = pinKey(pin.dir, pin.url);
      return key !== null && state.pins.some((p) => keyOf(p) === key);
    };
    /** What pinning the shown profile's tab `id` would save; null if the shown profile has no such tab. */
    const pinOfTab = (id: number | null): Pin | null => {
      const snap = tabs.snapshot();
      const tab = snap.tabs.find((t) => t.id === id);
      return tab && snap.dir ? { dir: snap.dir, url: tab.url, title: tab.title, favicon: tab.favicon } : null;
    };
    /** The Tab menu's "Pinned to Bar" checkbox for the main window's active tab. */
    const activeTabPinState = (): { canPin: boolean; pinned: boolean } => {
      const pin = pinOfTab(tabs.snapshot().activeTabId);
      return { canPin: pin !== null && pinKey(pin.dir, pin.url) !== null, pinned: pin !== null && isPinned(pin) };
    };
    /** Electron flips the checkbox on click, and the active tab changes without a menu rebuild: set it from the pins. */
    const syncPinTabItem = (): void => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('pinTab');
      if (!item) return;
      const { canPin, pinned } = activeTabPinState();
      item.checked = pinned;
      item.enabled = canPin;
    };
    /** Shown pins only (visible profiles), in bar order, numbered for ⌥⌘1…⌥⌘9. */
    const shownPins = () => barPins(state.pins, profiles.visible, state.displayNames, tabs.snapshot());
    const pinsChanged = (): void => {
      store.save(state);
      noteShownTab(); // a tab pinned while shown is that pin's tab from now on
      rebuildMenu();
      pushState();
    };
    /** Pins the tab's site in its profile, or unpins it if that site is pinned there already. */
    const togglePin = (pin: Pin): void => {
      const key = pinKey(pin.dir, pin.url);
      if (key === null) return;
      state.pins = isPinned(pin) ? removePin(state.pins, key) : addPin(state.pins, pin);
      pinsChanged();
    };
    /** Shows the pin's profile and its tab: the remembered one, else the first on its host, else a new one. */
    const openPin = (pin: Pin): void => {
      if (!profiles.dirs.has(pin.dir)) return;
      const t = pinTarget(pin, tabs.tabsOf(pin.dir), remembered.get(keyOf(pin)) ?? null);
      if (t.kind === 'open') {
        tabs.showNewTab(pin.dir, t.url);
        return;
      }
      const snap = tabs.snapshot();
      if (snap.dir !== pin.dir || snap.activeTabId !== t.id) tabs.showTab(pin.dir, t.id); // a selected pin does nothing
    };
    const shownPin = (key: string): Pin | null => state.pins.find((p) => keyOf(p) === key && profiles.dirs.has(p.dir)) ?? null;
    const showPinMenu = (key: string): void => {
      if (!shownPin(key)) {
        log(`ignored a menu for pin ${key}: not shown`);
        return;
      }
      const moved = (step: -1 | 1) => movePin(state.pins, key, step, profiles.dirs);
      buildPinMenu({
        canMoveLeft: moved(-1) !== null,
        canMoveRight: moved(1) !== null,
        unpin: () => {
          state.pins = removePin(state.pins, key);
          pinsChanged();
        },
        move: (step) => {
          const next = moved(step);
          if (next) {
            state.pins = next;
            pinsChanged();
          }
        },
      }).popup({ window });
    };
    const showTabMenu = (id: number): void => {
      const pin = pinOfTab(id);
      if (!pin) {
        log(`ignored a menu for tab ${id}: not in the shown profile`);
        return;
      }
      buildTabMenu({
        canPin: pinKey(pin.dir, pin.url) !== null,
        pinned: isPinned(pin),
        togglePin: () => togglePin(pin),
        close: () => tabs.closeTab(id),
      }).popup({ window });
    };

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

    const menuActions: Omit<MenuContext, 'profiles' | 'hiddenProfiles' | 'showNames' | 'pins' | 'activeTabPinned' | 'canPinActiveTab'> = {
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
      selectPin: (n) => {
        const shown = shownPins()[n - 1];
        const pin = shown ? shownPin(shown.key) : null;
        if (pin) openPin(pin);
      },
      togglePinActiveTab: () => {
        const pin = pinOfTab(tabs.snapshot().activeTabId);
        if (pin) togglePin(pin);
        syncPinTabItem(); // also when nothing changed: undo Electron's flip
      },
    };
    const rebuildMenu = (): void => {
      const { canPin, pinned } = activeTabPinState();
      Menu.setApplicationMenu(buildMenu({
        ...menuActions,
        profiles: withDisplayNames(profiles.visible, state.displayNames),
        hiddenProfiles: withDisplayNames(profiles.hidden, state.displayNames),
        showNames: state.showNames,
        pins: shownPins().map((p) => ({ label: pinLabel(p) })),
        canPinActiveTab: canPin,
        activeTabPinned: pinned,
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
        case 'selectPin': {
          const pin = shownPin(cmd.key);
          if (pin) openPin(pin);
          else log(`ignored selecting pin ${cmd.key}: not shown`);
          break;
        }
        case 'pinMenu': showPinMenu(cmd.key); break;
        case 'tabMenu': showTabMenu(cmd.id); break;
        case 'setDisplayName':
          state.displayNames = setDisplayName(state.displayNames, cmd.dir, cmd.name);
          store.save(state);
          rebuildMenu();
          pushState();
          break;
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
