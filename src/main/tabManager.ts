import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { sameOrigin, toNavigableUrl } from '../core/address.ts';
import type { Rect, SavedTabs } from '../core/appState.ts';
import {
  activateTab, closeTab, emptyTabs, fromSaved, openTab, reopenClosed, tabIdForShortcut, toSaved, updateTab,
  type ProfileTabs, type TabRecord,
} from '../core/tabs.ts';
import type { Nav } from '../core/visits.ts';
import type { TabInfo } from '../shared/types.ts';
import type { VisitSink } from './historyRecorder.ts';
import { ERR_ABORTED, wirePage, type PageHost } from './pages.ts';
import { pageWebPreferences } from './sessions.ts';

const NEW_TAB_URL = 'https://www.google.com';

/**
 * One WebContentsView per opened tab, all children of the window. Only the active profile's
 * active tab is visible; switching profile or tab toggles visibility and never reloads.
 * Restored tabs get their view (and load) when first shown, or for each visible profile's
 * active tab at startup (`loadActiveTabs`).
 */
export class TabManager {
  private readonly win: BrowserWindow;
  private readonly onChange: () => void;
  private readonly log: (msg: string) => void;
  private readonly profiles = new Map<string, ProfileTabs>();
  private readonly views = new Map<number, WebContentsView>();
  private readonly live = new Map<number, { favicon: string | null; loading: boolean }>();
  /** Profiles whose views play no sound (hidden ones), including views created later. */
  private readonly muted = new Set<string>();
  private dirs: string[] = [];
  private activeDir: string | null = null;
  private shownId: number | null = null;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** The tab whose page is in HTML full screen (a video): its view fills the whole window. */
  private fullScreenId: number | null = null;
  private nextId = 1;
  /** Tabs asked to close whose page may still say "Stay" (beforeunload); they go when their contents are destroyed. */
  private readonly closing = new Set<number>();
  /** Set once the window is closing: views are going away, but the tabs must stay in the saved state. */
  private shuttingDown = false;
  /** Links and popups from a page open in the page's own profile (see `wirePage`). */
  private readonly pageHost: PageHost;
  /** Told about every tab's navigations, titles and favicons (history). */
  private readonly visits: VisitSink;
  /** Told when a tab's page enters or leaves HTML full screen (it then covers the whole window). */
  onFullScreen: ((on: boolean) => void) | null = null;
  /**
   * Icons history remembers per `dir\nurl`, for tabs whose page hasn't reported one (not loaded yet, or just created).
   * Cleared whenever a page reports an icon, so a newly recorded one is picked up.
   */
  private readonly savedIcons = new Map<string, string | null>();
  /** Tabs from saved state or reopened, whose first load (when their view is created) is not a new visit. */
  private readonly restoredIds = new Set<number>();

  constructor(
    win: BrowserWindow, onChange: () => void, log: (msg: string) => void, profileName: (dir: string) => string, visits: VisitSink,
  ) {
    this.win = win;
    this.onChange = onChange;
    this.log = log;
    this.visits = visits;
    this.pageHost = {
      log,
      profileName,
      openTab: (dir, url, opts) => {
        if (!this.shuttingDown) this.newTab(url, { dir, afterId: opts.afterId ?? undefined, activate: opts.activate });
      },
    };
  }

  /** Profiles not seen before are restored from `saved` (lazily); known ones keep their tabs. */
  setProfiles(dirs: string[], saved: Record<string, SavedTabs>): void {
    this.dirs = [...dirs];
    for (const dir of dirs) {
      if (!this.profiles.has(dir)) {
        const s = saved[dir];
        const tabs = s ? fromSaved(s, () => this.nextId++) : emptyTabs();
        for (const t of tabs.tabs) this.restoredIds.add(t.id);
        this.profiles.set(dir, tabs);
      }
    }
    if (this.activeDir !== null && !this.dirs.includes(this.activeDir)) {
      this.activeDir = null;
      this.refreshVisibility();
    }
  }

  showProfile(dir: string): void {
    const tabs = this.profiles.get(dir);
    if (!tabs || !this.dirs.includes(dir)) return;
    this.activeDir = dir;
    if (tabs.tabs.length === 0) {
      this.newTab();
      return;
    }
    this.refreshVisibility();
    this.changed();
  }

  /** Returns the new tab's id, or null when no profile is shown and none is given. */
  newTab(url: string = NEW_TAB_URL, opts: { afterId?: number; activate?: boolean; dir?: string } = {}): number | null {
    const dir = opts.dir ?? this.activeDir;
    const tabs = dir === null ? undefined : this.profiles.get(dir);
    if (dir === null || !tabs) return null;
    const tab: TabRecord = { id: this.nextId++, url, title: '' };
    this.profiles.set(dir, openTab(tabs, tab, { activate: opts.activate ?? true, afterId: opts.afterId }));
    this.createView(dir, tab);
    this.refreshVisibility();
    this.changed();
    return tab.id;
  }

