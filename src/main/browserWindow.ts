import path from 'node:path';
import { app, BrowserWindow, screen, WebContentsView } from 'electron';
import type { AppState } from '../core/appState.ts';
import { restoreBounds, tabBounds } from '../core/layout.ts';
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

/**
 * The sidebar + bottom bar page, filling the whole window. Must be added before any tab view:
 * child views stack in insertion order, so the tabs then sit on top of it.
 */
export function createUiView(win: BrowserWindow, log: (msg: string) => void): WebContentsView {
  const dist = path.join(app.getAppPath(), 'dist');
  const view = new WebContentsView({
    webPreferences: { preload: path.join(dist, 'preload', 'ui.cjs'), contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor('#00000000'); // the window's dark background shows until the page paints
  win.contentView.addChildView(view);
  const wc = view.webContents;
  // It only ever shows our page: a dropped file or link must not navigate it away.
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'warning' || level === 'error') log(`ui ${level}: ${message} (${path.basename(sourceId)}:${lineNumber})`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => log(`ui preload ${preloadPath} failed: ${error.message}`));
  wc.on('render-process-gone', (_e, details) => log(`ui renderer gone: ${details.reason}`));
  wc.loadFile(path.join(dist, 'ui', 'index.html')).catch((e: unknown) => log(`ui failed to load: ${String(e)}`));
  return view;
}

export function layoutWindow(win: BrowserWindow, ui: WebContentsView, tabs: TabManager, sidebarVisible: boolean): void {
  const [width = 0, height = 0] = win.getContentSize();
  ui.setBounds({ x: 0, y: 0, width, height });
  tabs.layout(tabBounds({ width, height }, sidebarVisible));
}
