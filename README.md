# Superbrowser

A macOS browser that shows every Chrome profile in one ordinary window. It has an Arc-style sidebar with the tabs of the current profile and a slim profile bar at the bottom: click a profile's dot or press ⌃1…⌃9 to switch. Each profile has its own isolated storage, so every profile stays signed in to its own accounts at the same time. Profile names, colours and order come from Chrome, and logins can be imported from Chrome so you don't sign in again. Superbrowser is built on Electron (Chromium) and presents itself to sites as Google Chrome.

Requires macOS on Apple Silicon, Google Chrome (for profiles and login import), Node 22 and the Command Line Tools (no Xcode).

## Install

```
scripts/build-app.sh --install
```

This runs the tests, builds `build/Superbrowser-darwin-arm64/Superbrowser.app` (ad-hoc signed), quits a running Superbrowser and replaces `~/Applications/Superbrowser.app`. Without `--install` it only builds. Run it again to update, for example after bumping Electron (`npm install electron@latest`). The browser's user agent follows Electron's Chromium version automatically.

Superbrowser keeps its data in `~/Library/Application Support/Superbrowser`:

- `state.json` holds tabs, window position, profile order, hidden profiles and saved site permissions.
- `Partitions/` holds each profile's cookies and storage.

`npm start` (development) uses the same folder.

## First run

1. Superbrowser offers to **import logins from Chrome** for all profiles. Click **Import All**, then **Import** on the short explanation sheet.
2. macOS asks for the "Chrome Safe Storage" Keychain item. Click **Always Allow**. Superbrowser only reads it.
3. A summary lists what was imported per profile. Your Google accounts are now signed in, in the right profile each.

You can repeat the import any time from the **Profiles** menu:

- **Import Logins from Chrome**: the shown profile only.
- **Import Logins for All Profiles**.
- **Replace Logins from Chrome…**: overwrites the shown profile's logins with Chrome's current ones, after a confirmation.

A normal import only adds logins Superbrowser doesn't have yet. It never signs you out. Superbrowser never writes to Chrome's files or its Keychain item.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌃1 … ⌃9 | Show the Nth profile in the bottom bar |
| ⌘1 … ⌘8, ⌘9 | Select the Nth tab, or the last tab |
| ⌘T | New tab (focuses the address field) |
| ⇧⌘T | Reopen the last closed tab |
| ⌘L | Focus the address field |
| ⌘W | Close the tab (never the window) |
| ⌘S | Hide or show the sidebar |
| ⌘R | Reload |
| ⌘[ / ⌘] | Back / Forward |
| ⌘F, ⌘G, ⇧⌘G | Find in page, next, previous (Esc closes) |
| ⌘+ (or ⌘=), ⌘−, ⌘0 | Zoom in, out, actual size |
| ⌃⌘F | Full screen |
| ⌘P | Print |
| ⌥⌘I | Developer Tools for the page |
| ⌘Q, red button | Quit (tabs come back on the next launch) |

The address field takes a URL or a Google search: `example.com`, `localhost:3000` and `192.168.1.10/admin` open as addresses.

macOS uses ⌃1…⌃9 for "Switch to Desktop N" if that is turned on. If it is, turn those shortcuts off in System Settings → Keyboard → Keyboard Shortcuts → Mission Control.

## Profiles

- Profiles, names and colours come from Chrome's profile list. A profile deleted in Chrome keeps its Superbrowser data and stays in the bar until you hide it.
- Right-click a profile's dot for **Move Left**, **Move Right**, **Hide Profile** and **Open in Chrome**. ⌃N follows the bar order.
- **Profiles ▸ Show Hidden Profiles** brings a hidden profile back.
- **View ▸ Show Profile Names** shows names next to the dots all the time. Otherwise a name and its ⌃N slide out when you hover a dot.
- **Profiles ▸ Open This Profile in Chrome** opens the shown profile in real Chrome. Use it for anything Superbrowser can't do (see below).

Switching profile or tab never reloads a page. After a relaunch, each profile's active tab loads first. Other tabs load when you first show them.

Sites ask before using the camera, microphone, screen sharing, notifications, location or the clipboard. The answer is per profile and per site. Allow with "Remember for this site" is saved. Block lasts until you quit.

## Known limits

- **No passkeys.** A passkey request fails at once, so sites offer another way. Use password + 2-step code, or import logins from Chrome.
- **No password autofill.** Copy passwords from the macOS Passwords app.
- **No Chrome extensions.** Use **Open This Profile in Chrome** for anything that needs one.
- **claude.ai needs a fresh login.** Its login is tied to the device and doesn't import.
- **Google may occasionally sign one browser out.** Chrome and Superbrowser share the same Google sessions. If Superbrowser gets signed out, use **Profiles ▸ Replace Logins from Chrome…**.
- **Links to other apps don't open.** `mailto:`, `zoommtg:` and similar links do nothing. Copy the link, or use Chrome.
- **blob: documents open in a small popup window,** not a tab. An example is a PDF a web app generates.
- **No popup blocker.** A page can open windows without a click.
- **A hidden profile's open tabs keep running.** They are muted while the profile is hidden.
- Saved site permissions can't be revoked from the app yet. Remove them from `permissions` in `state.json` while Superbrowser is not running.
- In development (`npm start`) the menu bar says "Electron". The built app says "Superbrowser".