  /**
   * Closes the tab once its page agrees: a page with a beforeunload handler gets the "Leave site?" sheet
   * (pages.ts), and on Stay the tab stays as it is. The tab leaves the model when its contents are destroyed.
   */
  closeTab(id: number): void {
    if (this.dirOf(id) === null) return;
    const wc = openContents(this.views.get(id));
    if (!wc) {
      this.removeTab(id);
      return;
    }
    this.closing.add(id);
    wc.close({ waitForBeforeUnload: true });
  }

  /** The window is closing (the app quits): closes every page now (no beforeunload) and keeps the tabs as saved. */
  shutDown(): void {
    this.shuttingDown = true;
    for (const view of this.views.values()) openContents(view)?.close();
  }

  /**
   * Loads the active tab of each of `dirs` (in order, `staggerMs` apart so startup isn't one burst) that has no
   * view yet. They stay hidden until shown; profiles that are no longer visible by then are skipped.
   */
  loadActiveTabs(dirs: string[], staggerMs: number): void {
    dirs.forEach((dir, i) => {
      setTimeout(() => {
        if (this.shuttingDown || this.win.isDestroyed() || !this.dirs.includes(dir)) return;
        const tabs = this.profiles.get(dir);
        const tab = tabs?.tabs.find((t) => t.id === tabs.activeId);
        if (tab && !this.views.has(tab.id)) this.createView(dir, tab);
      }, (i + 1) * staggerMs);
    });
  }

  private removeTab(id: number): void {
    const dir = this.dirOf(id);
    if (dir === null) return;
    this.profiles.set(dir, closeTab(this.profiles.get(dir)!, id));
    this.destroyView(id);
    if (dir === this.activeDir && this.profiles.get(dir)!.tabs.length === 0) {
      this.newTab();
      return;
    }
    this.refreshVisibility();
    this.changed();
  }

  reopenClosedTab(): void {
    const dir = this.activeDir;
    const reopened = dir === null ? null : reopenClosed(this.profiles.get(dir)!);
    if (dir === null || !reopened) return;
    this.profiles.set(dir, reopened.state);
    this.restoredIds.add(reopened.tab.id);
    this.createView(dir, reopened.tab);
    this.refreshVisibility();
    this.changed();
  }

  selectTab(id: number): void {
    const dir = this.dirOf(id);
    if (dir === null) return;
    this.profiles.set(dir, activateTab(this.profiles.get(dir)!, id));
    this.refreshVisibility();
    this.changed();
  }

  /** The profile's tabs in sidebar order (`[]` if it is unknown), for picking a pin's tab. */
  tabsOf(dir: string): { id: number; url: string }[] {
    return (this.profiles.get(dir)?.tabs ?? []).map((t) => ({ id: t.id, url: t.url }));
  }

  /** The tab's title as the model holds it ('' when unknown). */
  titleOf(dir: string, id: number): string {
    return this.profiles.get(dir)?.tabs.find((t) => t.id === id)?.title ?? '';
  }

  /** The tab's favicon: its page's, else the one history remembers for its URL (null if neither is known). */
  faviconOf(id: number): string | null {
    const dir = this.dirOf(id);
    const tab = dir === null ? undefined : this.profiles.get(dir)?.tabs.find((t) => t.id === id);
    return dir === null || !tab ? null : this.iconOf(dir, tab);
  }

  /**
   * A tab not loaded yet (lazy restore) has no page to report an icon, and a new page reports its own only once loaded:
   * meanwhile the tab shows the icon history last saw for its URL or site, rather than none.
   */
  private iconOf(dir: string, tab: TabRecord): string | null {
    const own = this.live.get(tab.id)?.favicon;
    if (own) return own;
    const key = `${dir}\n${tab.url}`;
    let saved = this.savedIcons.get(key);
    if (saved === undefined) {
      saved = this.visits.savedFavicon(dir, tab.url);
      this.savedIcons.set(key, saved);
    }
    return saved;
  }

  /**
   * Shows `dir` with its tab `id` active in one switch (a pin click from another profile). A tab not loaded yet
   * gets its view now; a loaded one is only made visible, never reloaded.
   */
  showTab(dir: string, id: number): void {
    const tabs = this.profiles.get(dir);
    if (!tabs || !this.dirs.includes(dir) || !tabs.tabs.some((t) => t.id === id)) return;
    this.activeDir = dir;
    this.profiles.set(dir, activateTab(tabs, id));
    this.refreshVisibility();
    this.changed();
  }

