import Foundation
import CoreGraphics
import Testing
@testable import SuperbrowserCore

// MARK: - Fakes

@MainActor
final class FakeWindowSystem: WindowSystem {
    var windows: [WindowID: AXWindowInfo] = [:]
    var setFrameCalls: [(id: WindowID, rect: CGRect)] = []
    var raised: [WindowID] = []

    func add(_ id: WindowID, _ rect: CGRect, minimized: Bool = false, fullScreen: Bool = false, title: String? = nil) {
        windows[id] = AXWindowInfo(id: id, frame: rect, title: title ?? "w\(id)", isMinimized: minimized, isFullScreen: fullScreen)
    }

    func chromeWindows() -> [AXWindowInfo] { windows.values.sorted { $0.id < $1.id } }

    func setFrame(_ id: WindowID, _ rect: CGRect) {
        setFrameCalls.append((id, rect))
        windows[id]?.frame = rect
    }

    func raise(_ id: WindowID) { raised.append(id) }

    func didSet(_ id: WindowID, _ rect: CGRect) -> Bool {
        setFrameCalls.contains { $0.id == id && $0.rect == rect }
    }
}

@MainActor
final class FakeLauncher: ChromeLaunching {
    var opened: [String] = []
    var claimed: [String] = []
    func openWindow(profileDir: String) { opened.append(profileDir) }
    func openClaim(profileDir: String) { claimed.append(profileDir) }
}

@MainActor
final class TestClock {
    var now = Date(timeIntervalSinceReferenceDate: 0)
    func advance(_ seconds: TimeInterval) { now += seconds }
}

// MARK: - Helpers

private let screen = CGRect(x: 0, y: 25, width: 1440, height: 875)
private let C = CGRect(x: 0, y: 57, width: 1440, height: 843)
private let A = CGRect(x: 100, y: 100, width: 1000, height: 700)
private let B = CGRect(x: 120, y: 120, width: 1000, height: 700)

private func prof(_ dir: String, _ name: String? = nil) -> ChromeProfile {
    ChromeProfile(dir: dir, name: name ?? dir, color: RGB(r: 1, g: 2, b: 3))
}

private func report(_ dir: String, _ windows: [(Int, CGRect)], state: String = "normal") -> ExtensionReport {
    ExtensionReport(profileDir: dir, extensionVersion: 1, windows: windows.map { id, r in
        ReportedWindow(id: id, left: r.minX, top: r.minY, width: r.width, height: r.height, focused: false, state: state)
    })
}

private func withHeight(_ r: CGRect, _ h: CGFloat) -> CGRect {
    var o = r; o.size.height = h; return o
}

@MainActor
private struct Harness {
    let ws = FakeWindowSystem()
    let launcher = FakeLauncher()
    let clock = TestClock()
    let store: SettingsStore
    let coordinator: Coordinator

    init(profiles: [ChromeProfile] = [prof("P1"), prof("P2"), prof("P3")],
         screens: [CGRect] = [screen],
         configure: (inout Settings) -> Void = { _ in },
         windows setup: (FakeWindowSystem) -> Void) {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("superbrowser-tests-\(UUID().uuidString)/settings.json")
        store = SettingsStore(url: url)
        var s = Settings()
        s.barPosition = .top
        s.frame = screen
        configure(&s)
        try! store.save(s)
        setup(ws)
        let clock = self.clock
        coordinator = Coordinator(windows: ws, launcher: launcher, store: store, profiles: profiles, screens: screens,
                                  now: { clock.now })
    }

    func tab(_ dir: String) -> BarTab? { coordinator.barModel.tabs.first { $0.profileDir == dir } }
}

// MARK: - Tests

