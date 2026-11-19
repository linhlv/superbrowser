# Superbrowser

A macOS browser that shows every Chrome profile in one ordinary window. It has an Arc-style sidebar with the tabs of the current profile and a slim profile bar at the bottom: click a profile's dot or press ⌃1…⌃9 to switch. Each profile has its own isolated storage, so every profile stays signed in to its own accounts at the same time. Profile names, colours and order come from Chrome, and logins, bookmarks and history can be imported from Chrome so you don't start over. Superbrowser is built on Electron (Chromium) and presents itself to sites as Google Chrome.

Requires macOS on Apple Silicon, Google Chrome (for profiles and login import), Node 22 and the Command Line Tools (no Xcode).

## Install

```
scripts/build-app.sh --install
```

This runs the tests, builds `build/Superbrowser-darwin-arm64/Superbrowser.app` (ad-hoc signed), quits a running Superbrowser and replaces `~/Applications/Superbrowser.app`. Without `--install` it only builds. Run it again to update, for example after bumping Electron (`npm install electron@latest`). The browser's user agent follows Electron's Chromium version automatically.

Each build has a new ad-hoc signature, so macOS forgets Superbrowser's camera, microphone and screen recording permissions after every rebuild or reinstall, and asks again the next time a site uses them.

Superbrowser keeps its data in `~/Library/Application Support/Superbrowser`:

- `state.json` holds tabs, window position, profile order, hidden profiles and saved site permissions.
- `Partitions/` holds each profile's cookies and storage.
- `Profiles/<profile>/` holds that profile's `history.db` and `bookmarks.json`.

`npm start` (development) uses the same folder.

## First run

1. Superbrowser offers to **import your logins, bookmarks and history from Chrome** for all profiles. Click **Import All**, then **Import** on the short explanation sheet.
2. macOS asks for the "Chrome Safe Storage" Keychain item. Click **Allow**, not **Always Allow**. The prompt comes from the system's `security` tool, so Always Allow would let any program on your Mac read Chrome's cookie key through that tool without asking. With Allow, macOS asks once each time Superbrowser imports after a launch. Superbrowser keeps the key in memory for that run and never changes the Keychain item.
3. A summary lists what was imported per profile. Your Google accounts are now signed in, in the right profile each.
4. Bookmarks and history are then imported too, with a second summary such as "Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped)." This step needs no Keychain prompt.

If you clicked **Always Allow** before (an earlier version said to), undo it: open Keychain Access, find "Chrome Safe Storage" in the login keychain, open it, go to **Access Control**, select `security` in the list of allowed applications, click **−** and **Save Changes**.

You can repeat the import any time from the **Profiles** menu:

- **Import Logins from Chrome**: the shown profile only.
- **Import Logins for All Profiles**.
- **Replace Logins from Chrome…**: overwrites the shown profile's logins with Chrome's current ones, after a confirmation.

A normal import only adds logins Superbrowser doesn't have yet. It never signs you out. Superbrowser never writes to Chrome's files or its Keychain item.

### Bookmarks and history

**Profiles ▸ Import Bookmarks and History from Chrome** (also in the "+" menu) imports every visible profile's bookmarks and the last 90 days of its history. It is separate from the logins import and needs no Keychain access.

- Bookmarks come from each profile's `Bookmarks` and `AccountBookmarks` files, merged without duplicates, with the bookmarks bar at the top level and the rest in "Other Bookmarks" and "Mobile Bookmarks" folders. Only http and https addresses are kept.
- It only adds. Running it again adds nothing already there, and it never changes Chrome.
- Superbrowser then records your own browsing in each profile's history. Address suggestions and the History and Bookmarks panels use it, one profile at a time.
- **Bookmarks ▸ Bookmark This Page** (⌘D) adds the shown page. **History ▸ Clear History…** clears the shown profile's history after a confirmation.

## Shortcuts

| Keys | Action |
| --- | --- |
| ⌃1 … ⌃9 | Show the Nth profile in the bottom bar |
| ⌘1 … ⌘8, ⌘9 | Select the Nth tab, or the last tab |
| ⌘T | New tab (focuses the address field) |
| ⇧⌘T | Reopen the last closed tab |
| ⌘L | Focus the address field |
| ⌘W | Close the tab (never the window). In a popup window: close the popup |
| ⌘S | Hide or show the sidebar |
| ⌘R | Reload |
| ⌘[ / ⌘] | Back / Forward |
| ⌘F, ⌘G, ⇧⌘G | Find in page, next, previous (Esc closes) |
| ⌘+ (or ⌘=), ⌘−, ⌘0 | Zoom in, out, actual size |
| ⌃⌘F | Full screen |
| ⌘Y | Show or hide History in the sidebar |
| ⌘D | Bookmark this page |
| ⌥⌘B | Show or hide Bookmarks in the sidebar |
| ⌘P | Print |
| ⌥⌘I | Developer Tools for the page |
| ⌘Q, red button | Quit (tabs come back on the next launch) |