  /** Shows `dir` with a new active tab at `url` in one switch (a pin with no tab on its site). */
  showNewTab(dir: string, url: string): void {
    if (!this.profiles.has(dir) || !this.dirs.includes(dir)) return;
    this.activeDir = dir;
    this.newTab(url, { dir });
  }

  selectTabByShortcut(n: number): void {
    const tabs = this.activeDir === null ? undefined : this.profiles.get(this.activeDir);
    const id = tabs ? tabIdForShortcut(tabs, n) : null;
    if (id !== null) this.selectTab(id);
  }

  navigate(input: string): void {
    const url = toNavigableUrl(input);
    if (url === null) return;
    const wc = this.activeWebContents();
    if (wc) load(wc, url);
    else this.newTab(url);
  }

  back(): void {
    const history = this.activeWebContents()?.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  forward(): void {
    const history = this.activeWebContents()?.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload(): void {
    this.activeWebContents()?.reload();
  }

  /** Mutes or unmutes every created view of the profile, and views it creates from now on. */
  setProfileMuted(dir: string, muted: boolean): void {
    if (muted) this.muted.add(dir);
    else this.muted.delete(dir);
    for (const [id, view] of this.views) {
      if (this.dirOf(id) === dir) openContents(view)?.setAudioMuted(muted);
    }
  }

  /** Reloads the profile's tabs that have loaded (lazy ones load fresh when first shown anyway). */
  reloadProfile(dir: string): void {
    for (const [id, view] of this.views) {
      if (this.dirOf(id) === dir) openContents(view)?.reload();
    }
  }

  activeWebContents(): WebContents | null {
    const id = this.activeTab()?.id;
    return id === undefined ? null : openContents(this.views.get(id));
  }

  snapshot(): { dir: string; tabs: TabInfo[]; activeTabId: number | null; url: string; canGoBack: boolean; canGoForward: boolean } {
    const dir = this.activeDir;
    const tabs = dir === null ? emptyTabs() : this.profiles.get(dir)!;
    const history = this.activeWebContents()?.navigationHistory;
    return {
      dir: this.activeDir ?? '',
      tabs: tabs.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: dir === null ? null : this.iconOf(dir, t),
        loading: this.live.get(t.id)?.loading ?? false,
      })),
      activeTabId: tabs.activeId,
      url: this.activeTab()?.url ?? '',
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
    };
  }

  savedState(): Record<string, SavedTabs> {
    const out: Record<string, SavedTabs> = {};
    for (const [dir, tabs] of this.profiles) out[dir] = toSaved(tabs);
    return out;
  }

  /** Every view gets the same rect so a hidden tab is already sized when shown; a full-screen page gets the window. */
  layout(rect: Rect): void {
    this.bounds = rect;
    for (const [id, view] of this.views) view.setBounds(id === this.fullScreenId ? this.windowRect() : rect);
  }

  /** Tabs changed: save and show it, unless the window is closing (pages going away must not drop saved tabs). */
  private changed(): void {
    if (!this.shuttingDown) this.onChange();
  }

  private activeTab(): TabRecord | undefined {
    const tabs = this.activeDir === null ? undefined : this.profiles.get(this.activeDir);
    return tabs?.tabs.find((t) => t.id === tabs.activeId);
  }

  private windowRect(): Rect {
    const [width = 0, height = 0] = this.win.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  /**
   * A page went HTML full screen: its view covers the sidebar and bar (the UI view stays below). The window
   * itself is put in full screen by Electron, which also leaves it on exit only if the page had entered it.
   */
  private enterFullScreen(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.fullScreenId = id;
    view.setBorderRadius(0);
    view.setBounds(this.windowRect());
    this.onFullScreen?.(true);
  }

  private leaveFullScreen(id: number): void {
    if (this.fullScreenId !== id) return;
    this.fullScreenId = null;
    this.onFullScreen?.(false);
    const view = this.views.get(id);
    if (!view) return;
    view.setBorderRadius(10);
    view.setBounds(this.bounds);
  }

  private dirOf(id: number): string | null {
    for (const [dir, tabs] of this.profiles) if (tabs.tabs.some((t) => t.id === id)) return dir;
    return null;
  }

  /** Shows the active profile's active tab (creating its view on first show) and hides the previous one. */
  private refreshVisibility(): void {
    const tab = this.activeTab();
    const target = tab?.id ?? null;
    if (target === this.shownId) return;
    if (this.shownId !== null) this.views.get(this.shownId)?.setVisible(false);
    // Switching away (⌃N, ⌘N) from a full-screen video ends its full screen, so the new page isn't left behind it.
    if (this.fullScreenId !== null && this.fullScreenId !== target) {
      this.views.get(this.fullScreenId)?.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      this.leaveFullScreen(this.fullScreenId);
    }
    this.shownId = target;
    if (tab && this.activeDir !== null) {
      const view = this.views.get(tab.id) ?? this.createView(this.activeDir, tab);
      view.setVisible(true);
      view.webContents.focus();
    }
  }

  private createView(dir: string, tab: TabRecord): WebContentsView {
    const view = new WebContentsView({
      webPreferences: pageWebPreferences(dir),
    });
    view.setBorderRadius(10);
    view.webContents.setAudioMuted(this.muted.has(dir));
    view.setVisible(false);
    view.setBounds(this.bounds);
    this.win.contentView.addChildView(view);
    this.views.set(tab.id, view);
    this.live.set(tab.id, { favicon: null, loading: false });
    this.visits.opened(dir, tab.id, this.restoredIds.delete(tab.id));
    this.wire(view, dir, tab.id);
    load(view.webContents, tab.url);
    return view;
  }

  private destroyView(id: number): void {
    const view = this.views.get(id);
    this.views.delete(id);
    this.live.delete(id);
    this.restoredIds.delete(id);
    this.visits.closed(id);
    if (this.shownId === id) this.shownId = null;
    if (this.fullScreenId === id) this.fullScreenId = null;
    if (!view) return;
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
    openContents(view)?.close();
  }

  private wire(view: WebContentsView, dir: string, id: number): void {
    const wc = view.webContents;
    wirePage(wc, dir, id, () => (this.win.isDestroyed() ? null : this.win), this.pageHost);
    // A closed tab's id can come back (reopen) with a new view; ignore events from the old one.
    const current = () => this.views.get(id) === view;
    const patch = (p: Partial<Pick<TabRecord, 'url' | 'title'>>) => {
      const dir = this.dirOf(id);
      if (dir === null) return;
      this.profiles.set(dir, updateTab(this.profiles.get(dir)!, id, p));
      this.changed();
    };
    const setLive = (p: Partial<{ favicon: string | null; loading: boolean }>) => {
      const entry = this.live.get(id);
      if (!entry) return;
      Object.assign(entry, p);
      this.changed();
    };
    wc.on('page-title-updated', (_e, title) => {
      if (!current()) return;
      patch({ title });
      this.visits.titled(dir, wc.getURL(), title);
    });
    // The icon is not cleared on navigation: Chromium reports a page's icons only when they differ from the previous
    // page's (a reload, or another page of the same site, reports nothing), so the last icons reported are the shown
    // page's. Clearing them left such tabs with no icon. Within a site the new page's history entry gets that icon
    // too; on another site it is only shown until that site's own icons arrive, never recorded for it.
    const navigated = (url: string) => {
      const from = this.profiles.get(dir)?.tabs.find((t) => t.id === id)?.url ?? '';
      patch({ url });
      this.visits.navigated(dir, id, navOf(wc, url));
      const icon = this.live.get(id)?.favicon;
      if (icon && sameOrigin(from, url)) this.visits.favicon(dir, url, icon);
    };
    wc.on('did-navigate', (_e, url) => { if (current()) navigated(url); });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (current() && isMainFrame) navigated(url); });
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (!current()) return;
      this.savedIcons.clear();
      setLive({ favicon: favicons[0] ?? null });
      if (favicons[0]) this.visits.favicon(dir, wc.getURL(), favicons[0]);
    });
    wc.on('did-start-loading', () => { if (current()) setLive({ loading: true }); });
    wc.on('did-stop-loading', () => { if (current()) setLive({ loading: false }); });
    // No in-page error UI yet (Electron has no Chrome net-error page; the tab stays blank): at least leave a trace.
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.log(`tab ${id} failed to load ${url}: ${description} (${code})`);
    });
    // Closed by closeTab (the page didn't object, or the user chose Leave): the tab goes now.
    wc.once('destroyed', () => {
      if (this.closing.delete(id) && current() && !this.shuttingDown) this.removeTab(id);
    });
    wc.on('enter-html-full-screen', () => { if (current()) this.enterFullScreen(id); });
    wc.on('leave-html-full-screen', () => { if (current()) this.leaveFullScreen(id); });
  }
}

/** A view's page, unless it is closed (Electron then drops the view's `webContents`). */
function openContents(view: WebContentsView | undefined): WebContents | null {
  const wc = view?.webContents as WebContents | undefined;
  return wc && !wc.isDestroyed() ? wc : null;
}

/** The page's place in its session history, for telling a new visit from Back/Forward (`VisitTracker`). */
function navOf(wc: WebContents, url: string): Nav {
  const nh = wc.navigationHistory;
  return { url, index: nh.getActiveIndex(), entries: nh.getAllEntries().map((e) => e.url) };
}

/** Failures are logged by the tab's `did-fail-load` listener (which also sees link clicks), so the rejection is only noise. */
function load(wc: WebContents, url: string): void {
  wc.loadURL(url).catch(() => {});
}