@MainActor
struct CoordinatorTests {
    @Test func newWindowIsMatchedAndSnapped() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(h.ws.didSet(1, C))
        #expect(h.tab("P1")?.windowCount == 1)
    }

    @Test func stackedWindowsAreFingerprintedThenSnapped() {
        let h = Harness { $0.add(1, C); $0.add(2, C) }
        h.coordinator.receive(report("P1", [(10, C)]))
        h.coordinator.receive(report("P2", [(20, C)]))
        #expect(h.ws.didSet(1, withHeight(C, 839)))
        #expect(h.ws.didSet(2, withHeight(C, 835)))
        // Nothing is assigned while the stack is ambiguous.
        #expect(h.tab("P1")?.windowCount == 0)
        #expect(h.tab("P2")?.windowCount == 0)

        h.ws.setFrameCalls = []
        h.coordinator.receive(report("P1", [(10, withHeight(C, 839))]))
        h.coordinator.receive(report("P2", [(20, withHeight(C, 835))]))
        #expect(h.coordinator.owner(of: 1) == "P1")
        #expect(h.coordinator.owner(of: 2) == "P2")
        #expect(h.ws.didSet(1, C))
        #expect(h.ws.didSet(2, C))
        #expect(h.tab("P1")?.windowCount == 1)
        #expect(h.tab("P2")?.windowCount == 1)
    }

    @Test func ownMoveIgnored() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        #expect(h.ws.didSet(1, C) && h.ws.didSet(2, C))
        h.ws.setFrameCalls = []
        h.coordinator.windowMoved(1, to: C.offsetBy(dx: 1.5, dy: -1.5))
        #expect(h.ws.setFrameCalls.isEmpty)
        #expect(h.coordinator.settings.frame == screen)
    }

    @Test func userMoveMovesEverything() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        var bars: [BarModel] = []
        h.coordinator.onBarChange = { bars.append($0) }
        h.ws.setFrameCalls = []

        let moved = CGRect(x: 200, y: 100, width: 1000, height: 700)
        h.ws.windows[1]?.frame = moved
        h.coordinator.windowMoved(1, to: moved)

        #expect(h.ws.didSet(2, moved))
        #expect(!h.ws.setFrameCalls.contains { $0.id == 1 })
        let expectedFrame = CGRect(x: 200, y: 68, width: 1000, height: 732)
        #expect(h.coordinator.settings.frame == expectedFrame)
        #expect(h.store.load().frame == expectedFrame)
        #expect(h.coordinator.barModel.barRect == CGRect(x: 200, y: 68, width: 1000, height: 32))
        #expect(bars.last?.barRect == CGRect(x: 200, y: 68, width: 1000, height: 32))
    }

    @Test func zoomedWindowKeepsBarOnScreen() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        h.ws.setFrameCalls = []

        // The user zooms window 1 to fill the screen: the bar would end up above the screen's top.
        h.ws.windows[1]?.frame = screen
        h.coordinator.windowMoved(1, to: screen)
        #expect(h.coordinator.settings.frame == screen)
        #expect(h.coordinator.barModel.barRect == CGRect(x: 0, y: 25, width: 1440, height: 32))
        #expect(h.ws.didSet(1, C))                      // the leader is snapped below the bar
        #expect(!h.ws.setFrameCalls.contains { $0.id == 2 })
    }

    @Test func ownCorrectionDoesNotLoop() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        h.ws.windows[1]?.frame = screen
        h.coordinator.windowMoved(1, to: screen)
        #expect(h.ws.didSet(1, C))
        h.ws.setFrameCalls = []

        // Our correction landing is an own move.
        h.coordinator.windowMoved(1, to: C)
        #expect(h.ws.setFrameCalls.isEmpty)

        // Chrome didn't honour the correction: one correction per user move, no second attempt.
        h.ws.windows[1]?.frame = screen
        h.coordinator.windowMoved(1, to: screen)
        #expect(h.ws.setFrameCalls.isEmpty)
        #expect(h.coordinator.settings.frame == screen)

        // A later user move and zoom is corrected again.
        h.clock.advance(5)
        h.ws.windows[1]?.frame = A
        h.coordinator.windowMoved(1, to: A)
        h.ws.windows[1]?.frame = screen
        h.coordinator.windowMoved(1, to: screen)
        #expect(h.ws.didSet(1, C))
    }

    @Test func activateOpensNewWindowWhenNone() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.activate(profileDir: "P2")
        #expect(h.launcher.opened == ["P2"])
        #expect(h.ws.raised.isEmpty)
    }

    @Test func activateCyclesProfileWindows() {
        let h = Harness { $0.add(1, A); $0.add(3, B) }
        h.coordinator.receive(report("P1", [(10, A), (30, B)]))
        h.coordinator.frontWindowChanged(1)
        #expect(h.tab("P1")?.isActive == true)
        #expect(h.tab("P2")?.isActive == false)
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.raised == [3])
    }

    @Test func inactiveChromeRaisesFrontProfileWindow() {
        // From another app, the shortcut of the profile whose window Chrome has in front brings it back.
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.frontWindowChanged(1)
        h.coordinator.chromeActiveChanged(false)
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.raised == [1])
    }

    @Test func inactiveChromeRaisesMostRecentNotNext() {
        let h = Harness { $0.add(1, A); $0.add(3, B) }
        h.coordinator.receive(report("P1", [(10, A), (30, B)]))
        h.coordinator.frontWindowChanged(3)
        h.coordinator.frontWindowChanged(1)
        h.coordinator.chromeActiveChanged(false)
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.raised == [1])

        // Back in Chrome, the same shortcut cycles again.
        h.coordinator.chromeActiveChanged(true)
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.raised == [1, 3])
    }

    @Test func activateEmptySlotDoesNothing() {
        let h = Harness(profiles: [prof("P1"), prof("P2")]) { _ in }
        h.coordinator.activate(slot: 9)
        #expect(h.ws.raised.isEmpty)
        #expect(h.launcher.opened.isEmpty)
        h.coordinator.activate(slot: 2)
        #expect(h.launcher.opened == ["P2"])
    }

    @Test func minimizedWindowIsRaisedNotSnapped() {
        let h = Harness { $0.add(1, C) }
        h.coordinator.receive(report("P1", [(10, C)]))
        #expect(h.coordinator.owner(of: 1) == "P1")

        h.ws.add(1, C, minimized: true)
        h.coordinator.receive(report("P1", [(10, C)], state: "minimized"))
        h.coordinator.windowsChanged()
        // A frame change re-snaps managed windows, but must leave the minimized one alone.
        h.coordinator.screensChanged([CGRect(x: 0, y: 0, width: 1280, height: 800)])

        #expect(!h.ws.setFrameCalls.contains { $0.id == 1 })
        #expect(h.tab("P1")?.windowCount == 1)
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.raised == [1])
    }

    @Test func restoredWindowIsSnapped() {
        let h = Harness { $0.add(1, A); $0.add(2, B); $0.add(3, A.offsetBy(dx: 50, dy: 50)) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        h.ws.add(1, C, minimized: true)
        h.coordinator.receive(report("P1", [(10, C)], state: "minimized"))
        h.ws.setFrameCalls = []

        // The user drags the frame elsewhere while window 1 is minimized.
        let moved = CGRect(x: 200, y: 100, width: 1000, height: 700)
        h.ws.windows[2]?.frame = moved
        h.coordinator.windowMoved(2, to: moved)
        #expect(!h.ws.setFrameCalls.contains { $0.id == 1 })

        // Window 1 comes back where it was (the extension hasn't reported the restore yet).
        h.ws.add(1, C)
        h.coordinator.windowRestored(1)
        #expect(h.ws.didSet(1, moved))

        // An unmanaged window is left alone.
        h.coordinator.windowRestored(3)
        #expect(!h.ws.setFrameCalls.contains { $0.id == 3 })
    }

    @Test func activateSnapsOutOfFrameWindow() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(h.ws.didSet(1, C))
        h.ws.windows[1]?.frame = A                       // left the frame without a move we heard about
        h.ws.setFrameCalls = []
        h.coordinator.activate(profileDir: "P1")
        #expect(h.ws.didSet(1, C))
        #expect(h.ws.raised == [1])
    }

    @Test func chromeQuitClearsWindows() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        #expect(h.tab("P1")?.windowCount == 1)
        h.ws.setFrameCalls = []

        h.ws.windows = [:]
        h.coordinator.chromeTerminated()
        h.coordinator.windowsChanged()
        #expect(h.coordinator.barModel.tabs.allSatisfy { $0.windowCount == 0 })
        #expect(h.ws.setFrameCalls.isEmpty)

        h.ws.add(5, A)
        h.coordinator.receive(report("P1", [(11, A)]))
        #expect(h.ws.didSet(5, C))
        #expect(h.tab("P1")?.windowCount == 1)
    }

    @Test func hiddenProfileWindowsUnmanaged() {
        let h = Harness(configure: { $0.hiddenProfiles = ["P2"]; $0.noExtensionProfiles = ["P3"] }) { $0.add(2, A) }
        h.coordinator.receive(report("P2", [(20, A)]))
        h.coordinator.windowsChanged()
        #expect(h.ws.setFrameCalls.isEmpty)
        #expect(h.tab("P2") == nil)
        #expect(h.tab("P3")?.windowCount == 0)
    }

    @Test func fallbackProfileAdoptsUnmatchedWindow() {
        let h = Harness(profiles: [prof("P1"), prof("Profile 29")],
                        configure: { $0.noExtensionProfiles = ["Profile 29"] }) { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.clock.advance(1)
        h.coordinator.activate(profileDir: "Profile 29")
        #expect(h.launcher.opened == ["Profile 29"])

        h.clock.advance(2)                               // the window Superbrowser asked for opens
        h.ws.add(2, CGRect(x: 300, y: 200, width: 1000, height: 700))
        h.coordinator.windowsChanged()
        #expect(h.ws.didSet(1, C))
        #expect(h.ws.didSet(2, C))
        #expect(h.coordinator.owner(of: 2) == "Profile 29")
        #expect(h.tab("Profile 29")?.windowCount == 1)
        #expect(h.tab("Profile 29")?.isLinked == true)
    }

    @Test func fallbackIgnoresWindowsNotOpenedBySuperbrowser() {
        let other = CGRect(x: 300, y: 200, width: 1000, height: 700)
        let h = Harness(profiles: [prof("P1"), prof("Profile 29")],
                        configure: { $0.noExtensionProfiles = ["Profile 29"] }) { $0.add(1, A); $0.add(2, other) }
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(h.coordinator.owner(of: 2) == nil)      // e.g. an installed web app, open before any launch

        h.clock.advance(1)
        h.coordinator.activate(profileDir: "Profile 29")
        h.clock.advance(1)
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 2) == nil)      // was there before the launch

        h.clock.advance(10)                              // appears more than 10 s after the launch
        h.ws.add(3, other)
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 3) == nil)
        #expect(!h.ws.setFrameCalls.contains { $0.id == 2 || $0.id == 3 })
    }

    @Test func fallbackIgnoresDevTools() {
        let h = Harness(profiles: [prof("P1"), prof("Profile 29")],
                        configure: { $0.noExtensionProfiles = ["Profile 29"] }) { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.clock.advance(1)
        h.coordinator.activate(profileDir: "Profile 29")
        h.clock.advance(1)
        h.ws.add(2, CGRect(x: 300, y: 200, width: 1000, height: 700), title: "DevTools - example.com/")
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 2) == nil)
        #expect(!h.ws.setFrameCalls.contains { $0.id == 2 })
    }

    @Test func fallbackWaitsWhileAnotherProfileIsUnlinked() {
        // P2's extension has never reported: its windows look exactly like fallback windows.
        let h = Harness(profiles: [prof("P1"), prof("P2"), prof("Profile 29")],
                        configure: { $0.noExtensionProfiles = ["Profile 29"] }) { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.clock.advance(1)
        h.coordinator.activate(profileDir: "Profile 29")
        h.clock.advance(1)
        h.ws.add(2, CGRect(x: 300, y: 200, width: 1000, height: 700))
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 2) == nil)

        h.coordinator.receive(report("P2", []))         // every other profile is linked now
        #expect(h.coordinator.owner(of: 2) == "Profile 29")
    }

    @Test func updateProfilesRefreshesBar() {
        let h = Harness { _ in }
        #expect(h.coordinator.barModel.tabs.map(\.profileDir) == ["P1", "P2", "P3"])
        h.coordinator.updateProfiles([prof("P1", "Work"), prof("P2"), prof("P3")])
        #expect(h.tab("P1")?.name == "Work")
        h.coordinator.updateProfiles([prof("P1", "Work"), prof("P3")])
        #expect(h.tab("P2") == nil)
        #expect(h.tab("P3")?.slot == 2)
    }

    @Test func screensChangedClampsFrame() {
        let h = Harness(screens: [screen, CGRect(x: 1440, y: 0, width: 2560, height: 1440)],
                        configure: { $0.frame = CGRect(x: 3000, y: 100, width: 800, height: 600) }) { $0.add(1, A) }
        #expect(h.coordinator.settings.frame == CGRect(x: 3000, y: 100, width: 800, height: 600))
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(h.ws.didSet(1, CGRect(x: 3000, y: 132, width: 800, height: 568)))
        h.ws.setFrameCalls = []

        h.coordinator.screensChanged([screen])
        let expected = CGRect(x: 640, y: 100, width: 800, height: 600)
        #expect(h.coordinator.settings.frame == expected)
        #expect(h.store.load().frame == expected)
        #expect(h.ws.didSet(1, CGRect(x: 640, y: 132, width: 800, height: 568)))
    }

    @Test func linkOpensClaimOnlyForUnlinked() {
        let h = Harness(configure: { $0.noExtensionProfiles = ["P3"] }) { _ in }
        h.coordinator.receive(report("P1", []))
        h.coordinator.linkUnlinkedProfiles()
        #expect(h.launcher.claimed == ["P2"])
        #expect(h.coordinator.barModel.tabs.map(\.isLinked) == [true, false, true])
    }

    @Test func linkedProfilesPersistAcrossRestart() {
        let h = Harness { _ in }
        #expect(h.tab("P1")?.isLinked == false)
        h.coordinator.receive(report("P1", []))
        #expect(h.store.load().linkedProfiles == ["P1"])

        let restarted = Coordinator(windows: h.ws, launcher: h.launcher, store: h.store,
                                    profiles: [prof("P1"), prof("P2"), prof("P3")], screens: [screen])
        #expect(restarted.barModel.tabs.map(\.isLinked) == [true, false, false])
        restarted.linkUnlinkedProfiles()
        #expect(h.launcher.claimed == ["P2", "P3"])
    }

    @Test func staleReportDoesNotClaimWindowAfterChromeRestart() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P1", [(10, C)]))   // P1's window now sits at C
        #expect(h.coordinator.owner(of: 1) == "P1")

        h.ws.windows = [:]                               // Chrome quits; P1 never reports again
        h.coordinator.chromeTerminated()
        h.coordinator.windowsChanged()

        h.ws.add(7, C)                                   // relaunch: a P2 window opens at C
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 7) == nil)
        h.coordinator.receive(report("P2", [(20, C)]))
        #expect(h.coordinator.owner(of: 7) == "P2")
        #expect(h.tab("P1")?.windowCount == 0)
        #expect(h.tab("P1")?.isLinked == true)
    }

    @Test func emptyWindowListKeepsReports() {
        // Chrome runs with its windows on another Space: AX lists nothing, but reports keep arriving.
        let h = Harness { _ in }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 1) == nil)

        h.ws.add(1, A)                                   // the window shows up later at its reported bounds
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 1) == "P1")
        #expect(h.ws.didSet(1, C))
    }

    @Test func chromeTerminatedClearsReports() {
        let h = Harness { _ in }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.chromeTerminated()

        h.ws.add(1, A)                                   // relaunch: a window at the old reported bounds
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 1) == nil)
        #expect(h.tab("P1")?.isLinked == true)
    }

    @Test func closedWindowKeyIsNotReused() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        h.coordinator.receive(report("P1", [(10, C)]))
        h.coordinator.receive(report("P2", [(20, C)]))

        h.ws.windows[1] = nil                            // P1's window closes; P1 has not reported yet
        h.coordinator.windowsChanged()
        h.ws.add(3, C)                                   // a new P2 window opens at C
        h.coordinator.windowsChanged()
        #expect(h.coordinator.owner(of: 3) == nil)
        h.coordinator.receive(report("P2", [(20, C), (21, C)]))
        #expect(h.coordinator.owner(of: 3) == "P2")
        #expect(h.coordinator.owner(of: 2) == "P2")
    }

    @Test func waitingFingerprintsAreNeverMoved() {
        let h = Harness { $0.add(1, C); $0.add(2, C) }
        h.coordinator.receive(report("P1", [(10, C)]))
        #expect(h.ws.didSet(1, withHeight(C, 839)))
        #expect(h.ws.didSet(2, withHeight(C, 835)))
        h.ws.setFrameCalls = []

        h.ws.windows[1] = nil                            // waiting window 1 closes
        h.coordinator.windowsChanged()
        h.ws.add(3, C)                                   // a new window becomes ambiguous (P1#10 and P3#30 at C)
        h.coordinator.receive(report("P3", [(30, C)]))
        #expect(!h.ws.setFrameCalls.contains { $0.id == 2 })
        #expect(h.ws.didSet(3, withHeight(C, 839)))

        // P2's report, generated while window 2 was at 835, still lands on window 2.
        h.coordinator.receive(report("P2", [(20, withHeight(C, 835))]))
        #expect(h.coordinator.owner(of: 2) == "P2")
        #expect(h.coordinator.owner(of: 3) == nil)
        h.coordinator.receive(report("P3", [(30, withHeight(C, 839))]))
        #expect(h.coordinator.owner(of: 3) == "P3")
    }

    // MARK: Extra edge cases (controller rulings and design notes)

    @Test func emptyScreensKeepFrame() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.ws.setFrameCalls = []
        h.coordinator.screensChanged([])
        #expect(h.coordinator.settings.frame == screen)
        #expect(h.ws.setFrameCalls.isEmpty)
    }

    @Test func fullScreenWindowMoveIsIgnored() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        h.ws.setFrameCalls = []
        let full = CGRect(x: 0, y: 0, width: 1440, height: 900)
        h.ws.add(1, full, fullScreen: true)
        h.coordinator.windowMoved(1, to: full)
        #expect(h.ws.setFrameCalls.isEmpty)
        #expect(h.coordinator.settings.frame == screen)
    }

    @Test func barChangeFiresOnlyOnChange() {
        let h = Harness { $0.add(1, A) }
        var count = 0
        h.coordinator.onBarChange = { _ in count += 1 }
        h.coordinator.windowsChanged()
        #expect(count == 0)
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(count == 1)
        h.coordinator.receive(report("P1", [(10, C)]))
        #expect(count == 1)
    }

    @Test func barShowsModifierAndSlots() {
        let profiles = (1...10).map { prof("P\($0)") }
        let h = Harness(profiles: profiles, configure: { $0.hotkeyModifier = .controlOption }) { _ in }
        #expect(h.coordinator.barModel.modifier == .controlOption)
        #expect(h.coordinator.barModel.position == .top)
        #expect(h.coordinator.barModel.tabs.map(\.slot) == [1, 2, 3, 4, 5, 6, 7, 8, 9, nil])
        h.coordinator.updateSettings { $0.hotkeyModifier = .controlCommand; $0.barPosition = .left }
        #expect(h.coordinator.barModel.modifier == .controlCommand)
        #expect(h.coordinator.barModel.barRect == CGRect(x: 0, y: 25, width: 168, height: 875))
        #expect(h.store.load().barPosition == .left)
    }

    @Test func updateSettingsResnapsToNewContent() {
        let h = Harness { $0.add(1, A) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.ws.setFrameCalls = []
        h.coordinator.updateSettings { $0.barPosition = .left }
        #expect(h.ws.didSet(1, CGRect(x: 168, y: 25, width: 1272, height: 875)))
    }
}
