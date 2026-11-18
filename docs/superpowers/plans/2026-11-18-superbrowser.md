# Superbrowser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS menu-bar app that makes every Chrome profile's windows behave like one window with one tab per profile, switchable by click or Ctrl+1…9.

**Architecture:** A helper Chrome extension in each profile POSTs its normal windows' bounds to the app on `127.0.0.1:47321`. The app sees Chrome's windows through the Accessibility (AX) API, matches each AX window to a profile by exact bounds (temporarily giving stacked windows unique heights to tell them apart), stacks every matched window in one frame, and draws a profile tab bar beside it. All decision logic lives in a testable `SuperbrowserCore` library behind two protocols (`WindowSystem`, `ChromeLaunching`); the AppKit/AX/Carbon code in the `Superbrowser` executable is a thin layer verified manually.

**Tech Stack:** Swift 6 (Swift Package Manager, Command Line Tools only, no Xcode project), swift-testing (`import Testing`), AppKit, ApplicationServices (AX), Carbon (`RegisterEventHotKey`), Network.framework (`NWListener`), ServiceManagement (`SMAppService`). Extension: Chrome Manifest V3, plain JS modules, tested with `node --test` (Node 22). No third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-superbrowser-design.md`

## Global Constraints

- Deployment target macOS 14 (`.macOS(.v14)`); the machine runs macOS 27, Apple Silicon.
- `swift-tools-version:6.0`; tests use swift-testing, not XCTest (XCTest is not installed with Command Line Tools).
- Real Chrome does all browsing. Never write to anything under `~/Library/Application Support/Google/Chrome/`; `Local State` is read-only input.
- Chrome bundle id `com.google.Chrome`; profiles are opened with `open -na "Google Chrome" --args --profile-directory=<dir>`.
- Profile list, names and colors come from `~/Library/Application Support/Google/Chrome/Local State` → `profile.info_cache`, default order `profile.profiles_order`; an entry counts only if its directory exists (this Mac has a phantom `.chrome` entry with no directory).
- Only Chrome windows of type `normal` are managed. Popups (sign-in/OAuth, password manager), DevTools, installed web apps, picture-in-picture, minimized and full-screen windows are left alone.
- Hidden profiles: not on the bar and their windows are not managed.
- Shortcuts: Ctrl+1…Ctrl+9 → visible profile tabs 1…9 in bar order, global from any desktop. Modifier choices: Control (default), Control+Option, Control+Command.
- Bar position: `left`, `right`, `top`, `bottom`. Horizontal bar height 32 pt; vertical bar width 168 pt.
- Bar is not always-on-top: `.floating` level while Chrome is the active app, `.normal` otherwise.
- Local server: `127.0.0.1` only, port `47321`. Endpoints `POST /report`, `GET /claim?dir=<profileDir>`.
- App bundle id `dev.superbrowser.app`, name `Superbrowser`, `LSUIElement` = true (menu-bar app, no Dock icon).
- Settings file: `~/Library/Application Support/Superbrowser/settings.json`.
- All geometry inside Core is in AX/global coordinates (origin top-left of the primary screen, y grows downward, points) — the same space Chrome's `chrome.windows` bounds use.

## Review Focus

1. **Chrome quits or crashes while Superbrowser runs** → all managed windows vanish; Superbrowser must drop them, show every tab as "no window", not crash, and re-adopt windows when Chrome relaunches. (Test: Task 7 `chromeQuitClearsWindows`.)
2. **User minimizes a window or puts it in full screen** → it's left where it is, never yanked back into the frame; clicking that profile's tab un-minimizes and raises it. (Tests: Task 5 `minimizedAndFullScreenNotMatched`, Task 7 `minimizedWindowIsRaisedNotSnapped`.)
3. **Profiles change in Chrome while running** (renamed, recolored, added, deleted) → bar updates; a deleted profile disappears from order/hidden lists without shifting into a wrong shortcut; a new profile is appended at the end. (Tests: Task 3 `orderDropsDeletedAndAppendsNew`, Task 7 `updateProfilesRefreshesBar`.)
4. **Superbrowser starts while windows of several profiles are already stacked at identical bounds** (normal after a restart) → no window is assigned to the wrong profile; ambiguous ones are fingerprinted with unique heights first. (Tests: Task 5 `identicalBoundsAreAmbiguous`, Task 7 `stackedWindowsAreFingerprintedThenSnapped`.)
5. **Shortcut for a slot with no profile** (Ctrl+9 with 7 visible profiles) or a hotkey the system refuses to register → nothing happens, no crash; a refused hotkey is listed in the menu. (Tests: Task 3 `slotOutOfRangeIsNil`, Task 7 `activateEmptySlotDoesNothing`; refusal surfaced in Task 11 manual check.)

---

## File Structure

```
Package.swift
Sources/SuperbrowserCore/          (pure logic, unit-tested)
  ChromeProfiles.swift             ChromeProfile, RGB, parseLocalState
  Settings.swift                   BarPosition, HotkeyModifier, Settings, SettingsStore, visibleProfiles, profile(forSlot:)
  FrameGeometry.swift              FrameLayout (split / frame(fromContent:) / clamp / AX↔Cocoa)
  ExtensionReport.swift            ExtensionReport, ReportedWindow, ReportedWindowKey
  HTTPMessage.swift                parseHTTPRequest, httpResponse
  WindowMatcher.swift              WindowID, AXWindowInfo, MatchResult, matchWindows, fingerprintFrames
  Switcher.swift                   SwitchAction, switchAction
  ShortcutConflicts.swift          desktopShortcutConflicts
  Coordinator.swift                WindowSystem, ChromeLaunching, BarModel, BarTab, Coordinator
