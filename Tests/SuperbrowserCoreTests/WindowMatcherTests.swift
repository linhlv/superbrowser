import Testing
import CoreGraphics
@testable import SuperbrowserCore

private let A = CGRect(x: 0, y: 57, width: 1440, height: 843)
private let B = CGRect(x: 100, y: 100, width: 1000, height: 700)
private let C = CGRect(x: 200, y: 150, width: 1000, height: 700)
private let p1 = ReportedWindowKey(profileDir: "P1", chromeId: 10)
private let p2 = ReportedWindowKey(profileDir: "P2", chromeId: 20)
private let p3 = ReportedWindowKey(profileDir: "P3", chromeId: 30)

private func ax(_ id: Int, _ f: CGRect, min: Bool = false, fs: Bool = false) -> AXWindowInfo {
    AXWindowInfo(id: id, frame: f, title: "", isMinimized: min, isFullScreen: fs)
}

@Test func uniqueBoundsAssigned() {
    let r = matchWindows(unassigned: [ax(1, A), ax(2, B)], available: [p1: A, p2: B], fallbackProfile: nil)
    #expect(r.assigned == [1: p1, 2: p2])
    #expect(r.ambiguous.isEmpty)
}

@Test func toleranceOnePoint() {
    let near = matchWindows(unassigned: [ax(1, A.offsetBy(dx: 0.5, dy: 0))], available: [p1: A], fallbackProfile: nil)
    #expect(near.assigned == [1: p1])
    let far = matchWindows(unassigned: [ax(1, A.offsetBy(dx: 2, dy: 0))], available: [p1: A], fallbackProfile: nil)
    #expect(far.assigned.isEmpty)
}

@Test func identicalBoundsAreAmbiguous() {
    let r = matchWindows(unassigned: [ax(2, A), ax(1, A)], available: [p1: A, p2: A], fallbackProfile: nil)
    #expect(r.ambiguous == [1, 2])
    #expect(r.assigned.isEmpty)
}

@Test func sharedCandidateIsAmbiguous() {
    let r = matchWindows(unassigned: [ax(1, A), ax(2, A)], available: [p1: A], fallbackProfile: nil)
    #expect(r.ambiguous == [1, 2])
    #expect(r.assigned.isEmpty)
}

@Test func minimizedAndFullScreenNotMatched() {
    let r = matchWindows(unassigned: [ax(1, A, min: true), ax(2, A, fs: true)], available: [p1: A], fallbackProfile: "X")
    #expect(r.assigned.isEmpty && r.fallback.isEmpty && r.ambiguous.isEmpty)
}

@Test func fallbackOnlyWhenAllReportedAccounted() {
    let r = matchWindows(unassigned: [ax(1, A), ax(2, C)], available: [p1: A], fallbackProfile: "Profile 29")
    #expect(r.fallback == [2: "Profile 29"])
    let r2 = matchWindows(unassigned: [ax(1, A), ax(2, C)], available: [p1: A, p3: B], fallbackProfile: "Profile 29")
    #expect(r2.fallback.isEmpty)
}

@Test func smallUnmatchedWindowNotAdopted() {
    let r = matchWindows(unassigned: [ax(1, CGRect(x: 0, y: 0, width: 500, height: 600))], available: [:], fallbackProfile: "Profile 29")
    #expect(r.fallback.isEmpty)
}

@Test func fingerprintHeightsUnique() {
    let f = fingerprintFrames([5, 9], content: A)
    #expect(f[5] == CGRect(x: 0, y: 57, width: 1440, height: 842))
    #expect(f[9] == CGRect(x: 0, y: 57, width: 1440, height: 841))
}
