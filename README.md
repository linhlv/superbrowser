# Superbrowser

A macOS menu-bar app that makes every Chrome profile's windows behave like one window. Managed Chrome windows are stacked in a single frame on one desktop, with a Superbrowser tab bar (one tab per profile, in Chrome's profile colors) and Ctrl+1…9 shortcuts to switch. A small helper extension, loaded unpacked in each profile, tells Superbrowser which window belongs to which profile.

Requires macOS 14+ and Google Chrome.

## Build and install

```
scripts/build-app.sh            # builds build/Superbrowser.app (ad-hoc signed)
scripts/build-app.sh --install  # also copies it to ~/Applications/Superbrowser.app
swift test                      # run the unit tests
```

## Setup

1. Load the helper extension in **each** Chrome profile: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `Extension/` folder.
2. Open Superbrowser (menu-bar icon). The first-run checklist walks through:
   - Grant **Accessibility** permission.
   - **Link profiles**: menu → **Link Profiles…** (also in the checklist) so each profile's extension is matched to its tab. Superbrowser opens a short-lived local page (`http://127.0.0.1:47321/claim?nonce=…`) in each unlinked profile; the helper extension trades that one-time code with Superbrowser for the profile's identity and closes the tab. A code works once and expires after 5 minutes (an expired page says so; use **Link Profiles…** again). A profile stays linked once its extension has reported, across restarts.
   - Assign Chrome to one desktop: right-click Chrome in the Dock → Options → Assign To → This Desktop.
   - Quit and reopen Chrome so its windows gather on that desktop.
   - Choose the bar position (left, right, top, bottom).
3. Reopen the checklist any time from the menu: **Setup Checklist…**

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌃1 … ⌃9 | Switch to the Nth visible profile tab |

The modifier is selectable under **Shortcut Keys**: ⌃, ⌃⌥ or ⌃⌘. macOS "Switch to Desktop N" shortcuts use ⌃1…⌃9 by default; if they clash, the menu shows a warning. Pick another modifier or turn those macOS shortcuts off in System Settings → Keyboard → Keyboard Shortcuts → Mission Control.

## How switching works

Click a tab or press its shortcut. If you are on another desktop, macOS swipes to the browser desktop. The profile's window comes to the front inside the frame. If the profile has several windows, repeated presses cycle through them while Chrome is the active app (the tab shows ×2, etc.); from another app, the shortcut brings back the profile's most recently used window. If it has none, a new window opens.

Dragging or resizing any managed window moves and resizes the whole frame: the other windows and the bar follow. Maximizing or zooming a window, or dragging it against a screen edge, keeps the bar on screen: the frame is fitted into the screen and the window is placed next to the bar. A window restored from the Dock or from full screen returns into the frame.

Without Accessibility permission, tabs and shortcuts open the Setup Checklist instead of switching.

Menu items: **Bar Position**, **Profiles** (show/hide, reorder, fallback), **Shortcut Keys**, **Launch at Login** (installed app only).

## Known limits

- Chrome full-screen is not supported.
- Popups, DevTools, installed web apps (PWAs), picture-in-picture and minimized windows are left alone (a minimized window rejoins the frame when restored).
- A window already minimized when Superbrowser starts is not adopted until it is restored.
- Chrome windows on another desktop when Superbrowser starts are picked up when you visit that desktop.
- A profile that can't run the helper extension (e.g. blocked by policy) can be marked **use fallback** under Profiles. Only one such profile is supported. Its windows can't be identified directly, so it adopts only a window that opens within 10 s after you open or switch to that profile through Superbrowser (its tab or shortcut), and only while every other visible profile is linked. DevTools windows are never adopted. Fallback-profile windows already open when Superbrowser starts are left alone; open one from its tab instead.
- The app is ad-hoc signed, so Accessibility must be re-granted after each rebuild:
  `tccutil reset Accessibility dev.superbrowser.app`, then grant again.

## Verify it works

1. First launch shows the checklist; complete all five rows; every profile shows linked (except a fallback profile).
2. Chrome windows of all profiles stack in one frame on the browser desktop; the bar shows one tab per profile in Chrome's profile colors.
3. Click each tab: that profile's window comes to the front, nothing appears to move; the active tab is highlighted.
4. From another desktop press ⌃3: macOS swipes to the browser desktop with profile 3 in front.
5. Profile with no window: click its tab and a new window opens inside the frame.
6. Profile with two windows: pressing its shortcut twice cycles them; the tab shows ×2.
7. Drag any Chrome window in the frame: all windows and the bar follow; zoom a window (green button with ⌥): the bar stays on screen; restart Superbrowser and the frame is restored.
8. Switch bar position through all four sides via the menu: layout is correct each time.
9. Sign in to a Google service via a popup and use the password manager: the popup is not pulled into the frame; both work normally.
10. Minimize a window: it stays minimized; clicking its tab restores it in the frame (also after the frame was moved meanwhile).
11. Quit Chrome: tabs dim; reopen it and the windows are re-adopted.
12. Hide a profile: its tab disappears, its windows are left alone, and shortcuts renumber.

## Privacy

The extension sends only window ids, bounds and state to `127.0.0.1:47321`. Nothing leaves your Mac, and Superbrowser never writes Chrome's data.
