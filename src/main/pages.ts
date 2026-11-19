import { clipboard, Menu, type BaseWindow, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { toNavigableUrl } from '../core/address.ts';
import { contextMenuSpec, type MenuItemSpec } from '../core/contextMenu.ts';
import { popupWindowOptions, windowOpenTarget } from '../core/tabs.ts';

/** What a page (a tab's or a popup's) needs from the app. */
export type PageHost = {
  log: (msg: string) => void;
  /** Opens `url` as a tab of profile `dir`, right after tab `afterId` while that tab is open (else at the end). */
  openTab(dir: string, url: string, opts: { afterId: number | null; activate: boolean }): void;
};

/** ERR_ABORTED: a redirect or a newer navigation superseded this one — not a failure. */
export const ERR_ABORTED = -3;

/**
 * Where a profile page's new windows and right-clicks go. Everything it opens stays in profile `dir`:
 * links become tabs after `tabId` (the page's tab, or for a popup the tab that opened it), popups are
 * windows in the same partition and are wired the same way.
 */
export function wirePage(wc: WebContents, dir: string, tabId: number | null, menuWindow: () => BaseWindow | null, host: PageHost): void {
  wc.setWindowOpenHandler((details) => {
    const target = windowOpenTarget(details);
    if (target.kind === 'popup') return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(dir) };
    if (target.kind === 'tab') host.openTab(dir, details.url, { afterId: tabId, activate: target.activate });
    else host.log(`blocked a page from opening ${details.url.slice(0, 200)}`);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (popup) => wirePopup(popup, dir, tabId, host));
  wc.on('context-menu', (_e, params) => {
    const template = contextMenuSpec(params).map((item) => menuItem(item, wc, params, dir, tabId, host));
    const window = menuWindow();
    Menu.buildFromTemplate(template).popup(window ? { window } : {});
  });
}

/** A popup window (no sidebar): same new-window rules and menu as its opener; closes itself on `window.close()`. */
function wirePopup(popup: BrowserWindow, dir: string, tabId: number | null, host: PageHost): void {
  const wc = popup.webContents;
  wirePage(wc, dir, tabId, () => (popup.isDestroyed() ? null : popup), host);
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== ERR_ABORTED) host.log(`popup (profile ${dir}) failed to load ${url}: ${description} (${code})`);
  });
}

function menuItem(item: MenuItemSpec, wc: WebContents, p: ContextMenuParams, dir: string, tabId: number | null, host: PageHost): MenuItemConstructorOptions {
  if (item.id === 'separator') return { type: 'separator' };
  const click = (): void => {
    switch (item.id) {
      case 'openLinkInNewTab':
        if (/^https?:\/\//i.test(p.linkURL)) host.openTab(dir, p.linkURL, { afterId: tabId, activate: false });
        break;
      case 'copyLink': clipboard.writeText(p.linkURL); break;
      case 'copyImage': wc.copyImageAt(p.x, p.y); break;
      case 'saveImage': wc.downloadURL(p.srcURL); break;
      case 'cut': wc.cut(); break;
      case 'copy': wc.copy(); break;
      case 'paste': wc.paste(); break;
      case 'selectAll': wc.selectAll(); break;
      case 'searchSelection': {
        const url = toNavigableUrl(p.selectionText);
        if (url) host.openTab(dir, url, { afterId: tabId, activate: true });
        break;
      }
      case 'inspect':
        // Tab views can't dock DevTools; detached, as View ▸ Developer Tools does.
        if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
        wc.inspectElement(p.x, p.y);
        break;
    }
  };
  return { label: item.label, click };
}
