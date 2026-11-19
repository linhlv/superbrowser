# Superbrowser v2 — one real window for every profile (Electron)

Date: 2026-11-19
Status: approved 2026-11-19
Supersedes the approach in `2026-11-18-superbrowser-design.md` (stacked real Chrome
windows). The intent of that document still holds; its "never make Google see a
non-Chrome browser" anti-goal and the "real Chrome only" constraint are reversed
here by the user's decision (see Approaches).

## Intent and why

The user works across several client Google accounts, each in its own Chrome
profile (7 today: Personal, Linh HOU, Nguyễn Thị Thanh Nhã, FPT - Neilson,
NSM Infosys, IdeaStellar System Administrator, NFS Claude 1 Dev). They want to
**work on all of those profiles in one ordinary window**, with an **Arc-like
UI**.

The first Superbrowser (Swift app stacking each profile's real Chrome window
under a tab bar) didn't deliver that. In the user's words: "The UI is terrible, I
want the UI look like Arc", and "I don't want the window sticking on Desktop,
it's simply a window that I can work on multiple browser profiles". Real Chrome
can't do either: its own tab strip/toolbar can't be hidden, one Chrome window
can only show one profile, and macOS gives no way to move another app's windows
between desktops. The user chose to build our own Chromium-based browser instead.

Success: one Superbrowser window, movable/resizable/full-screen like any app, on
any desktop; switch client profile with one click or ⌃N; every profile stays
signed in to its own accounts at the same time; no re-login thanks to importing
logins from Chrome.

## What the throwaway spike proved (2026-11-19)

A spike (Electron 45.3.4, Chromium 156; scratchpad, not in the repo) showed:

- **Google accepts it.** With a Chrome user agent and `Sec-CH-UA` brand set to
  "Google Chrome", Google's sign-in went straight to account verification, no
  "browser may not be secure" page.
- **Login import from Chrome works.** Copying a Chrome profile's cookies
  (decrypted with the "Chrome Safe Storage" Keychain key) into that profile's
  Electron session left the user signed in to Google without logging in. Google
  logins are not device-bound (DBSC) on this Mac; only claude.ai is (Default,
  Profile 36, Profile 37), so claude.ai needs a fresh login.
- **Passkeys do not work** (Google's passkey step hangs: Electron has no platform
  authenticator unless configured, and no prompt UI).
- **iCloud Passwords extension does not work** (loads, then crashes:
  `webNavigation` unsupported). Google Password Manager is part of Chrome and
  isn't available either.
- **UI the user approved by trying it:** left sidebar (back/forward/reload,
  address field, vertical tab list for the current profile, "+ New Tab"); a
  slim **bottom profile bar** across the whole window that stays visible when the
  sidebar is hidden; profile **dots only by default, name + ⌃N slide out on
  hover**, with a "Show Profile Names" option; **⌘S** hides/shows the sidebar;
  *(Later changes: back/forward/reload and the address field moved to a toolbar
  strip above the page, and pills no longer slide out on hover. See the plan's
  "Deviations during execution" and `2026-11-19-bottom-bar-pins-display-names-design.md`.)*
  the window background tints with the active profile's color; page area has
  rounded corners inset from the window edge.

## Goals

1. **One window, all profiles.** One Superbrowser window holds every profile.
   Each profile has its own isolated storage (cookies, local storage, cache,
   IndexedDB, service workers) and its own tab list. Switching profile swaps the
   sidebar's tab list and the page shown; nothing reloads.
2. **Arc-like UI** as proven in the spike (above).
3. **Profile switching:** click a dot in the bottom bar, or ⌃1…⌃9 (in bar order).
   Works with the sidebar hidden.
4. **Profiles come from Chrome:** names and colors read from Chrome's
   `Local State` (`profile.info_cache`; color from `profile_color_seed`, else
   `default_avatar_fill_color`, signed ARGB), same order as Chrome's list. The
   user can hide profiles and reorder them in Superbrowser; ⌃N follows that
   order.
5. **Import logins from Chrome**, per profile and for all profiles at once, so
   the user doesn't sign in again. Offered on first run; re-runnable from the
   menu.
6. **Ordinary window:** normal macOS window (resizable, full screen, works on any
   desktop, remembers its size/position).
7. **Tabs persist** across quit/relaunch, per profile (URL, title, order, which
   tab is active), plus the active profile and sidebar visibility.