In a popup window (a sign-in or pop-out window), ⌘R, ⌘P, ⌘[ / ⌘], zoom and ⌥⌘I act on the popup; ⌘F does nothing there.

The address field takes a URL or a Google search: `example.com`, `localhost:3000` and `192.168.1.10/admin` open as addresses.

macOS uses ⌃1…⌃9 for "Switch to Desktop N" if that is turned on. If it is, turn those shortcuts off in System Settings → Keyboard → Keyboard Shortcuts → Mission Control.

## Profiles

- Profiles, names and colours come from Chrome's profile list. A profile deleted in Chrome keeps its Superbrowser data and stays in the bar until you hide it.
- Right-click a profile's dot for **Move Left**, **Move Right**, **Hide Profile** and **Open in Chrome**. ⌃N follows the bar order.
- **Profiles ▸ Show Hidden Profiles** brings a hidden profile back.
- **View ▸ Show Profile Names** shows names next to the dots all the time. Otherwise a name and its ⌃N slide out when you hover a dot.
- **Profiles ▸ Open This Profile in Chrome** opens the shown profile in real Chrome. Use it for anything Superbrowser can't do (see below).

Switching profile or tab never reloads a page. After a relaunch, the active tab of every visible profile loads: the shown one at once, the others a moment later and out of sight, so their mail and calendar notifications keep working. Other tabs, and every tab of a hidden profile, load when you first show them.

A page that warns about unsaved changes asks "Leave site?" before its tab or popup closes, reloads or goes to another address. **Stay** keeps the page as it is.

Popup windows (for example "Sign in with Google") show the address's host and the profile in their title, such as `accounts.google.com — Sign in (Work)`. A page can't change that part, so check the host before you paste a password into a popup.

The sidebar's Downloads list shows only the shown profile's downloads, so other profiles' file names don't appear on a shared screen.

Sites ask before using the camera, microphone, screen sharing, notifications, location or the clipboard. The answer is per profile and per site. Allow with "Remember for this site" is saved. Block lasts until you quit.

## Known limits

- **No passkeys.** A passkey request fails at once, so sites offer another way. Use password + 2-step code, or import logins from Chrome.
- **No password autofill.** Copy passwords from the macOS Passwords app.
- **Bookmarks and history import is one-way and add-only.** Later changes in Chrome don't carry over, and Superbrowser keeps 90 days of history. Deleting in Superbrowser never touches Chrome.
- **No Chrome extensions.** Use **Open This Profile in Chrome** for anything that needs one.
- **claude.ai needs a fresh login.** Its login is tied to the device and doesn't import.
- **Client hints are incomplete.** Electron sends `Sec-CH-UA` (which Superbrowser makes name Google Chrome) only with a page's own requests, not when a page is opened, and never sends the extra hints a site can ask for. Real Chrome sends both.
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
5. Move and resize the window, quit, and relaunch. The same profile, tabs and window position come back. A second visible profile's active tab is already loaded when you first switch to it (no load on switch); its other tabs load when shown.
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
    - On a page with a filled-in form that warns before leaving (for example a draft in a web form), ⌘W, ⌘R and typing an address ask "Leave site?". **Stay** keeps the page and its text; **Leave** proceeds.
12. ⌘F shows a white rounded bar at the top right of the page, with its field focused. Typing highlights matches and shows a "2/7"-style count, which is red at 0/0. Enter and ⇧Enter step through matches. Esc closes the bar, clears the highlights and lets you type into the page. Switching tab or profile closes the bar.
13. ⌘P shows the print dialog. ⌥⌘I opens detached DevTools for the page, and pressing it again closes them.

**Profile management**

14. **Move Right** on a dot changes the bar order and the ⌃N mapping.
15. **Hide Profile** removes the profile from the bar, and **Show Hidden Profiles** brings it back. Hiding the active profile switches to the first visible one. Hide is disabled when only one profile is visible.
16. Play audio in a profile and hide it: the audio goes silent. Unhide it: the sound returns.
17. **Open This Profile in Chrome** and the dot's **Open in Chrome** open Chrome on the right profile.
18. Quit and relaunch. The order, hidden profiles and Show Profile Names survive.

