# Superbrowser

A macOS browser that shows every Chrome profile in one ordinary window. It has a toolbar above the page (back, forward, reload and the address field), an Arc-style sidebar with the tabs of the current profile, its bookmarks and history in collapsible sections under them, and a profile bar at the bottom: click a profile's pill or press ⌃1…⌃9 to switch, and pin tabs from any profile at its right end. You can give a profile your own display name. Each profile has its own isolated storage, so every profile stays signed in to its own accounts at the same time. Profile names and colours come from Chrome; the bar order is your own. Logins, bookmarks and history can be imported from Chrome so you don't start over. Superbrowser is built on Electron (Chromium) and presents itself to sites as Google Chrome.

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
- **Import Bookmarks and History from Chrome**: every visible profile's bookmarks and history (see below).

A normal import only adds logins Superbrowser doesn't have yet. It never signs you out. Superbrowser never writes to Chrome's files or its Keychain item.

### Bookmarks and history

**Profiles ▸ Import Bookmarks and History from Chrome** (also in the "+" menu) imports every visible profile's bookmarks and the last 90 days of its history. It is separate from the logins import and needs no Keychain access.

- Bookmarks come from each profile's `Bookmarks` and `AccountBookmarks` files, merged without duplicates, with the bookmarks bar at the top level and the rest in "Other Bookmarks" and "Mobile Bookmarks" folders. Only http and https addresses are kept. A folder is created only when at least one bookmark is added to it, so empty Chrome folders aren't imported.
- It only adds. Running it again adds nothing already there (each line reads "0 bookmarks, 0 pages of history imported (N skipped)."), doesn't bring back a folder you renamed or deleted, and never changes Chrome.
- If a profile's history or bookmarks file can't be read (Chrome may be busy writing it), the summary is a warning and that line says so, for example "Personal: 175 bookmarks imported; history couldn't be read — try again." The rest still imports.
- Superbrowser then records your own browsing in each profile's history. Address suggestions and the sidebar's Bookmarks and History sections use it, one profile at a time.
- **Bookmarks ▸ Bookmark This Page** (⌘D) adds the shown page. **History ▸ Clear History…** clears the shown profile's history after a confirmation.
- The sidebar has **Bookmarks** and **History** sections right under the tabs and the New Tab button, folded at first. Click a header (or press ⌥⌘B / ⌘Y) to open or fold it. Both can be open at once; the tab list then takes up to about half the sidebar and each part scrolls on its own. Which sections are open is remembered across launches, for all profiles.
- Right-click ▸ **Delete from History** in the History section removes every visit to that page, not just the row clicked.

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
| ⌘Y | Open or fold History in the sidebar |
| ⌘D | Bookmark this page |
| ⌥⌘B | Open or fold Bookmarks in the sidebar |
| ⌥⌘1 … ⌥⌘9 | Open the Nth pinned tab in the bottom bar (Tab ▸ Pinned Tabs) |
| ⌘P | Print |
| ⌥⌘I | Developer Tools for the page |
| ⌘Q, red button | Quit (tabs come back on the next launch) |

In a popup window (a sign-in or pop-out window), ⌘R, ⌘P, ⌘[ / ⌘], zoom and ⌥⌘I act on the popup; ⌘F does nothing there.

The address field takes a URL or a Google search: `example.com`, `localhost:3000` and `192.168.1.10/admin` open as addresses.

macOS uses ⌃1…⌃9 for "Switch to Desktop N" if that is turned on. If it is, turn those shortcuts off in System Settings → Keyboard → Keyboard Shortcuts → Mission Control.

## Profiles

