# Superbrowser — design

Date: 2026-11-18
Status: superseded 2026-11-19 by 2026-11-19-superbrowser-electron-design.md

## Intent and why

The user works across several client Google accounts, each in its own Chrome
profile (7 real profiles today, e.g. "Personal", "NSM Infosys", "FPT - Neilson",
plus a password-manager extension in them). Chrome gives every profile its own
windows. Those windows end up scattered across several macOS desktops (Spaces),
and finding the right client means swiping between desktops and hunting for
windows. That costs time and breaks focus.

Superbrowser makes all those profile windows behave like **one window with one
tab per client**. Click a client's tab (or press its shortcut) and that client's
Chrome window is in front, in exactly the same place.

It must keep **real Chrome** doing the browsing, because:
- Google blocks or flags sign-in from embedded/custom browsers (Electron, CEF),
  and these are client Google accounts — lockouts are unacceptable.
- The password-manager extension only works properly in real Chrome.
- Existing logins, extensions, and history stay as they are; nothing to migrate.

## Goals

1. **One frame.** Every Chrome window of every profile is kept at the same
   position and size, stacked on top of each other, so switching never makes
   anything appear to move.
2. **Profile tab bar.** A Superbrowser bar attached to the frame shows one tab
   per Chrome profile, with that profile's name and Chrome profile color.
   Clicking a tab brings that profile's window to the front.
3. **Bar position is configurable:** left, right, top or bottom of the frame.
   Top/bottom = horizontal row of tabs; left/right = vertical column.
4. **Keyboard shortcuts:** Ctrl+1 for the first profile tab, Ctrl+2 for the
   second, … Ctrl+9. They work globally, from any desktop and any app.
5. **One browser desktop.** Chrome is assigned to a single macOS desktop (Dock →
   Chrome → Options → Assign To → This Desktop). The frame and bar live there.
   Pressing a shortcut or clicking a tab from another desktop takes the user to
   the browser desktop with that profile in front.
6. **Moving/resizing the frame** moves/resizes every Chrome window and the bar
   together.

## Behavior details

- **Profile with no open window:** clicking its tab (or its shortcut) opens a new
  window for that profile, placed in the frame.
- **Profile with several windows:** all of them are stacked in the frame.
  Clicking the profile's tab (or pressing its shortcut) again while it is already
  in front cycles through that profile's windows.
- **New Chrome windows** (any profile, e.g. opened via a link or Cmd+N) are pulled
  into the frame automatically.
- **Active tab indicator:** the bar highlights the profile whose window is in
  front.
- **Profile list and colors** come from Chrome's own profile list
  (`~/Library/Application Support/Google/Chrome/Local State`, `profile.info_cache`),
  so renaming or recoloring a profile in Chrome shows up in Superbrowser.
  Superbrowser lets the user hide profiles and reorder tabs; the order defines
  which profile Ctrl+N maps to.
- **Chrome not running:** clicking a tab launches Chrome with that profile.
- **First run checklist:** grant the Accessibility permission; assign Chrome to
  one desktop; quit and reopen Chrome so existing windows gather on that desktop;
  pick the bar position.

## Non-goals (first version)

- Searching across every page tab of every profile (possible later addition).
- Merging profiles' page tabs into one Chrome tab strip; each profile's Chrome
  window keeps its own Chrome tab strip under/next to the bar.
- Chrome full-screen mode (macOS can't control full-screen windows; the frame
  uses a normal, possibly maximized, window size instead).
- Other browsers, Windows/Linux, App Store distribution, other users.

## Anti-goals (would be a failure even if it technically works)

- Anything that makes Google see a non-Chrome browser, or that needs the user to
  sign in to client accounts again.
- Breaking or limiting the password manager.
- Visible jumping/flicker of windows when switching profiles — the switch should
  feel like changing a tab, not moving windows.
- Fighting the user: if they deliberately drag a Chrome window out, Superbrowser
  should not yank it back in an endless loop (see "left to the builder").