8. **Everyday browser basics** (so it can replace Chrome for this work):
   address field (URL or Google search), back/forward/reload, ⌘T/⌘W/⌘L/⌘R,
   ⌘⇧T reopen closed tab, ⌘1…⌘9 select tab in the current profile, find in page
   (⌘F), zoom (⌘+/⌘−/⌘0), right-click context menu (open link in new tab, copy
   link, copy/paste, save image, inspect), downloads to `~/Downloads` with a
   simple list, printing, HTML5 full screen video, web notifications as macOS
   notifications, and sign-in/OAuth popups as small separate windows in the
   same profile.
9. **Site permission prompts** (camera, microphone, notifications, location,
   screen sharing, clipboard) ask the user, per profile and per site, and remember
   the answer. Google Meet must work (camera, mic, screen share).

## Non-goals (v1)

- **Spaces** (several tab lists inside one profile) — the user said not needed.
- **Passkeys.** Deferred (see "Passkeys — later"). Sign in with password + 2-step
  code, or avoid sign-in entirely via login import.
- **Password autofill / any password manager.** The user copies from the macOS
  Passwords app.
- **Chrome extensions** (Claude, vidIQ, Obsidian Web Clipper, BrowserSkill,
  Chrome Remote Desktop, Adobe Acrobat…). Chrome stays installed for anything
  that needs them.
- Being the macOS **default browser** / handling links from other apps.
- Pinned tabs / favorites, tab groups, split view, command bar, search across all
  profiles' tabs, multiple Superbrowser windows (one main window; popups are the
  only extra windows), sync, Windows/Linux, App Store, other users.
- Creating brand-new profiles that don't exist in Chrome.
- Importing passwords (bookmarks and history: see `2026-11-19-bookmarks-history-design.md`).

## Anti-goals (a failure even if it technically works)

- **One profile's cookies or storage visible to another profile.** Client
  accounts must never cross. Every web contents, popup, download, service worker
  and permission decision belongs to exactly one profile.
- **Getting a client Google account locked or flagged.** Keep the Chrome UA /
  client hints consistent with the real Chromium version; never automate sign-in.
- **Breaking the user's real Chrome:** import reads Chrome's files (copies them
  first) and never writes to Chrome's profile directory or Keychain item.
- **Silently granting site permissions** (Electron's default is to allow all).
- Visible flicker or page reloads when switching profiles or tabs within a
  running session (after a relaunch, tabs load lazily — see Calls).
- Losing open tabs or logins on quit, crash, or update.

## Constraints

- macOS 27 (Darwin 27.3), Apple Silicon; Command Line Tools only (no Xcode);
  Node 22 available. Personal use; ad-hoc signed local build is fine.
- Free Apple Developer account only (Apple Development cert present; free
  provisioning profiles last 7 days).
- Chrome 158 installed; Electron 45 ships Chromium 156. The user agent must
  report Electron's real Chromium major version.
- Electron must be kept current (Chromium security fixes): the build should make
  bumping Electron a routine step.
- Chrome cookie format on this Mac: `Cookies` SQLite, meta version 24, values
  `v10` + AES-128-CBC (key = PBKDF2-SHA1("Chrome Safe Storage" password,
  "saltysalt", 1003 iterations, 16 bytes), IV = 16 spaces), plaintext prefixed
  with SHA-256(host_key) when version ≥ 24. Reading the Keychain item shows a
  macOS prompt the user must allow.

## Approaches considered

1. **Keep real Chrome, improve the stacked-window app (v1).** Keeps logins,
   passwords, extensions. Rejected: can't look like Arc (Chrome's own toolbar
   stays) and can't be a normal window that moves between desktops.
2. **Own Chromium fork (Arc/Brave/Vivaldi style).** Best compatibility. Rejected:
   ~100 GB checkout, hours per build, needs full Xcode, and multi-profile-per-
   window means rewriting Chromium's browser UI.
3. **Electron app with one session partition per profile (chosen by the user).**
   Real single window, full UI freedom, Google sign-in works with a Chrome UA.
   Costs: no Chrome extensions/password manager, passkeys deferred, must track
   Electron releases.

## Passkeys — later (decision recorded, not built in v1)

