import {
  clipboard, dialog, Menu, type BaseWindow, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents,
} from 'electron';
import { toNavigableUrl } from '../core/address.ts';
import { contextMenuSpec, type MenuItemSpec } from '../core/contextMenu.ts';
import { isOpenableLink, popupTitle, popupWindowOptions, windowOpenTarget } from '../core/tabs.ts';

/** What a page (a tab's or a popup's) needs from the app. */
export type PageHost = {
  log: (msg: string) => void;
  /** Shown in popup titles. */
  profileName(dir: string): string;
  /** Opens `url` as a tab of profile `dir`, right after tab `afterId` while that tab is open (else at the end). */
  openTab(dir: string, url: string, opts: { afterId: number | null; activate: boolean }): void;
};

/** ERR_ABORTED: a redirect or a newer navigation superseded this one — not a failure. */
export const ERR_ABORTED = -3;

/** Every open popup window (pages' small windows), so menu shortcuts can act on a focused one. */
const popups = new WeakSet<BaseWindow>();

export function isPopupWindow(win: BaseWindow): boolean {
  return popups.has(win);
}

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
  wc.on('did-create-window', (popup, details) => wirePopup(popup, details.url, dir, tabId, host));
  wc.on('context-menu', (_e, params) => {
    const template = contextMenuSpec(params).map((item) => menuItem(item, wc, params, dir, tabId, host));
    const window = menuWindow();
    Menu.buildFromTemplate(template).popup(window ? { window } : {});
  });
  // A beforeunload handler objected to closing the tab or popup, a navigation or a reload: ask, as Chrome does.
  // Without this Electron cancels silently. Synchronous: the answer must be known before the handler returns.
  wc.on('will-prevent-unload', (e) => {
    const window = menuWindow();
    const options = {
      type: 'question' as const,
      message: 'Leave site?',
      detail: 'Changes you made may not be saved.',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
    };
    const choice = window && !window.isDestroyed() ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options);
    if (choice === 0) e.preventDefault();
  });
}

/**
 * A popup window (no sidebar): same new-window rules and menu as its opener; closes itself on `window.close()`.
 * Its title always starts with the host it shows and ends with the profile, whatever the page calls itself.
 */
function wirePopup(popup: BrowserWindow, url: string, dir: string, tabId: number | null, host: PageHost): void {
  popups.add(popup);
  const wc = popup.webContents;
  wirePage(wc, dir, tabId, () => (popup.isDestroyed() ? null : popup), host);
  let pageTitle = '';
  const retitle = () => {
    if (!popup.isDestroyed()) popup.setTitle(popupTitle(wc.getURL() || url, pageTitle, host.profileName(dir)));
  };
  retitle();
  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    pageTitle = title;
    retitle();
  });
  wc.on('did-navigate', () => {
    pageTitle = ''; // a new document: its title follows in page-title-updated
    retitle();
  });
  wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => { if (isMainFrame) retitle(); });
  wc.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== ERR_ABORTED) host.log(`popup (profile ${dir}) failed to load ${failedUrl}: ${description} (${code})`);
  });
}

function menuItem(item: MenuItemSpec, wc: WebContents, p: ContextMenuParams, dir: string, tabId: number | null, host: PageHost): MenuItemConstructorOptions {
  if (item.id === 'separator') return { type: 'separator' };
  const click = (): void => {
    switch (item.id) {
      case 'openLinkInNewTab':
        // A blob: link loads in the new tab from this profile's session (the page must not have revoked it).
        if (isOpenableLink(p.linkURL)) host.openTab(dir, p.linkURL, { afterId: tabId, activate: false });
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
