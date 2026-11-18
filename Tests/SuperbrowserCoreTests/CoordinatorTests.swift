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

    func add(_ id: WindowID, _ rect: CGRect, minimized: Bool = false, fullScreen: Bool = false) {
        windows[id] = AXWindowInfo(id: id, frame: rect, title: "w\(id)", isMinimized: minimized, isFullScreen: fullScreen)
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
        coordinator = Coordinator(windows: ws, launcher: launcher, store: store, profiles: profiles, screens: screens)
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
        #expect(h.ws.didSet(1, withHeight(C, 842)))
        #expect(h.ws.didSet(2, withHeight(C, 841)))
        // Nothing is assigned while the stack is ambiguous.
        #expect(h.tab("P1")?.windowCount == 0)
        #expect(h.tab("P2")?.windowCount == 0)

        h.ws.setFrameCalls = []
        h.coordinator.receive(report("P1", [(10, withHeight(C, 842))]))
        h.coordinator.receive(report("P2", [(20, withHeight(C, 841))]))
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

    @Test func chromeQuitClearsWindows() {
        let h = Harness { $0.add(1, A); $0.add(2, B) }
        h.coordinator.receive(report("P1", [(10, A)]))
        h.coordinator.receive(report("P2", [(20, B)]))
        #expect(h.tab("P1")?.windowCount == 1)
        h.ws.setFrameCalls = []

        h.ws.windows = [:]
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
                        configure: { $0.noExtensionProfiles = ["Profile 29"] }) {
            $0.add(1, A)
            $0.add(2, CGRect(x: 300, y: 200, width: 1000, height: 700))
        }
        h.coordinator.windowsChanged()
        h.coordinator.receive(report("P1", [(10, A)]))
        #expect(h.ws.didSet(1, C))
        #expect(h.ws.didSet(2, C))
        #expect(h.coordinator.owner(of: 2) == "Profile 29")
        #expect(h.tab("Profile 29")?.windowCount == 1)
        #expect(h.tab("Profile 29")?.isLinked == true)
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
