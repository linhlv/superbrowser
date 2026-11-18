import Testing
@testable import SuperbrowserCore

@Test func noWindowsOpensNew() {
    #expect(switchAction(profileDir: "Default", windows: [], front: 3) == .openNewWindow(profileDir: "Default"))
}

@Test func otherProfileFrontRaisesMostRecent() {
    #expect(switchAction(profileDir: "P", windows: [4, 7], front: 9) == .raise(4))
    #expect(switchAction(profileDir: "P", windows: [4, 7], front: nil) == .raise(4))
}

@Test func cyclesWithinProfile() {
    #expect(switchAction(profileDir: "P", windows: [4, 7, 8], front: 7) == .raise(8))
    #expect(switchAction(profileDir: "P", windows: [4, 7, 8], front: 8) == .raise(4))
}

@Test func singleFrontWindowIsNone() {
    #expect(switchAction(profileDir: "P", windows: [4], front: 4) == .none)
}
