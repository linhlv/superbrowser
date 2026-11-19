import { Menu, type MenuItemConstructorOptions } from 'electron';
import type { Profile } from '../shared/types.ts';

/** What the application menu shows and does. Rebuild the menu when a shown field changes. */
export type MenuContext = {
  profiles: Profile[]; // visible, in bar order (⌃1…⌃9 follow it)
  hiddenProfiles: Profile[];
  showNames: boolean;
  newTab(): void;
  reopenClosedTab(): void;
  closeTab(): void;
  openLocation(): void;
  print(): void;
  find(): void;
  findAgain(forward: boolean): void;
  toggleSidebar(): void;
  setShowNames(on: boolean): void;
  reload(): void;
  /** -1 out, +1 in, 0 back to actual size. */
  zoom(step: -1 | 0 | 1): void;
  toggleDevTools(): void;
  back(): void;
  forward(): void;
  showProfile(dir: string): void;
  openActiveProfileInChrome(): void;
  unhideProfile(dir: string): void;
  /** 1–8 select by position, 9 the last tab. */
  selectTab(n: number): void;
};

export function buildMenu(ctx: MenuContext): Menu {
  const sep: MenuItemConstructorOptions = { type: 'separator' };

  const profileItems: MenuItemConstructorOptions[] = ctx.profiles.map((p, i) => ({
    label: p.name,
    ...(i < 9 ? { accelerator: `Ctrl+${i + 1}` } : {}),
    click: () => ctx.showProfile(p.dir),
  }));
  const hiddenItems: MenuItemConstructorOptions[] = ctx.hiddenProfiles.length > 0
    ? ctx.hiddenProfiles.map((p) => ({ label: p.name, click: () => ctx.unhideProfile(p.dir) }))
    : [{ label: 'No Hidden Profiles', enabled: false }];

  const tabItems: MenuItemConstructorOptions[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    label: `Select Tab ${n}`,
    accelerator: `CmdOrCtrl+${n}`,
    click: () => ctx.selectTab(n),
  }));

  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => ctx.newTab() },
        { label: 'Reopen Closed Tab', accelerator: 'Shift+CmdOrCtrl+T', click: () => ctx.reopenClosedTab() },
        { label: 'Open Location…', accelerator: 'CmdOrCtrl+L', click: () => ctx.openLocation() },
        sep,
        // Closes the tab only, never the window (that's the red button or ⌘Q).
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => ctx.closeTab() },
        sep,
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => ctx.print() },
      ],
    },
    {
      // The standard Edit menu (role 'editMenu' can't be extended) plus find.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        sep,
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => ctx.find() },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: () => ctx.findAgain(true) },
        { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: () => ctx.findAgain(false) },
        sep,
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: () => ctx.toggleSidebar() },
        { label: 'Show Profile Names', type: 'checkbox', checked: ctx.showNames, click: (item) => ctx.setShowNames(item.checked) },
        sep,
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => ctx.reload() },
        sep,
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => ctx.zoom(0) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => ctx.zoom(1) },
        // ⌘= is the unshifted ⌘+ key: same action, not listed.
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: () => ctx.zoom(1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => ctx.zoom(-1) },
        sep,
        { role: 'togglefullscreen' },
        sep,
        { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => ctx.toggleDevTools() },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => ctx.back() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => ctx.forward() },
      ],
    },
    {
      label: 'Profiles',
      submenu: [
        ...profileItems,
        sep,
        { label: 'Open This Profile in Chrome', click: () => ctx.openActiveProfileInChrome() },
        { label: 'Show Hidden Profiles', enabled: ctx.hiddenProfiles.length > 0, submenu: hiddenItems },
      ],
    },
    {
      label: 'Tab',
      submenu: [...tabItems, { label: 'Select Last Tab', accelerator: 'CmdOrCtrl+9', click: () => ctx.selectTab(9) }],
    },
    { role: 'windowMenu' },
  ]);
}

/** The right-click menu of a profile dot in the bottom bar. */
export type ProfileMenuContext = {
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canHide: boolean; // false for the last visible profile
  move(step: -1 | 1): void;
  hide(): void;
  openInChrome(): void;
};

export function buildProfileMenu(ctx: ProfileMenuContext): Menu {
  return Menu.buildFromTemplate([
    { label: 'Move Left', enabled: ctx.canMoveLeft, click: () => ctx.move(-1) },
    { label: 'Move Right', enabled: ctx.canMoveRight, click: () => ctx.move(1) },
    { type: 'separator' },
    { label: 'Hide Profile', enabled: ctx.canHide, click: () => ctx.hide() },
    { type: 'separator' },
    { label: 'Open in Chrome', click: () => ctx.openInChrome() },
  ]);
}
