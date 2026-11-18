import Testing
import Foundation
@testable import SuperbrowserCore

@Suite struct SettingsTests {
    private func p(_ d: String) -> ChromeProfile { ChromeProfile(dir: d, name: d, color: .fallbackGray) }

    @Test func orderDropsDeletedAndAppendsNew() {
        var s = Settings(); s.profileOrder = ["P3", "P1", "Gone"]
        let v = visibleProfiles([p("P1"), p("P2"), p("P3")], settings: s)
        #expect(v.map(\.dir) == ["P3", "P1", "P2"])
    }

    @Test func hiddenProfilesExcluded() {
        var s = Settings(); s.hiddenProfiles = ["P1"]
        let v = visibleProfiles([p("P1"), p("P2"), p("P3")], settings: s)
        #expect(!v.contains { $0.dir == "P1" })
        #expect(profile(forSlot: 1, in: v)?.dir == "P2")
    }

    @Test func moveKeepsHiddenPlace() {
        var s = Settings(); s.hiddenProfiles = ["P2"]
        let all = [p("P1"), p("P2"), p("P3"), p("P4")]
        // P3 moves up past hidden P2 to swap with its visible neighbour P1; P2 stays second.
        #expect(movedProfileOrder(all, settings: s, dir: "P3", up: true) == ["P3", "P2", "P1", "P4"])
        #expect(movedProfileOrder(all, settings: s, dir: "P1", up: false) == ["P3", "P2", "P1", "P4"])
        #expect(movedProfileOrder(all, settings: s, dir: "P3", up: false) == ["P1", "P2", "P4", "P3"])
        s.profileOrder = ["P4", "P2"]
        #expect(movedProfileOrder(all, settings: s, dir: "P1", up: true) == ["P1", "P2", "P4", "P3"])
    }

    @Test func moveAtEdgeIsNoop() {
        var s = Settings(); s.hiddenProfiles = ["P1"]; s.profileOrder = ["P3"]
        let all = [p("P1"), p("P2"), p("P3")]
        let current = ["P3", "P1", "P2"]
        #expect(movedProfileOrder(all, settings: s, dir: "P3", up: true) == current)
        #expect(movedProfileOrder(all, settings: s, dir: "P2", up: false) == current)
        #expect(movedProfileOrder(all, settings: s, dir: "P1", up: true) == current)   // hidden
        #expect(movedProfileOrder(all, settings: s, dir: "Gone", up: true) == current) // unknown
    }

    @Test func slotOutOfRangeIsNil() {
        let v = (1...7).map { p("P\($0)") }
        #expect(profile(forSlot: 9, in: v) == nil)
        #expect(profile(forSlot: 0, in: v) == nil)
    }

    @Test func settingsRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = SettingsStore(url: dir.appendingPathComponent("sub/settings.json"))
        var s = Settings()
        s.barPosition = .left
        s.frame = CGRect(x: 10, y: 20, width: 800, height: 600)
        s.profileOrder = ["B", "A"]
        s.hiddenProfiles = ["X"]
        s.noExtensionProfiles = ["Y", "Z"]
        s.hotkeyModifier = .controlOption
        s.launchAtLogin = true
        s.setupDone = true
        try store.save(s)
        #expect(store.load() == s)
    }

    @Test func corruptSettingsLoadDefaults() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("settings.json")
        try Data("{oops".utf8).write(to: url)
        #expect(SettingsStore(url: url).load() == Settings())
    }
}
