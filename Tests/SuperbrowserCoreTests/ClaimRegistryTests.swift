import Foundation
import Testing
@testable import SuperbrowserCore

@MainActor
@Suite struct ClaimRegistryTests {
    private final class Clock { var now = Date(timeIntervalSinceReferenceDate: 0) }

    private func registry(_ clock: Clock = Clock()) -> ClaimRegistry {
        var n = 0
        return ClaimRegistry(now: { clock.now }, makeNonce: { n += 1; return "nonce\(n)" })
    }

    @Test func issueGivesEachClaimItsOwnNonce() {
        let r = registry()
        let a = r.issue(profileDir: "Profile 1")
        let b = r.issue(profileDir: "Profile 2")
        #expect(a != b)
        #expect(r.profileDir(forNonce: a) == "Profile 1")
        #expect(r.profileDir(forNonce: b) == "Profile 2")
    }

    @Test func confirmWorksOnce() {
        let r = registry()
        let n = r.issue(profileDir: "Profile 1")
        #expect(r.profileDir(forNonce: n) == "Profile 1")   // looking it up doesn't consume it
        #expect(r.confirm(n) == "Profile 1")
        #expect(r.confirm(n) == nil)
        #expect(r.profileDir(forNonce: n) == nil)
    }

    @Test func unknownNonceRejected() {
        let r = registry()
        _ = r.issue(profileDir: "Profile 1")
        #expect(r.confirm("bogus") == nil)
        #expect(r.confirm("") == nil)
        #expect(r.profileDir(forNonce: "bogus") == nil)
    }

    @Test func expiredNonceRejected() {
        let clock = Clock()
        let r = registry(clock)
        let n = r.issue(profileDir: "Profile 1")
        let fresh = r.issue(profileDir: "Profile 2")
        clock.now += ClaimRegistry.lifetime - 1
        #expect(r.confirm(fresh) == "Profile 2")
        clock.now += 2
        #expect(r.profileDir(forNonce: n) == nil)
        #expect(r.confirm(n) == nil)
    }

    @Test func randomNoncesAreLongAndDistinct() {
        let a = ClaimRegistry.randomNonce()
        let b = ClaimRegistry.randomNonce()
        #expect(a != b)
        #expect(a.count == 32)
        #expect(a.allSatisfy { $0.isHexDigit && !$0.isUppercase })
    }

    @Test func confirmRequestDecodes() {
        #expect(claimConfirmNonce(from: Data(#"{"nonce":"abc"}"#.utf8)) == "abc")
        #expect(claimConfirmNonce(from: Data(#"{"dir":"Default"}"#.utf8)) == nil)
        #expect(claimConfirmNonce(from: Data("nonce=abc".utf8)) == nil)
    }

    @Test func confirmReplyEncodesProfileDir() throws {
        let json = try JSONSerialization.jsonObject(with: claimConfirmReply(profileDir: "Profile 37")) as? [String: String]
        #expect(json == ["profileDir": "Profile 37"])
    }
}