- Profiles, names and colours come from Chrome's profile list. A profile deleted in Chrome keeps its Superbrowser data and stays in the bar until you hide it.
- Drag a profile's pill along the bar to reorder it: the others slide apart to show where it lands, and Esc or letting go above the bar cancels. Right-click a profile's pill for **Move Left**, **Move Right**, **Set Display Name…**, **Hide Profile** and **Open in Chrome**. ⌃N follows the bar order, which is Superbrowser's own (Chrome's is never changed).
- **Set Display Name…** edits the name right in the pill: Enter or clicking away saves, Esc cancels, an empty name goes back to Chrome's name (up to 40 characters). It is used in pills, tooltips, menus, popup titles and import sheets, and is stored only in Superbrowser (Chrome's data is never written).
- **Pinned tabs.** Right-click a sidebar tab, or use **Tab ▸ Pinned to Bar**, to pin it. The pin appears as a tile at the right of the bottom bar with the site's icon and a dot in its profile's colour. Clicking a pin switches to its profile and shows its tab there (without a reload), or opens the pin's address if the profile has no tab on that site. Right-click a tile for **Unpin**, **Move Left** and **Move Right**. Pins of a hidden profile are hidden until it comes back. When the bar is full, pins shrink before profile pills do.
- **Profiles ▸ Show Hidden Profiles** brings a hidden profile back.
- **View ▸ Show Profile Names** shows names next to the pills all the time. Otherwise the name and ⌃N show in the pill's tooltip.
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

1. The window opens on the first visible profile. The page has rounded corners, inset 8 px from the window's sides with the toolbar strip (back, forward, reload, address) above it, and the sidebar is on the left. There is no white flash at startup.
2. ⌃2 shows another profile. ⌃1 returns to the first page without a reload, and the scroll position is kept. The window tint changes to the profile's colour.
3. Sign in to a site in one profile. Another profile is still signed out there.
4. Hovering a profile pill changes only its background; no pill moves. The tooltip shows the name and ⌃N. Clicking a pill switches profile.
5. Right-click a pill, choose **Set Display Name…**, type a name and press Enter: the pill, its tooltip, the Profiles menu, **Show Hidden Profiles**, popup titles and import sheets use it. Escape cancels, clicking away saves, an empty name restores Chrome's name, and Chrome's own profile name is unchanged. Clicking another pill mid-edit saves and still switches profile.
6. Right-click a sidebar tab, choose **Pin to Bar**: a tile with the site icon and the profile-colour dot appears at the right of the bar, and the menu now says **Unpin from Bar**. Tab ▸ **Pinned to Bar** shows a check for that tab and toggles it.
7. Click the pin while another profile is shown: that profile is shown and its same-host tab is selected (the remembered one if you switched away from it), without a reload. With no same-host tab, the pin's address opens in a new tab of the pin's profile. The pin's icon and title follow its tab even when its profile is not shown. Quit and relaunch, then click a pin whose tab has not loaded yet: it loads once, with no extra blank tab.
8. ⌥⌘1 acts like clicking the first pin; Tab ▸ **Pinned Tabs** lists the pins with ⌥⌘1…⌥⌘9, or a disabled "No Pinned Tabs" when there are none. Right-click a tile: **Unpin**, **Move Left** and **Move Right** work, and the order survives a relaunch.
9. Hide a profile that has a pin: its pin disappears from the bar and ⌥⌘N skips it. Show it again: the pin is back. Narrow the window: pins shrink before profile pills, and neither disappears.
10. Move and resize the window, quit, and relaunch. The same profile, tabs and window position come back. A second visible profile's active tab is already loaded when you first switch to it (no load on switch); its other tabs load when shown.
11. The menu bar and the Dock say "Superbrowser" and show its icon.

**Sidebar and tabs**

