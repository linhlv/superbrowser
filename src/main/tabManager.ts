import { WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import { toNavigableUrl } from '../core/address.ts';
import type { Rect, SavedTabs } from '../core/appState.ts';
import {
  activateTab, closeTab, emptyTabs, fromSaved, openTab, reopenClosed, tabIdForShortcut, toSaved, updateTab,
  type ProfileTabs, type TabRecord,
} from '../core/tabs.ts';
import type { UiTab } from '../shared/types.ts';
import { pageWebPreferences } from './sessions.ts';

const NEW_TAB_URL = 'https://www.google.com';

/**
 * One WebContentsView per opened tab, all children of the window. Only the active profile's
 * active tab is visible; switching profile or tab toggles visibility and never reloads.
 * Restored tabs get their view (and load) only when first shown.
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
  private nextId = 1;

  constructor(win: BrowserWindow, onChange: () => void, log: (msg: string) => void) {
    this.win = win;
    this.onChange = onChange;
    this.log = log;
  }

  /** Profiles not seen before are restored from `saved` (lazily); known ones keep their tabs. */
  setProfiles(dirs: string[], saved: Record<string, SavedTabs>): void {
    this.dirs = [...dirs];
    for (const dir of dirs) {
      if (!this.profiles.has(dir)) {
        const s = saved[dir];
        this.profiles.set(dir, s ? fromSaved(s, () => this.nextId++) : emptyTabs());
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
    this.onChange();
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
    this.onChange();
    return tab.id;
  }

  closeTab(id: number): void {
    const dir = this.dirOf(id);
    if (dir === null) return;
    this.profiles.set(dir, closeTab(this.profiles.get(dir)!, id));
    this.destroyView(id);
    if (dir === this.activeDir && this.profiles.get(dir)!.tabs.length === 0) {
      this.newTab();
      return;
    }
    this.refreshVisibility();
    this.onChange();
  }

  reopenClosedTab(): void {
    const dir = this.activeDir;
    const reopened = dir === null ? null : reopenClosed(this.profiles.get(dir)!);
    if (dir === null || !reopened) return;
    this.profiles.set(dir, reopened.state);
    this.createView(dir, reopened.tab);
    this.refreshVisibility();
    this.onChange();
  }

  selectTab(id: number): void {
    const dir = this.dirOf(id);
    if (dir === null) return;
    this.profiles.set(dir, activateTab(this.profiles.get(dir)!, id));
    this.refreshVisibility();
    this.onChange();
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
      if (this.dirOf(id) === dir) view.webContents.setAudioMuted(muted);
    }
  }

  /** Reloads the profile's tabs that have loaded (lazy ones load fresh when first shown anyway). */
  reloadProfile(dir: string): void {
    for (const [id, view] of this.views) {
      if (this.dirOf(id) === dir) view.webContents.reload();
    }
  }

  activeWebContents(): WebContents | null {
    const id = this.activeTab()?.id;
    return id === undefined ? null : this.views.get(id)?.webContents ?? null;
  }

  snapshot(): { dir: string; tabs: UiTab[]; activeTabId: number | null; url: string; canGoBack: boolean; canGoForward: boolean } {
    const tabs = this.activeDir === null ? emptyTabs() : this.profiles.get(this.activeDir)!;
    const history = this.activeWebContents()?.navigationHistory;
    return {
      dir: this.activeDir ?? '',
      tabs: tabs.tabs.map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: this.live.get(t.id)?.favicon ?? null,
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

  /** Every view gets the same rect so a hidden tab is already sized when shown. */
  layout(rect: Rect): void {
    this.bounds = rect;
    for (const view of this.views.values()) view.setBounds(rect);
  }

  private activeTab(): TabRecord | undefined {
    const tabs = this.activeDir === null ? undefined : this.profiles.get(this.activeDir);
    return tabs?.tabs.find((t) => t.id === tabs.activeId);
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
    this.wire(view, tab.id);
    load(view.webContents, tab.url);
    return view;
  }

  private destroyView(id: number): void {
    const view = this.views.get(id);
    this.views.delete(id);
    this.live.delete(id);
    if (this.shownId === id) this.shownId = null;
    if (!view) return;
    this.win.contentView.removeChildView(view);
    view.webContents.close();
  }

  private wire(view: WebContentsView, id: number): void {
    const wc = view.webContents;
    // A closed tab's id can come back (reopen) with a new view; ignore events from the old one.
    const current = () => this.views.get(id) === view;
    const patch = (p: Partial<Pick<TabRecord, 'url' | 'title'>>) => {
      const dir = this.dirOf(id);
      if (dir === null) return;
      this.profiles.set(dir, updateTab(this.profiles.get(dir)!, id, p));
      this.onChange();
    };
    const setLive = (p: Partial<{ favicon: string | null; loading: boolean }>) => {
      const entry = this.live.get(id);
      if (!entry) return;
      Object.assign(entry, p);
      this.onChange();
    };
    wc.on('page-title-updated', (_e, title) => { if (current()) patch({ title }); });
    wc.on('did-navigate', (_e, url) => {
      if (!current()) return;
      const entry = this.live.get(id);
      if (entry) entry.favicon = null;
      patch({ url });
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (current() && isMainFrame) patch({ url }); });
    wc.on('page-favicon-updated', (_e, favicons) => { if (current()) setLive({ favicon: favicons[0] ?? null }); });
    wc.on('did-start-loading', () => { if (current()) setLive({ loading: true }); });
    wc.on('did-stop-loading', () => { if (current()) setLive({ loading: false }); });
    // No in-page error UI yet (Electron has no Chrome net-error page; the tab stays blank): at least leave a trace.
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED) this.log(`tab ${id} failed to load ${url}: ${description} (${code})`);
    });
  }
}

/** ERR_ABORTED: a redirect or a newer navigation superseded this one — not a failure. */
const ERR_ABORTED = -3;

/** Failures are logged by the tab's `did-fail-load` listener (which also sees link clicks), so the rejection is only noise. */
function load(wc: WebContents, url: string): void {
  wc.loadURL(url).catch(() => {});
}