Sources/Superbrowser/              (AppKit layer, manually verified)
  main.swift, AppDelegate.swift    wiring
  ReportServer.swift               NWListener HTTP server
  ChromeAX.swift                   WindowSystem over AX + observers
  ChromeLauncher.swift             ChromeLaunching via `open`
  BarPanel.swift                   the tab bar panel
  Hotkeys.swift                    Carbon global hotkeys
  StatusMenu.swift                 menu-bar settings menu
  SetupChecklist.swift             first-run checklist window
Tests/SuperbrowserCoreTests/       one test file per Core file
Extension/                         manifest.json, background.js, report.js, claim.js, test/report.test.mjs
scripts/build-app.sh               builds build/Superbrowser.app
```

---

### Task 1: Package skeleton and repo

**Files:**
- Create: `Package.swift`, `Sources/SuperbrowserCore/Version.swift`, `Sources/Superbrowser/main.swift`, `Tests/SuperbrowserCoreTests/VersionTests.swift`, `.gitignore`

**Interfaces:**
- Produces: library target `SuperbrowserCore`, executable target `Superbrowser` (depends on `SuperbrowserCore`), test target `SuperbrowserCoreTests`; `public let superbrowserVersion = "0.1.0"`.

- [ ] **Step 1:** `git init` in `/Users/linh/Documents/Projects/superbrowser`; `.gitignore` contains `.build/`, `build/`, `.DS_Store`.
- [ ] **Step 2: Write the failing test** — `@Test func versionIsSet() { #expect(superbrowserVersion == "0.1.0") }`
- [ ] **Step 3:** Run `swift test` — Expected: FAIL (package/symbol missing).
- [ ] **Step 4:** Write `Package.swift` (tools 6.0, platforms `.macOS(.v14)`, the three targets; executable links `AppKit`, `Carbon`, `Network`, `ServiceManagement`, `ApplicationServices` implicitly via imports), `Version.swift`, and a `main.swift` that just prints the version.
- [ ] **Step 5:** Run `swift test` — Expected: PASS. Run `swift build` — Expected: builds.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "chore: Swift package skeleton"` (the design doc and this plan are included in this first commit).

---

### Task 2: Helper extension + feasibility check

The riskiest assumptions are checked here, before any app code depends on them.

**Files:**
- Create: `Extension/manifest.json`, `Extension/report.js`, `Extension/background.js`, `Extension/claim.js`, `Extension/test/report.test.mjs`

**Interfaces:**
- Produces (HTTP contract, consumed by Tasks 4 and 8): `POST http://127.0.0.1:47321/report` with JSON
  `{"profileDir": "Profile 37", "extensionVersion": 1, "windows": [{"id": 123, "left": 0, "top": 25, "width": 1440, "height": 875, "focused": true, "state": "normal"}]}`
  `state` is one of `normal|maximized|minimized|fullscreen`. Only `type == "normal"` windows are included.
- Produces: `report.js` exports `buildReport(profileDir: string, windows: chrome.windows.Window[]) -> object` and `claimFromUrl(url: string) -> string | null`.

- [ ] **Step 1: Write the failing tests** in `Extension/test/report.test.mjs` (`node:test` + `node:assert`):
  - `buildReport keeps only normal windows`: input windows of types `normal`, `popup`, `devtools`, `app` → output `windows.length === 1`, and `profileDir`, `extensionVersion === 1` set.
  - `buildReport maps bounds fields`: `{id:7,type:"normal",left:10,top:20,width:300,height:400,focused:false,state:"maximized",tabs:[…]}` → exactly `{id:7,left:10,top:20,width:300,height:400,focused:false,state:"maximized"}` (no extra keys).
  - `claimFromUrl decodes profile dir`: `"http://127.0.0.1:47321/claim?dir=Profile%2037"` → `"Profile 37"`.
  - `claimFromUrl rejects other origins`: `"http://example.com/claim?dir=Default"` → `null`; `"http://127.0.0.1:47321/claim"` (no dir) → `null`.
- [ ] **Step 2:** Run `node --test Extension/test/` — Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `Extension/report.js` (ES module).
- [ ] **Step 4:** Run `node --test Extension/test/` — Expected: PASS.
- [ ] **Step 5:** Write `manifest.json` (MV3, name "Superbrowser Helper", version "1.0", `background.service_worker: "background.js"`, `"type": "module"`, permissions `["storage", "alarms"]`, host_permissions `["http://127.0.0.1:47321/*"]`, content script `claim.js` on `http://127.0.0.1:47321/claim*` at `document_start`), `background.js` and `claim.js`:
  - `background.js`: stored `profileDir` in `chrome.storage.local`; if unset, send nothing. Send a report (debounced 100 ms) on service-worker start, `runtime.onStartup`, `windows.onCreated/onRemoved/onBoundsChanged/onFocusChanged`, and `alarms` every 0.5 min, using `chrome.windows.getAll({windowTypes: ["normal"]})`. Fetch failures are swallowed (app may not be running).
  - `claim.js`: `chrome.runtime.sendMessage({type: "claim", dir: claimFromUrl(location.href)})` (inline the parse; content scripts can't import modules). Background stores `dir`, sends a report, then `chrome.tabs.remove(sender.tab.id)`.
- [ ] **Step 6: Manual feasibility check (the user runs this; record results in the commit message):**
  1. Run a throwaway listener: `python3 -c` one-liner HTTP server on `127.0.0.1:47321` that prints POST bodies and answers `/claim` with `200 ok`.
  2. In each of the 7 profiles: `chrome://extensions` → Developer mode → Load unpacked → `Extension/`. **Record whether the Linh HOU profile (`Profile 29`) allows it.**
  3. For each profile: `open -na "Google Chrome" --args --profile-directory="<dir>" "http://127.0.0.1:47321/claim?dir=<url-encoded dir>"` → tab closes itself and a report with that `profileDir` is printed.
  4. Run `osascript -e 'tell application "Google Chrome" to set bounds of front window to {100, 100, 1100, 801}'` → a report arrives whose window has `left 100, top 100, width 1000, height 701`. This confirms (a) programmatic resizes fire `onBoundsChanged`, (b) bounds are top-left global points.
  - If (2) fails for Profile 29: that profile is set as the fallback profile in Task 7 (`noExtensionProfiles = ["Profile 29"]`). If (4) fails: stop and report — the fingerprint approach in Tasks 5/7 needs rework.
- [ ] **Step 7:** Commit: `git add Extension && git commit -m "feat(extension): helper reports normal window bounds per profile"`

---

### Task 3: Chrome profiles + settings

**Files:**
- Create: `Sources/SuperbrowserCore/ChromeProfiles.swift`, `Sources/SuperbrowserCore/Settings.swift`
- Test: `Tests/SuperbrowserCoreTests/ChromeProfilesTests.swift`, `Tests/SuperbrowserCoreTests/SettingsTests.swift`

**Interfaces:**
- Produces:
  - `public struct RGB: Equatable, Codable, Sendable { public let r, g, b: UInt8 }`; `public init(argb: Int)`; `public static let fallbackGray = RGB(r: 128, g: 128, b: 128)`
  - `public struct ChromeProfile: Equatable, Sendable { public let dir: String; public let name: String; public let color: RGB }`
  - `public func parseLocalState(_ data: Data, existingDirs: Set<String>) throws -> [ChromeProfile]` — ordered by `profile.profiles_order`, then any remaining `info_cache` dirs sorted by name; color = `profile_color_seed` ?? `default_avatar_fill_color` ?? `.fallbackGray`.
  - `public enum BarPosition: String, Codable, CaseIterable, Sendable { case left, right, top, bottom }`
  - `public enum HotkeyModifier: String, Codable, CaseIterable, Sendable { case control, controlOption, controlCommand }`
  - `public struct Settings: Codable, Equatable, Sendable { barPosition = .top; frame: CGRect? = nil; profileOrder: [String] = []; hiddenProfiles: Set<String> = []; noExtensionProfiles: Set<String> = []; hotkeyModifier = .control; launchAtLogin = false; setupDone = false }`
  - `public struct SettingsStore { public init(url: URL); public func load() -> Settings /* defaults if missing or corrupt */; public func save(_ s: Settings) throws }`; `public static let defaultURL` = the Global Constraints path.
  - `public func visibleProfiles(_ all: [ChromeProfile], settings: Settings) -> [ChromeProfile]` — `settings.profileOrder` dirs that still exist, then profiles not in it (in `all` order), minus hidden.
  - `public func profile(forSlot slot: Int, in visible: [ChromeProfile]) -> ChromeProfile?` — slot is 1-based.

- [ ] **Step 1: Write the failing tests:**
  - `argbToRGB`: `RGB(argb: -16033840) == RGB(r: 11, g: 87, b: 208)`; `RGB(argb: -21696) == RGB(r: 255, g: 171, b: 64)`.
  - `parsesProfilesInChromeOrder`: fixture JSON with `profiles_order ["Default","Profile 29",".chrome","Profile 37"]`, info_cache for all four (Profile 37 has only `default_avatar_fill_color`), `existingDirs = ["Default","Profile 29","Profile 37"]` → dirs `["Default","Profile 29","Profile 37"]`, names copied verbatim (include `"Nguyễn Thị Thanh Nhã"` to pin UTF-8), Profile 37 color from fill color.
  - `missingColorIsGray`: profile with neither color key → `.fallbackGray`.
  - `orderDropsDeletedAndAppendsNew` (Review Focus 3): `profileOrder ["P3","P1","Gone"]`, all = `[P1,P2,P3]` → visible dirs `["P3","P1","P2"]`.
  - `hiddenProfilesExcluded`: hidden `["P1"]` → `P1` absent, slots shift (`profile(forSlot: 1)` is next visible).
  - `slotOutOfRangeIsNil` (Review Focus 5): 7 visible → `profile(forSlot: 9) == nil`, `profile(forSlot: 0) == nil`.
  - `settingsRoundTrip`: save then load in a temp dir equals original (including `frame` and sets).
  - `corruptSettingsLoadDefaults`: file containing `{oops` → `load() == Settings()`.
- [ ] **Step 2:** Run `swift test --filter "ChromeProfilesTests|SettingsTests"` — Expected: FAIL (symbols missing).
- [ ] **Step 3:** Implement both files (`JSONSerialization` for Local State since it's a large loosely-typed document; `Codable` for settings; `SettingsStore.save` creates the directory).
- [ ] **Step 4:** Run the same filter — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): Chrome profile list and settings`

---

### Task 4: Frame geometry, reports, HTTP parsing, shortcut conflicts

Small pure helpers the server and coordinator need.

**Files:**
- Create: `Sources/SuperbrowserCore/FrameGeometry.swift`, `ExtensionReport.swift`, `HTTPMessage.swift`, `ShortcutConflicts.swift`
- Test: matching `…Tests.swift` files

**Interfaces:**
- Produces:
  - `public enum FrameLayout { public static let barHeight: CGFloat = 32; public static let barWidth: CGFloat = 168 }`
    - `static func split(frame: CGRect, position: BarPosition) -> (bar: CGRect, content: CGRect)`
    - `static func frame(fromContent content: CGRect, position: BarPosition) -> CGRect` (inverse of `split`)
    - `static func clamp(_ frame: CGRect, into screens: [CGRect]) -> CGRect` — unchanged if fully inside a screen; otherwise uses the screen with the largest intersection (first screen if none), shrinks to fit, then shifts inside.
    - `static func cocoaRect(fromAX r: CGRect, primaryScreenHeight h: CGFloat) -> CGRect` and `axRect(fromCocoa:primaryScreenHeight:)` (both `y' = h - y - height`).
  - `public struct ReportedWindow: Codable, Equatable, Sendable { id: Int; left, top, width, height: Double; focused: Bool; state: String; var bounds: CGRect }`
  - `public struct ExtensionReport: Codable, Equatable, Sendable { profileDir: String; extensionVersion: Int; windows: [ReportedWindow] }`
  - `public struct ReportedWindowKey: Hashable, Sendable { profileDir: String; chromeId: Int }`
  - `public struct HTTPRequest: Equatable { method: String; path: String; query: [String: String]; body: Data }`
  - `public func parseHTTPRequest(_ data: Data) -> HTTPRequest?` — `nil` until headers and `Content-Length` bytes of body are complete.
  - `public func httpResponse(status: Int, contentType: String, body: Data) -> Data`
  - `public func desktopShortcutConflicts(symbolicHotKeys: [String: Any], modifier: HotkeyModifier) -> [Int]` — checks keys `"118"`…`"126"` (Switch to Desktop 1…9); conflict when `enabled == 1` and `value.parameters[2]` equals the modifier mask: control `262144`, controlOption `786432`, controlCommand `1310720`. Returns desktop numbers (1…9).

- [ ] **Step 1: Write the failing tests:**
  - `splitTop`: frame `(0,25,1440,875)`, `.top` → bar `(0,25,1440,32)`, content `(0,57,1440,843)`.
  - `splitLeftRightBottom`: same frame → `.left` bar `(0,25,168,875)` content `(168,25,1272,875)`; `.right` bar `(1272,25,168,875)` content `(0,25,1272,875)`; `.bottom` bar `(0,868,1440,32)` content `(0,25,1440,843)`.
  - `frameFromContentInvertsSplit`: for every `BarPosition`, `frame(fromContent: split(f).content) == f`.
  - `clampInsideUnchanged`, `clampOffscreenMovesToMainScreen`: frame `(3000,100,800,600)`, screens `[(0,25,1440,875)]` → `(640,100,800,600)`; `clampTooBigShrinks`: frame `(0,0,2000,1200)` → `(0,25,1440,875)`.
  - `axCocoaRoundTrip`: h = 900, `(10,20,300,400)` → cocoa `(10,480,300,400)` → back equal.
  - `decodesReport`: the Task 2 JSON example decodes; `bounds == CGRect(x:0,y:25,width:1440,height:875)`.
  - `httpParsesPostWithBody`, `httpIncompleteBodyIsNil`, `httpParsesClaimQuery` (`GET /claim?dir=Profile%2037` → `query["dir"] == "Profile 37"`).
  - `detectsEnabledDesktopShortcut`: dict with `"118": ["enabled": 1, "value": ["parameters": [65535, 18, 262144]]]` and `"119"` disabled → `[1]` for `.control`, `[]` for `.controlOption`.
- [ ] **Step 2:** Run `swift test` — Expected: new tests FAIL.
- [ ] **Step 3:** Implement the four files.
- [ ] **Step 4:** Run `swift test` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): frame geometry, report model, HTTP parsing, shortcut conflicts`

---

### Task 5: Window matcher

**Files:**
- Create: `Sources/SuperbrowserCore/WindowMatcher.swift`
- Test: `Tests/SuperbrowserCoreTests/WindowMatcherTests.swift`

**Interfaces:**
- Consumes: `ReportedWindowKey` (Task 4).
- Produces:
  - `public typealias WindowID = Int` (opaque token handed out by the `WindowSystem`)
  - `public struct AXWindowInfo: Equatable, Sendable { id: WindowID; frame: CGRect; title: String; isMinimized: Bool; isFullScreen: Bool }`
  - `public struct MatchResult: Equatable { assigned: [WindowID: ReportedWindowKey]; fallback: [WindowID: String /*profileDir*/]; ambiguous: [WindowID] }`
  - `public func matchWindows(unassigned: [AXWindowInfo], available: [ReportedWindowKey: CGRect], fallbackProfile: String?) -> MatchResult`
    - Minimized / full-screen AX windows are skipped entirely.
    - An AX window matches a reported window when all four edges are within 1 pt.
    - Exactly one candidate and that candidate matches no other AX window → `assigned`.
    - Two or more candidates, or a candidate shared by two AX windows → `ambiguous` (sorted by id).
    - Zero candidates → `fallback[id] = fallbackProfile` only if `fallbackProfile != nil`, every `available` window was assigned, and the frame is at least 700×500 (keeps sign-in popups out); otherwise ignored.
  - `public func fingerprintFrames(_ ids: [WindowID], content: CGRect) -> [WindowID: CGRect]` — the i-th id (0-based, in given order) gets `content` with `height - CGFloat(i + 1)`.

- [ ] **Step 1: Write the failing tests:**
  - `uniqueBoundsAssigned`: AX 1 at A, AX 2 at B; available `P1#10: A`, `P2#20: B` → assigned `{1: P1#10, 2: P2#20}`.
  - `toleranceOnePoint`: AX frame `A` shifted by 0.5 pt still matches; shifted by 2 pt does not.
  - `identicalBoundsAreAmbiguous` (Review Focus 4): AX 1 and 2 both at A; available `P1#10: A`, `P2#20: A` → `ambiguous == [1, 2]`, `assigned` empty.
  - `minimizedAndFullScreenNotMatched` (Review Focus 2): minimized AX window at A with available `P1#10: A` → not in any result field.
  - `fallbackOnlyWhenAllReportedAccounted`: AX 1 at A (matches P1#10), AX 2 at C 1000×700 unmatched, `fallbackProfile "Profile 29"` → `fallback == [2: "Profile 29"]`; with an extra unmatched available window → `fallback` empty.
  - `smallUnmatchedWindowNotAdopted`: unmatched 500×600 window → not in `fallback`.
  - `fingerprintHeightsUnique`: ids `[5, 9]`, content `(0,57,1440,843)` → `5: height 842`, `9: height 841`, same x/y/width.
- [ ] **Step 2:** Run `swift test --filter WindowMatcherTests` — Expected: FAIL.
- [ ] **Step 3:** Implement `WindowMatcher.swift`.
- [ ] **Step 4:** Run the same filter — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): match AX windows to profiles by bounds`

---

### Task 6: Switcher rules

**Files:**
- Create: `Sources/SuperbrowserCore/Switcher.swift`
- Test: `Tests/SuperbrowserCoreTests/SwitcherTests.swift`

**Interfaces:**
- Consumes: `WindowID` (Task 5).
- Produces:
  - `public enum SwitchAction: Equatable { case raise(WindowID), openNewWindow(profileDir: String), none }`
  - `public func switchAction(profileDir: String, windows: [WindowID] /* profile's managed windows, most-recently-front first */, front: WindowID?) -> SwitchAction`
    - no windows → `.openNewWindow`; front not one of them → `.raise(windows[0])`; front is one of them and there are ≥2 → `.raise(` the next after front, wrapping `)`; front is its only window → `.none`.

- [ ] **Step 1: Write the failing tests:** `noWindowsOpensNew`, `otherProfileFrontRaisesMostRecent` (`[4,7]`, front 9 → `.raise(4)`), `cyclesWithinProfile` (`[4,7,8]`, front 7 → `.raise(8)`; front 8 → `.raise(4)`), `singleFrontWindowIsNone`.
- [ ] **Step 2:** Run `swift test --filter SwitcherTests` — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): profile switching rules`

---

### Task 7: Coordinator

The brain: owns state and turns events into window moves, raises, launches and bar updates.

**Files:**
- Create: `Sources/SuperbrowserCore/Coordinator.swift`
- Test: `Tests/SuperbrowserCoreTests/CoordinatorTests.swift` (with `FakeWindowSystem`, `FakeLauncher` defined in the test file)

**Interfaces:**
- Consumes: everything from Tasks 3–6.
- Produces:
  ```swift
  @MainActor public protocol WindowSystem: AnyObject {
      func chromeWindows() -> [AXWindowInfo]          // current standard Chrome windows
      func setFrame(_ id: WindowID, _ rect: CGRect)    // AX coords
      func raise(_ id: WindowID)                       // un-minimize, raise, activate Chrome
  }
  @MainActor public protocol ChromeLaunching: AnyObject {
      func openWindow(profileDir: String)
      func openClaim(profileDir: String)
  }
  public struct BarTab: Equatable, Sendable { profileDir: String; name: String; color: RGB; slot: Int?; isActive: Bool; windowCount: Int; isLinked: Bool }
  public struct BarModel: Equatable, Sendable { position: BarPosition; barRect: CGRect; tabs: [BarTab] }

  @MainActor public final class Coordinator {
      public init(windows: WindowSystem, launcher: ChromeLaunching, store: SettingsStore,
                  profiles: [ChromeProfile], screens: [CGRect])
      public var onBarChange: ((BarModel) -> Void)?
      public private(set) var settings: Settings
      public func receive(_ report: ExtensionReport)
      public func windowsChanged()
      public func windowMoved(_ id: WindowID, to rect: CGRect)
      public func frontWindowChanged(_ id: WindowID?)
      public func activate(slot: Int)
      public func activate(profileDir: String)
      public func linkUnlinkedProfiles()                         // openClaim for profiles with no report yet and not in noExtensionProfiles
      public func updateProfiles(_ profiles: [ChromeProfile])
      public func updateSettings(_ change: (inout Settings) -> Void)   // saves + re-snaps + bar update
      public func screensChanged(_ screens: [CGRect])
  }
  ```
- Behavior to implement (each pinned by a test below):
  - Frame = `settings.frame` ?? `screens[0]`, clamped; content rect from `FrameLayout.split`. Frame changes are saved to settings.
  - `windowsChanged` / `receive`: drop windows that no longer exist (from either side); run `matchWindows` on unassigned windows with `fallbackProfile` = the single entry of `noExtensionProfiles` (nil if 0 or ≥2); ignore reports whose `profileDir` is unknown or hidden, and windows of hidden profiles; `setFrame` each ambiguous window to its `fingerprintFrames` rect and wait for the next report; snap every newly assigned (non-minimized, non-full-screen) window to the content rect.
  - Own moves: remember the rect passed to `setFrame`; a `windowMoved` within 2 pt of it is ignored.
  - `windowMoved` of a managed window by the user → that rect becomes the new content rect; frame recomputed, other managed windows snapped, bar updated (the front window leads; no fight).
  - `activate(slot:)` maps through `visibleProfiles`/`profile(forSlot:)`; empty slot → no-op. `activate(profileDir:)` executes `switchAction` (MRU order maintained from `frontWindowChanged`).
  - Bar tab `isActive` = the profile owning the front window; `slot` = 1…9 position or nil beyond 9; `isLinked` = a report was received or the dir is in `noExtensionProfiles`.

- [ ] **Step 1: Write the failing tests** (fakes record calls; frame `(0,25,1440,875)`, `.top`, so content `C = (0,57,1440,843)`):
  - `newWindowIsMatchedAndSnapped`: fake has AX 1 at `(100,100,1000,700)`; `receive` report P1 window 10 at same bounds → `setFrame(1, C)` recorded; bar tab P1 `windowCount == 1`.
  - `stackedWindowsAreFingerprintedThenSnapped` (Review Focus 4): AX 1 and 2 at `C`; reports P1#10 at `C`, P2#20 at `C` → `setFrame(1, C with height 842)` and `setFrame(2, height 841)`; then reports P1#10 at height 842, P2#20 at 841 (and fake frames updated) → both assigned correctly and snapped back to `C`.
  - `ownMoveIgnored`: after a snap, `windowMoved(1, C)` → no other `setFrame` calls.
  - `userMoveMovesEverything`: P1 window 1 and P2 window 2 managed; `windowMoved(1, (200,100,1000,700))` → `setFrame(2, (200,100,1000,700))`, saved `settings.frame == (200,68,1000,732)`, bar rect `(200,68,1000,32)`.
  - `activateOpensNewWindowWhenNone`: no windows for P2 → `launcher.openWindow("P2")`.
  - `activateCyclesProfileWindows`: P1 has windows 1, 3; front 1 → `raise(3)`.
  - `activateEmptySlotDoesNothing` (Review Focus 5): 2 visible profiles, `activate(slot: 9)` → no raise, no launch.
  - `minimizedWindowIsRaisedNotSnapped` (Review Focus 2): P1's only window minimized → never `setFrame`d; `activate(profileDir: "P1")` → `raise(1)`.
  - `chromeQuitClearsWindows` (Review Focus 1): managed windows exist; fake returns `[]`; `windowsChanged()` → all tabs `windowCount == 0`, no `setFrame` calls; later new AX window + report → adopted again.
  - `hiddenProfileWindowsUnmanaged`: P2 hidden; P2 report + matching AX window → no `setFrame`, no P2 tab.
  - `fallbackProfileAdoptsUnmatchedWindow`: `noExtensionProfiles = ["Profile 29"]`; all reported windows assigned; extra 1000×700 AX window → snapped and counted under Profile 29.
  - `updateProfilesRefreshesBar` (Review Focus 3): rename P1 → bar tab name changes; delete P2 → its tab gone, P3 now `slot 2`.
  - `screensChangedClampsFrame`: frame `(3000,100,800,600)` after `screensChanged([(0,25,1440,875)])` → frame `(640,100,800,600)` and managed windows re-snapped.
  - `linkOpensClaimOnlyForUnlinked`: P1 reported, P2 not, P3 in `noExtensionProfiles` → `openClaim` called only for P2.
- [ ] **Step 2:** Run `swift test --filter CoordinatorTests` — Expected: FAIL.
- [ ] **Step 3:** Implement `Coordinator.swift`.
- [ ] **Step 4:** Run `swift test` (whole suite) — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): coordinator wiring matcher, switcher and frame`

---

### Task 8: Report server and Chrome launcher (app layer)

**Files:**
- Create: `Sources/Superbrowser/ReportServer.swift`, `Sources/Superbrowser/ChromeLauncher.swift`

**Interfaces:**
- Consumes: `parseHTTPRequest`, `httpResponse`, `ExtensionReport`, `ChromeLaunching`.
- Produces:
  - `final class ReportServer { init(port: UInt16 = 47321, onReport: @MainActor @escaping (ExtensionReport) -> Void, profileName: @MainActor @escaping (String) -> String?); func start() throws; func stop() }` — `NWListener` with `requiredLocalEndpoint` / `acceptLocalOnly` on `127.0.0.1`; `POST /report` → decode, call `onReport` on main actor, reply `204`; `GET /claim?dir=` → `200 text/html` page "Linking <profile name> to Superbrowser… If this tab stays open, the Superbrowser Helper extension isn't installed in this profile."; anything else `404`; bad JSON `400`.
  - `final class ChromeLauncher: ChromeLaunching` — runs `/usr/bin/open -na "Google Chrome" --args --profile-directory=<dir>` (plus the claim URL `http://127.0.0.1:47321/claim?dir=<percent-encoded dir>` for `openClaim`) via `Process`.

