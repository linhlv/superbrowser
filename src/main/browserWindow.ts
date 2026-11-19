import path from 'node:path';
import { app, BrowserWindow, screen, WebContentsView, type WebContents } from 'electron';
import type { AppState, Rect } from '../core/appState.ts';
import { findBarBounds, restoreBounds, tabBounds } from '../core/layout.ts';
import { IPC, type FindResult } from '../shared/types.ts';
import type { TabManager } from './tabManager.ts';

const DEFAULT_SIZE = { width: 1400, height: 900 };

export function createBrowserWindow(state: AppState): BrowserWindow {
  const bounds = restoreBounds(state.windowBounds, screen.getAllDisplays().map((d) => d.workArea), DEFAULT_SIZE);
  return new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    title: 'Superbrowser',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: '#1e1e22',
  });
}

/** A view showing one of our own pages (`dist/ui/<file>`) with the UI preload. */
function createPageView(win: BrowserWindow, file: string, log: (msg: string) => void): WebContentsView {
  const dist = path.join(app.getAppPath(), 'dist');
  const view = new WebContentsView({
    webPreferences: { preload: path.join(dist, 'preload', 'ui.cjs'), contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor('#00000000'); // whatever is below shows until the page paints
  win.contentView.addChildView(view);
  const wc = view.webContents;
  // It only ever shows our page: a dropped file or link must not navigate it away.
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'warning' || level === 'error') log(`${file} ${level}: ${message} (${path.basename(sourceId)}:${lineNumber})`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => log(`${file} preload ${preloadPath} failed: ${error.message}`));
  wc.on('render-process-gone', (_e, details) => log(`${file} renderer gone: ${details.reason}`));
  wc.loadFile(path.join(dist, 'ui', file)).catch((e: unknown) => log(`${file} failed to load: ${String(e)}`));
  return view;
}

/**
 * The sidebar + bottom bar page, filling the whole window. Must be added before any tab view:
 * child views stack in insertion order, so the tabs then sit on top of it.
 */
export function createUiView(win: BrowserWindow, log: (msg: string) => void): WebContentsView {
  return createPageView(win, 'index.html', log);
}

/**
 * Find in page: a small view over the top-right corner of the tab it searches, hidden until opened.
 * Tab views are added on top of earlier views, so it is raised whenever it is shown.
 */
export class FindBar {
  readonly view: WebContentsView;
  private readonly win: BrowserWindow;
  /** The page being searched while the bar is open, else null. */
  private target: WebContents | null = null;
  /** What the bar's field holds: searched again when the bar reopens, as in Chrome. */
  private text = '';
  /** The page and text of the current find session; a different one starts a new session. */
  private session: { page: WebContents; text: string } | null = null;
  private readonly wired = new WeakSet<WebContents>();

  constructor(win: BrowserWindow, log: (msg: string) => void) {
    this.win = win;
    this.view = createPageView(win, 'find.html', log);
    this.view.setVisible(false);
    this.view.setBorderRadius(10);
  }

  /** Shows the bar over `page`, focuses its field and repeats the last search there. */
  open(page: WebContents): void {
    if (this.target !== page) this.close(false);
    this.target = page;
    if (!this.wired.has(page)) {
      this.wired.add(page);
      page.on('found-in-page', (_e, r) => {
        if (page === this.target) this.sendResult({ active: r.activeMatchOrdinal, matches: r.matches });
      });
    }
    this.win.contentView.addChildView(this.view); // re-adding moves it to the top
    this.view.setVisible(true);
    this.view.webContents.focus();
    this.view.webContents.send(IPC.findFocus);
    if (this.text && this.session === null) this.find(this.text, true);
  }

  /** Hides the bar and clears the highlights; with `focusPage`, the searched page gets the keyboard back. */
  close(focusPage: boolean): void {
    const page = this.target;
    this.target = null;
    this.session = null;
    this.view.setVisible(false);
    if (!page || page.isDestroyed()) return;
    page.stopFindInPage('clearSelection');
    if (focusPage) page.focus();
  }

  /** Typing in the bar (new text: new session) or stepping with Enter / ⇧Enter (same text). */
  find(text: string, forward: boolean): void {
    const page = this.target;
    this.text = text;
    if (!page || page.isDestroyed()) return;
    if (text === '') {
      this.session = null;
      page.stopFindInPage('clearSelection');
      this.sendResult({ active: 0, matches: 0 });
      return;
    }
    const newSession = this.session?.page !== page || this.session.text !== text;
    this.session = { page, text };
    page.findInPage(text, { forward, findNext: newSession });
  }

  /** ⌘G / ⇧⌘G: the next or previous match of the last search, opening the bar if needed. */
  findAgain(page: WebContents, forward: boolean): void {
    if (this.target !== page) this.open(page);
    else if (this.text) this.find(this.text, forward);
  }

  /** Call after the tabs changed: closes the bar if its page is no longer the active one, else keeps it on top. */
  follow(active: WebContents | null): void {
    if (this.target === null) return;
    if (this.target !== active) this.close(false);
    else if (this.win.contentView.children.at(-1) !== this.view) this.win.contentView.addChildView(this.view);
  }

  layout(tab: Rect): void {
    this.view.setBounds(findBarBounds(tab));
  }

  private sendResult(result: FindResult): void {
    if (!this.view.webContents.isDestroyed()) this.view.webContents.send(IPC.findResult, result);
  }
}

export function layoutWindow(win: BrowserWindow, ui: WebContentsView, findBar: FindBar, tabs: TabManager, sidebarVisible: boolean): void {
  const [width = 0, height = 0] = win.getContentSize();
  ui.setBounds({ x: 0, y: 0, width, height });
  const rect = tabBounds({ width, height }, sidebarVisible);
  tabs.layout(rect);
  findBar.layout(rect);
}
