import Testing
@testable import SuperbrowserCore

@Suite struct ShortcutConflictsTests {
    @Test func detectsEnabledDesktopShortcut() {
        let d: [String: Any] = [
            "118": ["enabled": 1, "value": ["parameters": [65535, 18, 262144]]],
            "119": ["enabled": 0, "value": ["parameters": [65535, 19, 262144]]],
        ]
        #expect(desktopShortcutConflicts(symbolicHotKeys: d, modifier: .control) == [1])
        #expect(desktopShortcutConflicts(symbolicHotKeys: d, modifier: .controlOption) == [])
    }
}