**Login import** (to test the first run: quit, then remove `state.json` and `Partitions/` from the data folder)

19. The first-run sheet appears over the window. Choose **Import All**. The explanation sheet appears and says to click Allow, not Always Allow. Then the macOS Keychain prompt for "Chrome Safe Storage" appears (click **Allow**), then one summary listing every visible profile.
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
30. "Sign in with Google" on a third-party site opens a small window that is already signed in to the same profile's Google account. Its title starts with `accounts.google.com` and ends with the profile's name in brackets. It completes the sign-in and closes itself.
    - With the popup focused, ⌘R reloads the popup, not the main window's tab, and ⌘W closes the popup.
    - Closing the main window while a popup is open quits Superbrowser, and the popup closes too.
31. Right-click menus:
    - A link: Open Link in New Tab, Copy Link Address.
    - An image: Copy Image, and Save Image As…, which saves to Downloads.
    - Selected text: Copy, Search Google for "…".
    - A text field: Cut, Copy, Paste, Select All.
    - Inspect opens DevTools at the element.
32. Download a PDF twice. Both appear in the sidebar's Downloads list, and `~/Downloads` has `x.pdf` and `x (1).pdf`. A "Downloaded x.pdf" notification appears. Clicking a row shows the file in Finder. ⌃2 shows another profile: its Downloads list doesn't show `x.pdf`.
33. YouTube full screen: the video fills the window and the window goes full screen. Esc restores the sidebar and bar. If the window was already full screen before, it stays full screen. ⌃2 during a full-screen video ends it.

**Bookmarks and history**

34. **Profiles ▸ Import Bookmarks and History from Chrome**: no Keychain prompt and no tab reload. One sheet lists a line per visible profile, such as "Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped).". Run it again: every line reports 0 imported. It also works while Chrome is running, and Chrome's bookmarks and history are unchanged afterwards. The "+" menu has the same item.
35. On first run (see Login import), the question reads "Import your logins, bookmarks and history from Chrome for all profiles?". **Import All** runs the logins import, then this one with its own summary. Cancelling the logins explanation still imports bookmarks and history.
36. Click the address field and type part of a page title or host. At most 6 rows appear under the field with stars on bookmarks and "Search Google for …" last. Enter with no row selected goes to what you typed. Arrow keys move through rows, Up past the first restores your text, and Esc restores the address and closes the list. A host completes inline, and Backspace removes the completion. ⌃2 closes the list, and then only that profile's pages are suggested.
37. Browse in one profile: open A, click through to B, reload B, go Back, then type a new address C. Only visits are recorded (not reload or Back as new visits). Reopening a closed tab with ⇧⌘T adds no visit. Another profile's History panel doesn't show these pages.
38. ⌘Y turns the sidebar into History with the search box focused. Rows are grouped by Today, Yesterday and dates, each with its time and host. Typing "ho so" finds Vietnamese titles such as "Hồ sơ…". Scrolling to the bottom loads older days. A click opens the page in the current tab and ⌘-click in a new tab. Right-click ▸ **Delete from History** removes the row and the suggestion. Esc, ✕ or ⌘Y closes the panel, and Downloads stay visible.
39. ⌥⌘B shows the imported folders. Click a folder to open or close it; an unnamed folder shows "Untitled". Searching shows a flat list with folder paths. Right-click a bookmark: Open in New Tab, Copy Link, Rename…, Move to ▸, Delete. Right-click a folder: New Folder…, Rename…, Delete (a non-empty folder asks first). In Rename, Enter saves and Esc or clicking away cancels.
40. ⌘D on a page opens Bookmarks with the new bookmark highlighted at the top. ⌘D again highlights it and adds no duplicate. ⌘D on a new tab page adds nothing. With a popup focused, ⌘Y, ⌥⌘B and ⌘D act on the main window.
41. With the sidebar hidden (⌘S), ⌘Y and ⌥⌘B show the sidebar first. With the History panel open and the sidebar hidden, switch profile, then show the sidebar: only the first page of history loads, and more loads as you scroll.
42. With a panel open, ⌃2 empties and refills it with that profile's data and keeps the search text. **History ▸ Clear History…** asks "Clear all history for <profile>?". Cancel keeps it, and Clear empties only that profile's history (another profile's suggestions still work).

## Privacy

Superbrowser talks only to the sites you open. It reads Chrome's profile list and, when you import, copies of a profile's cookie database, bookmarks and history files, and (for logins only) the "Chrome Safe Storage" Keychain item. It never writes to Chrome's data.