## Constraints

- macOS 27 (Darwin 27.3), Apple Silicon MacBook, several desktops (Spaces).
- macOS gives apps no public way to move windows between desktops or to control
  full-screen windows; hence the one-browser-desktop setup through Chrome's Dock
  assignment.
- Window positioning requires the macOS Accessibility permission.
- Ctrl+1/2/3 "Switch to Desktop N" system shortcuts are currently **disabled** on
  this Mac, so Ctrl+1…9 are free. If they are enabled later, they'd collide;
  Superbrowser should warn and let the user change the modifier.
- Toolchain on this Mac: Swift 6.4 via Command Line Tools (no full Xcode), so the
  app should build with Swift Package Manager / command line.
- Personal use only; an unsigned/ad-hoc-signed local build is fine.

## Approaches considered

1. **Custom browser (Electron) with per-profile sessions in one real window.**
   True single window, but Google may block sign-in for client accounts, the
   password-manager extension barely works, and every account needs a fresh
   login. Rejected: fights both core requirements.
2. **Real Chrome, windows stacked into one frame, with a Superbrowser profile
   tab bar (chosen).** Keeps Chrome, logins, and the password manager untouched;
   the cost is that it's an illusion of one window and each Chrome window still
   shows its own tab strip.
3. **Hotkey switcher only (no frame).** Cheapest, but windows still scatter, so
   the focus problem remains. Rejected.

Also ruled out before building: Arc (sunsetting 2026-12-22), Firefox
Multi-Account Containers (leaves Chrome), Wavebox (paid, third-party).

## Decided parts of the how

- Native macOS app in **Swift** (AppKit), running as a menu-bar/background app,
  that draws the bar, owns the global shortcuts, and positions Chrome windows via
  the Accessibility API.
- **A small helper Chrome extension is installed in every profile** (loaded
  unpacked, developer mode) and tells the app which windows belong to its
  profile. It only reads window/tab info and talks only to the local app. The
  user owns all profiles, approves installing it, and administers the
  nsminfosys.com and ideastellar.com Workspace orgs (can allow it via admin
  policy if needed). The Linh HOU profile (students.hou.edu.vn) is managed by the
  university; if its policy blocks the extension, that one profile needs a
  non-extension fallback for identifying its windows — check this first.
- Chrome is launched/targeted per profile with
  `--profile-directory=<dir>` (e.g. `open -na "Google Chrome" --args --profile-directory="Profile 37"`).

## Calls made after builder review (designer's calls, user may override)

- **Which windows join the frame:** only normal Chrome browser windows. Sign-in /
  OAuth popups, password-manager popups, DevTools, installed web apps (PWAs) and
  picture-in-picture are left alone. Snapping sign-in or password popups would
  break the flows the anti-goals protect.
- **Hidden profiles** are off the bar *and* unmanaged: their windows are not
  stacked or pulled into the frame.
- **Other apps on the browser desktop:** the bar is not always-on-top; it stays
  ordered together with the front Chrome frame window, so an app covering the
  frame also covers the bar.
- **Displays:** built for the MacBook screen. If displays change (monitor plugged
  in/out), the frame is clamped back onto a visible screen; no per-arrangement
  layouts in v1.

## Left to the builder

- **How the helper extension talks to the app** (native messaging or a localhost
  socket) and how its windows are matched to the windows the app sees through
  Accessibility. Plus the fallback for a profile where the extension is blocked.
- How the bar attaches to the frame and the windows' area is computed for each
  bar position; bar size/visual style (keep it slim and native-looking).
- How the frame's position/size is stored and restored across restarts.
- How to avoid the drag-out fight loop (e.g. a modifier-drag or a menu item to
  release a window, or only snapping windows when they're created/activated).
- How to cycle a profile's multiple windows and how to raise a window without
  flicker.
- Settings UI scope (bar position, profile order/visibility, shortcut modifier,
  launch at login).
- Testing approach.