## Verify it works

Walk this list on the installed app after a change that affects it.

**Window and profiles**

1. The window opens on the first visible profile. The page has rounded corners inset 8 px from the window edge, and the sidebar is on the left. There is no white flash at startup.
2. ⌃2 shows another profile. ⌃1 returns to the first page without a reload, and the scroll position is kept. The window tint changes to the profile's colour.
3. Sign in to a site in one profile. Another profile is still signed out there.
4. Hovering a dot slides out the profile's name and ⌃N. Clicking a dot switches profile.
5. Move and resize the window, quit, and relaunch. The same profile, tabs and window position come back.
6. The menu bar and the Dock say "Superbrowser" and show its icon.

**Sidebar and tabs**

7. Clicking a tab, **+ New Tab**, ×, Back, Forward and Reload all work. Typing `example.com` + Enter in the address field opens it.
8. ◧ or ⌘S hides the sidebar. The page fills the width, the window buttons disappear, and the bottom bar still switches profiles. Showing the sidebar brings the buttons back at the same place.
9. The window can be dragged by the bottom bar, the top 40 px of the sidebar and the 8 px gap above the page. Clicking near the top of a page (for example Google's account avatar) clicks the page and doesn't drag the window. Favicons appear for loaded tabs.

**Shortcuts and find**

10. Every shortcut in the table works:
    - with the sidebar shown and with it hidden;
    - with focus in the page, in the address field and in the find bar.
11. ⌘W never closes the window, even on the last tab.
12. ⌘F shows a white rounded bar at the top right of the page, with its field focused. Typing highlights matches and shows a "2/7"-style count, which is red at 0/0. Enter and ⇧Enter step through matches. Esc closes the bar, clears the highlights and lets you type into the page. Switching tab or profile closes the bar.
13. ⌘P shows the print dialog. ⌥⌘I opens detached DevTools for the page, and pressing it again closes them.

**Profile management**

14. **Move Right** on a dot changes the bar order and the ⌃N mapping.
15. **Hide Profile** removes the profile from the bar, and **Show Hidden Profiles** brings it back. Hiding the active profile switches to the first visible one. Hide is disabled when only one profile is visible.
16. Play audio in a profile and hide it: the audio goes silent. Unhide it: the sound returns.
17. **Open This Profile in Chrome** and the dot's **Open in Chrome** open Chrome on the right profile.
18. Quit and relaunch. The order, hidden profiles and Show Profile Names survive.

**Login import** (to test the first run: quit, then remove `state.json` and `Partitions/` from the data folder)

19. The first-run sheet appears over the window. Choose **Import All**. The explanation sheet appears, then the macOS Keychain prompt for "Chrome Safe Storage" (Always Allow), then one summary listing every visible profile.
20. Gmail opens signed in on each imported profile without logging in. Chrome is still signed in.
21. **Import Logins from Chrome** again reports 0 new logins, with the rest skipped.
22. Clicking Deny at the Keychain prompt shows an error sheet, and nothing changes.
23. **Replace Logins from Chrome…** asks for confirmation, re-imports, and reloads that profile's loaded tabs.

**Site permissions**

24. Google Meet → "Check your audio and video": one sheet asks for the camera and microphone. After Allow, macOS asks once for camera and microphone access for Superbrowser. Video and sound work, and after a relaunch Meet doesn't ask again.
25. Meet → Present now: the macOS screen picker appears.
26. Gmail's desktop notifications prompt appears as a sheet. After Allow, a notification appears.
27. Google sign-in on an account with a passkey: the passkey step offers other options at once instead of hanging.
28. A request from a profile that isn't shown names that profile in the sheet ("Profile: …").

**Pages, popups and downloads**

29. ⌘-click a link: a background tab opens right after the current one. ⇧-click: a foreground tab.
30. "Sign in with Google" on a third-party site opens a small window that is already signed in to the same profile's Google account. It completes the sign-in and closes itself.
31. Right-click menus:
    - A link: Open Link in New Tab, Copy Link Address.
    - An image: Copy Image, and Save Image As…, which saves to Downloads.
    - Selected text: Copy, Search Google for "…".
    - A text field: Cut, Copy, Paste, Select All.
    - Inspect opens DevTools at the element.
32. Download a PDF twice. Both appear in the sidebar's Downloads list, and `~/Downloads` has `x.pdf` and `x (1).pdf`. A "Downloaded x.pdf" notification appears. Clicking a row shows the file in Finder.
33. YouTube full screen: the video fills the window and the window goes full screen. Esc restores the sidebar and bar. If the window was already full screen before, it stays full screen. ⌃2 during a full-screen video ends it.

## Privacy

Superbrowser talks only to the sites you open. It reads Chrome's profile list and, when you import, a copy of a profile's cookie database and the "Chrome Safe Storage" Keychain item. It never writes to Chrome's data.