- [ ] **Step 1:** Implement both files; in `main.swift` temporarily start the server and print each received report.
- [ ] **Step 2: Manual check:** `swift run Superbrowser`; with the Task 2 extension loaded, run `open -na "Google Chrome" --args --profile-directory="Profile 37" "http://127.0.0.1:47321/claim?dir=Profile%2037"` → tab closes, report for `Profile 37` printed. `curl -s -o /dev/null -w '%{http_code}' -X POST --data '{oops' http://127.0.0.1:47321/report` → `400`. `lsof -iTCP:47321 -sTCP:LISTEN` shows it bound to `127.0.0.1` only.
- [ ] **Step 3:** Commit: `feat(app): local report server and Chrome launcher`

---

### Task 9: Chrome windows via Accessibility

**Files:**
- Create: `Sources/Superbrowser/ChromeAX.swift`

**Interfaces:**
- Consumes: `WindowSystem`, `AXWindowInfo`, `WindowID`.
- Produces: `@MainActor final class ChromeAX: WindowSystem` with
  - `var onWindowsChanged: (() -> Void)?`, `var onWindowMoved: ((WindowID, CGRect) -> Void)?`, `var onFrontWindowChanged: ((WindowID?) -> Void)?`, `var onChromeActiveChanged: ((Bool) -> Void)?`
  - `func start()` — attaches to the running Chrome (`NSRunningApplication` with bundle id `com.google.Chrome`), re-attaches on launch/terminate via `NSWorkspace` notifications (terminate → `onWindowsChanged`).