- iCloud Keychain passkeys need Apple's
  `com.apple.developer.web-browser.public-key-credential` entitlement (paid
  Developer Program, Account Holder request, uncertain approval) **and** a custom
  native bridge, because Electron's `platformPasskeys` only serves sites that
  list the app in their `apple-app-site-association` (google.com never will).
  The user first chose this route; it's blocked on the free account.
- Feasible alternative: Electron's Touch ID authenticator
  (`app.configureWebAuthn({ touchID: { keychainAccessGroup } })`, per-session
  credentials). Needs signing with a provisioning profile (full Xcode + free
  account = 7-day profiles, or paid account = 1 year). New passkeys created
  inside Superbrowser, not the user's iCloud ones.
- v1 must at least make passkey requests **fail fast** (so Google shows other
  options) instead of hanging silently.

## Decided parts of the how

- **Chrome and Superbrowser share Google logins (user's decision, 2026-11-19).**
  After import the user keeps using the same Google accounts in Chrome too. Both
  browsers then hold the same Google session; the user accepts that Google may
  occasionally sign one side out or send a security alert. The import dialog says
  so in one line. Recovery when Superbrowser gets signed out: a per-profile
  **"Replace logins from Chrome"** action that overwrites with Chrome's current
  cookies (explicit, user-triggered; normal import stays add-only).

- **Electron + TypeScript**, in this repository. Profile isolation via
  `session.fromPartition('persist:<chrome profile dir>')`.
- **Window structure** as in the spike: one `BrowserWindow`
  (`titleBarStyle: 'hiddenInset'`); the chrome UI (sidebar + bottom bar) is one
  `WebContentsView` underneath; each tab is a `WebContentsView` on top, only the
  active one visible. Window buttons hidden when the sidebar is hidden.
- **Browser identity per session:** UA
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36`
  and `Sec-CH-UA` rewritten to `"Google Chrome";v="<major>", "Chromium";v="<major>", "Not_A Brand";v="24"`,
  where `<major>` is Electron's own Chromium major version.
- **Login import** as in the spike: copy the profile's `Cookies` DB to a temp
  file, decrypt, `session.cookies.set` each cookie (domain cookies keep their
  leading-dot domain; `__Host-` cookies get no domain; session cookies stay
  session cookies; map `samesite` −1/0/1/2 → unspecified/no_restriction/lax/
  strict). Partitioned cookies (`top_frame_site_key`) were skipped in the spike.
- **Shortcuts:** ⌃1…⌃9 profiles, ⌘S sidebar, plus the browser shortcuts in Goals.
- **Packaging:** a real `Superbrowser.app` bundle (own name, icon, bundle id),
  ad-hoc signed, buildable with Command Line Tools only, with an install script
  like v1's `scripts/build-app.sh --install`.

## Calls made by the designer (user may override)

- **The Swift app and the helper extension retire.** v2 replaces them; they stay
  in git history. Existing docs (README, CLAUDE.md) get rewritten for v2.
- **Re-import never signs a profile out:** re-import only adds cookies that
  Superbrowser doesn't already have (same name + domain + path); it never
  overwrites or deletes, because Chrome's copy of a rotating Google cookie may be
  older than Superbrowser's.
- **Tabs restore lazily after relaunch:** only each profile's active tab loads at
  startup; other restored tabs load when first shown. Within a running session
  tabs are never unloaded.
- **Escape hatch per profile:** a menu item "Open this profile in Chrome" (runs
  Chrome with `--profile-directory=<dir>`) for any site or Workspace policy that
  refuses Superbrowser.
- **Profiles missing from Chrome later** (deleted in Chrome) keep their
  Superbrowser data and tabs and stay in the bar until hidden by the user.
- **Closing the window quits the app** (single-window app); tabs are restored
  on next launch.

## Left to the builder

- Project layout, bundler/packaging tool (e.g. Electron Forge or
  electron-builder), and test setup (unit tests for pure logic: profile parsing,
  cookie decryption/mapping, tab-state persistence, URL-vs-search parsing,
  layout maths; plus a manual end-to-end checklist).
- How tab/session state is stored and how often it's saved.
- Exact look within the spike's direction (sizes, colors, animations, dark/light
  handling, the "Show Profile Names" setting's home), the settings UI for
  hiding/reordering profiles.
- Download list UI and the permission prompt UI.
- How passkey requests are made to fail fast.
