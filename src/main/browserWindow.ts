import { BrowserWindow, screen } from 'electron';
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

export function layoutWindow(win: BrowserWindow, tabs: TabManager, sidebarVisible: boolean): void {
  const [width = 0, height = 0] = win.getContentSize();
  tabs.layout(tabBounds({ width, height }, sidebarVisible));
}