- Approach: keep a registry `[WindowID: AXUIElement]` (new elements compared with `CFEqual` against the registry; ids increase monotonically). `chromeWindows()` returns windows with subrole `AXStandardWindow`, reading `AXPosition`, `AXSize`, `AXTitle`, `AXMinimized`, `AXFullScreen`. `setFrame` sets `AXPosition` then `AXSize` then `AXPosition` again (Chrome clamps size against the old position). `raise` sets `AXMinimized=false`, performs `kAXRaiseAction`, sets the app's `AXMainWindow`/`AXFocusedWindow`, and `activate()`s Chrome (macOS switches to Chrome's desktop). Observers: app-level `kAXWindowCreatedNotification`, `kAXFocusedWindowChangedNotification`, `kAXMainWindowChangedNotification`; per-window `kAXMovedNotification`, `kAXResizedNotification` (coalesced, 150 ms debounce → `onWindowMoved`), `kAXUIElementDestroyedNotification` → `onWindowsChanged`. If `AXIsProcessTrusted()` is false, `chromeWindows()` returns `[]`.

- [ ] **Step 1:** Implement `ChromeAX.swift`; temporarily wire it in `main.swift` to log windows and events.
- [ ] **Step 2: Manual check** (grant Accessibility to the terminal running `swift run` for now): with 2 Chrome windows open, the log lists both with correct frames; moving one logs a single debounced move; closing one logs a change; minimizing one shows `isMinimized`; a sign-in popup (e.g. "Sign in with Google" on any site) appears in the list but will later go unmatched; quitting Chrome logs an empty list.
- [ ] **Step 3:** Commit: `feat(app): Chrome window access via Accessibility`