12. Clicking a tab, **+ New Tab**, ×, Back, Forward and Reload all work. Typing `example.com` + Enter in the address field opens it.
13. ◧ or ⌘S hides the sidebar. The page and the toolbar fill the width, the window buttons disappear, the address field and ⌘L still work, and the bottom bar still switches profiles. Showing the sidebar brings the buttons back at the same place.
14. The window can be dragged by the bottom bar, the top 40 px of the sidebar and the empty parts of the toolbar strip above the page. Clicking near the top of a page (for example Google's account avatar) clicks the page and doesn't drag the window. Favicons appear for loaded tabs.

**Shortcuts and find**

15. Every shortcut in the table works:
    - with the sidebar shown and with it hidden;
    - with focus in the page, in the address field and in the find bar.
16. ⌘W never closes the window, even on the last tab.
    - On a page with a filled-in form that warns before leaving (for example a draft in a web form), ⌘W, ⌘R and typing an address ask "Leave site?". **Stay** keeps the page and its text; **Leave** proceeds.
17. ⌘F shows a white rounded bar at the top right of the page, with its field focused. Typing highlights matches and shows a "2/7"-style count, which is red at 0/0. Enter and ⇧Enter step through matches. Esc closes the bar, clears the highlights and lets you type into the page. Switching tab or profile closes the bar.
18. ⌘P shows the print dialog. ⌥⌘I opens detached DevTools for the page, and pressing it again closes them.

**Profile management**

19. **Move Right** on a pill changes the bar order and the ⌃N mapping.
20. **Hide Profile** removes the profile from the bar, and **Show Hidden Profiles** brings it back. Hiding the active profile switches to the first visible one. Hide is disabled when only one profile is visible.
21. Play audio in a profile and hide it: the audio goes silent. Unhide it: the sound returns.
22. **Open This Profile in Chrome** and the pill's **Open in Chrome** open Chrome on the right profile.
23. Quit and relaunch. The order, hidden profiles and Show Profile Names survive.

**Login import** (to test the first run: quit, then remove `state.json` and `Partitions/` from the data folder)

24. The first-run sheet appears over the window. Choose **Import All**. The explanation sheet appears and says to click Allow, not Always Allow. Then the macOS Keychain prompt for "Chrome Safe Storage" appears (click **Allow**), then one summary listing every visible profile.
25. Gmail opens signed in on each imported profile without logging in. Chrome is still signed in.
26. **Import Logins from Chrome** again reports 0 new logins, with the rest skipped.
27. Clicking Deny at the Keychain prompt shows an error sheet, and nothing changes.
28. **Replace Logins from Chrome…** asks for confirmation, re-imports, and reloads that profile's loaded tabs.

**Site permissions**

29. Google Meet → "Check your audio and video": one sheet asks for the camera and microphone. After Allow, macOS asks once for camera and microphone access for Superbrowser. Video and sound work, and after a relaunch Meet doesn't ask again.
30. Meet → Present now: the macOS screen picker appears.
31. Gmail's desktop notifications prompt appears as a sheet. After Allow, a notification appears.
32. Google sign-in on an account with a passkey: the passkey step offers other options at once instead of hanging.
33. A request from a profile that isn't shown names that profile in the sheet ("Profile: …").

**Pages, popups and downloads**

34. ⌘-click a link: a background tab opens right after the current one. ⇧-click: a foreground tab.
35. "Sign in with Google" on a third-party site opens a small window that is already signed in to the same profile's Google account. Its title starts with `accounts.google.com` and ends with the profile's name in brackets. It completes the sign-in and closes itself.
    - With the popup focused, ⌘R reloads the popup, not the main window's tab, and ⌘W closes the popup.
    - Closing the main window while a popup is open quits Superbrowser, and the popup closes too.
36. Right-click menus:
    - A link: Open Link in New Tab, Copy Link Address.
    - An image: Copy Image, and Save Image As…, which saves to Downloads.
    - Selected text: Copy, Search Google for "…".
    - A text field: Cut, Copy, Paste, Select All.
    - Inspect opens DevTools at the element.
37. Download a PDF twice. Both appear in the sidebar's Downloads list, and `~/Downloads` has `x.pdf` and `x (1).pdf`. A "Downloaded x.pdf" notification appears. Clicking a row shows the file in Finder. ⌃2 shows another profile: its Downloads list doesn't show `x.pdf`.
38. YouTube full screen: the video fills the window and the window goes full screen. Esc restores the sidebar and bar. If the window was already full screen before, it stays full screen. ⌃2 during a full-screen video ends it.

**Bookmarks and history**

39. **Profiles ▸ Import Bookmarks and History from Chrome**: no Keychain prompt and no tab reload. One sheet lists a line per visible profile, such as "Personal: 175 bookmarks, 12,685 pages of history imported (3 skipped).". Run it again: every line reads "0 bookmarks, 0 pages of history imported (N skipped).". It also works while Chrome is running, and Chrome's bookmarks and history are unchanged afterwards. The "+" menu has the same item.
40. On first run (see Login import), the question reads "Import your logins, bookmarks and history from Chrome for all profiles?". **Import All** runs the logins import, then this one with its own summary. Cancelling the logins explanation still imports bookmarks and history.
41. Click the address field in the toolbar and type part of a page title or host. At most 6 rows appear in a card under the field, over the page, with stars on bookmarks and "Search Google for …" last. Enter with no row selected goes to what you typed. Arrow keys move through rows, Up past the first restores your text, and Esc restores the address and closes the list. A host completes inline, and Backspace removes the completion. A completion that runs into a path keeps its capitals (try a Google Docs link: Enter opens the document). ⌃2 closes the list, and then only that profile's pages are suggested.
42. Browse in one profile: open A, click through to B, reload B, go Back, then type a new address C. Only visits are recorded (not reload or Back as new visits). Reopening a closed tab with ⇧⌘T adds no visit. Another profile's History section doesn't show these pages.
43. ⌘Y opens the History section (if folded) under the tabs with its search box focused; the tab list stays, and the active tab stays visible in it. With History open, visit a new page: it appears under Today within a couple of seconds (not while you are scrolled down or searching). Rows are grouped by Today, Yesterday and dates, each with its time and host. Typing "ho so" finds Vietnamese titles such as "Hồ sơ…". Scrolling to the bottom loads older days. A click opens the page in the current tab and ⌘-click in a new tab. Right-click ▸ **Delete from History** removes every visit to that page (all its rows, on every day) and its suggestion. ⌘Y or a click on its header folds it, and Downloads stay visible.
44. ⌥⌘B opens the Bookmarks section with the imported folders. Click a folder to open or close it; an unnamed folder shows "Untitled". Searching shows a flat list with folder paths. Right-click a bookmark: Open in New Tab, Copy Link, Rename…, Move to ▸, Delete. Right-click a folder: New Folder…, Rename…, Delete (a non-empty folder asks first). In Rename, Enter saves and Esc or clicking away cancels.
45. ⌘D on a page opens the Bookmarks section (if folded) with the new bookmark highlighted at the top. ⌘D again highlights it and adds no duplicate. ⌘D on a new tab page adds nothing. With a popup focused, ⌘Y, ⌥⌘B and ⌘D act on the main window.
46. With the sidebar hidden (⌘S), ⌘Y and ⌥⌘B show the sidebar first, with the section open, even if that section was open when the sidebar was hidden (they never fold it then). With the History section open and the sidebar hidden, switch profile, then show the sidebar: only the first page of history loads, and more loads as you scroll.
47. With a section open, ⌃2 empties and refills it with that profile's data and keeps the search text; which sections are open doesn't change. **History ▸ Clear History…** asks "Clear all history for <profile>?". Cancel keeps it, and Clear empties only that profile's history (another profile's suggestions still work).
48. Drag the 4th profile's pill to the front: the others slide aside, the drop sticks without a flicker, ⌃1 now shows that profile, and a relaunch keeps the order. A click (even with a slight wobble) still switches profile and right-click still shows Move Left/Right. Esc mid-drag, or letting go above the bar, puts it back. Dragging a pill never moves the window, while dragging the bar's empty space still does. Hide a profile, reorder the others, then show it again: it is back in its old place.
49. Right under the tabs and New Tab (not at the bottom of the sidebar), **Bookmarks** and **History** headers are folded on first launch. Click Bookmarks: it opens under the tabs, the tab list stays and shrinks to at most about half the sidebar, and both scroll on their own. With many tabs, select the last one and open a section: the active tab is still in view, and ⌘T's new tab scrolls into view. Open History too: the two share the space. Quit and relaunch: both are still open. Click a header while a page is loading: it stays the way you clicked it. Esc in a section's search clears it, then leaves the field; it never folds the section. ⌘Y folds History (typing then goes to the page); ⌘Y again opens it with the search focused and its text selected.

## Privacy

Superbrowser talks only to the sites you open. It reads Chrome's profile list and, when you import, copies of a profile's cookie database, bookmarks and history files, and (for logins only) the "Chrome Safe Storage" Keychain item. It never writes to Chrome's data.