---

### Task 10: Tab bar panel

**Files:**
- Create: `Sources/Superbrowser/BarPanel.swift`

**Interfaces:**
- Consumes: `BarModel`, `BarTab`, `FrameLayout.cocoaRect(fromAX:primaryScreenHeight:)`.
- Produces: `@MainActor final class BarPanel { init(onSelect: @escaping (String /*profileDir*/) -> Void); func apply(_ model: BarModel); func setChromeActive(_ active: Bool) }`
- Approach: borderless `NSPanel` with `.nonactivatingPanel` (clicks don't steal focus from Chrome), default collection behavior (stays on the browser desktop), `hidesOnDeactivate = false`. `setChromeActive(true)` → `.floating` level; `false` → `.normal`. `apply` converts `barRect` to Cocoa coordinates, sets the frame, and lays tabs out in an `NSStackView` (horizontal for top/bottom, vertical for left/right). Each tab: color stripe in the profile color, name (truncated tail), shortcut hint like `⌃1` / `⌃⌥1` / `⌃⌘1` when `slot != nil`, a `×2` badge when `windowCount > 1`, dimmed when `windowCount == 0`, a small "!" with tooltip "Helper extension not linked" when `!isLinked`. Active tab: background in the profile color at 25% alpha, bold name. Click → `onSelect(profileDir)`. Follows light/dark mode via system colors.

- [ ] **Step 1:** Implement `BarPanel.swift`; in `main.swift` temporarily show it with a hard-coded 3-tab `BarModel` for each of the four positions (cycle every 2 s).
- [ ] **Step 2: Manual check:** bar renders on the correct side of the frame rect for all four positions, tabs readable with Vietnamese names, clicking a tab prints its `profileDir` and does not deactivate the frontmost app.
- [ ] **Step 3:** Commit: `feat(app): profile tab bar`

---

### Task 11: Hotkeys, menu, setup checklist, wiring

**Files:**
- Create: `Sources/Superbrowser/Hotkeys.swift`, `StatusMenu.swift`, `SetupChecklist.swift`, `AppDelegate.swift`
- Modify: `Sources/Superbrowser/main.swift` (now only starts `NSApplication` with `AppDelegate`)

**Interfaces:**
- Consumes: all Core types, `ReportServer`, `ChromeLauncher`, `ChromeAX`, `BarPanel`.
- Produces:
  - `@MainActor final class Hotkeys { init(onSlot: @escaping (Int) -> Void); func register(modifier: HotkeyModifier) -> [Int] /* slots that failed to register */ }` — Carbon `RegisterEventHotKey` for key codes 1…9 = `18, 19, 20, 21, 23, 22, 26, 28, 25` with `controlKey` (+ `optionKey` / `cmdKey`); re-registering unregisters the old set first.
  - `StatusMenu` (an `NSStatusItem`, SF Symbol `rectangle.stack`) with: **Bar Position** ▸ Left / Right / Top / Bottom (checkmark current); **Profiles** ▸ one item per profile (name + color dot) ▸ Show on bar (toggle), Move Up, Move Down, "Helper extension blocked — use fallback" (toggle `noExtensionProfiles`); **Shortcut Keys** ▸ ⌃ / ⌃⌥ / ⌃⌘, plus a disabled warning line when `desktopShortcutConflicts` (read via `CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString, "com.apple.symbolichotkeys" as CFString)`) is non-empty or any slot failed to register; **Link Profiles…** (`coordinator.linkUnlinkedProfiles()`); **Setup Checklist…**; **Launch at Login** (toggle via `SMAppService.mainApp`); **Quit Superbrowser**.
  - `SetupChecklist` window with live rows: (1) Accessibility permission — ✓/✗ + "Open Settings" (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`); (2) Helper extension linked — "n of m profiles", lists unlinked names, "Link Profiles" button; (3) "Assign Chrome to one desktop: right-click Chrome in the Dock → Options → Assign To → This Desktop" + "Done" checkbox; (4) "Quit and reopen Chrome so its windows gather on that desktop" + "Quit Chrome" button; (5) Bar position picker. Closing it sets `setupDone = true`. Shown at launch while `setupDone == false`.
  - `AppDelegate` wiring: read `Local State` (re-read on `NSApplication.didBecomeActive` and every time Chrome activates); build `Coordinator`; `coordinator.onBarChange → barPanel.apply`; `ChromeAX` callbacks → coordinator; `onChromeActiveChanged → barPanel.setChromeActive`; `ReportServer.onReport → coordinator.receive`; `Hotkeys.onSlot → coordinator.activate(slot:)`; `NSApplication.didChangeScreenParametersNotification → coordinator.screensChanged` (screens = each `NSScreen.visibleFrame` converted to AX coords).

- [ ] **Step 1:** Implement the four files.
- [ ] **Step 2:** Run `swift build` — Expected: builds with no warnings about Sendable/actor isolation left unresolved.
- [ ] **Step 3:** Run `swift test` — Expected: PASS (Core unchanged).
- [ ] **Step 4:** Commit: `feat(app): hotkeys, settings menu, setup checklist, wiring`

---

### Task 12: App bundle + end-to-end check

**Files:**
- Create: `scripts/build-app.sh`, `README.md`

**Interfaces:**
- Produces: `scripts/build-app.sh [--install]` → `swift build -c release`, assembles `build/Superbrowser.app` (`Contents/MacOS/Superbrowser`, `Contents/Info.plist` with `CFBundleIdentifier dev.superbrowser.app`, `CFBundleName Superbrowser`, `CFBundleExecutable Superbrowser`, `CFBundleShortVersionString 0.1.0`, `LSUIElement true`, `LSMinimumSystemVersion 14.0`), ad-hoc signs with `codesign --force --sign - build/Superbrowser.app`; `--install` copies it to `~/Applications/` and prints: "If Accessibility stopped working after a rebuild, run: tccutil reset Accessibility dev.superbrowser.app, then re-grant."
- README: what it is, build/install, loading the extension in each profile, the setup checklist steps, the shortcut table, known limits (no full-screen, popups/DevTools/web apps left alone, HOU fallback).

- [ ] **Step 1:** Write the script and README; run `scripts/build-app.sh --install` — Expected: `~/Applications/Superbrowser.app` exists; `codesign -dv ~/Applications/Superbrowser.app` shows `Signature=adhoc`.
- [ ] **Step 2: End-to-end manual check with the user** (each line passes or is fixed before finishing):
  1. First launch shows the checklist; complete all five rows; every profile shows linked (except a fallback profile).
  2. Chrome windows of all profiles stack in one frame on the browser desktop; the bar shows 7 tabs in Chrome's profile colors.
  3. Click each tab → that profile's window in front, nothing appears to move; active tab highlighted.
  4. From another desktop press ⌃3 → macOS swipes to the browser desktop with profile 3 in front.
  5. Profile with no window: click its tab → a new window opens inside the frame.
  6. Profile with two windows: pressing its shortcut twice cycles them; tab shows ×2.
  7. Drag the front Chrome window → all windows and the bar follow; restart Superbrowser → frame restored.
  8. Switch bar position through all four sides via the menu → layout correct each time.
  9. Sign in to a Google service via a popup and use the password manager → popup is not pulled into the frame; both work normally.
  10. Minimize a window → it stays minimized; clicking its tab restores it in the frame.
  11. Quit Chrome → tabs dim; reopen → windows re-adopted.
  12. Hide a profile → tab disappears, its windows are left alone; shortcuts renumber.
- [ ] **Step 3:** Commit: `chore: app bundle script and README`

## Deviations during execution

- **Chrome quit signal:** `Coordinator.chromeTerminated()` (fired by `ChromeAX` when the attached Chrome process exits) replaces "an empty window list means Chrome quit" — an empty AX list also happens when Chrome's windows are on another Space, so it no longer clears reports.
- **Fingerprinting:** heights step by 4 pt (not 1 pt) so a fingerprinted window matches only its own report within the 1 pt tolerance, and windows are fingerprinted in place (own origin and width, only the height changes) instead of being moved into the content rect. Heights still waiting for a report at the same origin/width are not reused.
- **`BarModel.modifier`:** the bar model carries the hotkey modifier so tab hints show the right keys and the app re-registers hotkeys when it changes.
- **Local server gate and claim nonce:** `POST /report` and `POST /claim/confirm` require `Content-Type: application/json` and, when an `Origin` header is present, a `chrome-extension://` origin. Linking uses a one-time nonce (`ClaimRegistry`, 5 min lifetime): the app opens `/claim?nonce=<n>`, the extension trades it via `POST /claim/confirm` for `{"profileDir": …}` and never takes a profile dir from the URL.
- **Fallback adoption rules:** the no-extension fallback profile adopts an unmatched standard window (≥ 700×500) only if it is not DevTools, every other visible profile has reported at least once (linked profiles are persisted in `Settings.linkedProfiles`), and the window first appeared within 10 s after Superbrowser opened or raised a window of the fallback profile.
- **Bar re-homing:** the bar panel is re-shown on Chrome's desktop when Chrome becomes active or the active Space changes, so it doesn't stay on the desktop it was first shown on.
- **`movedProfileOrder`:** Move Up/Down reorders against the nearest visible neighbour while hidden profiles keep their places (a Core helper instead of reordering the visible list only).
- **Also added in the final fix wave:** switching ignores Chrome's front window while Chrome isn't active; user moves are clamped to the screens (one leader correction per move); windows restored from the Dock or full screen are re-snapped; without Accessibility trust, tabs/hotkeys show the checklist; an empty profile list is ignored while profiles were known; `Settings` decodes missing fields with defaults.
