import Foundation

/// One-time nonces for linking a profile's helper extension.
///
/// Superbrowser opens `/claim?nonce=<n>` in the profile it wants to link; the extension trades the nonce
/// for the profile dir (`POST /claim/confirm`). A web page can open the claim URL too, but can't know a
/// live nonce, so it can't relabel a profile.
@MainActor public final class ClaimRegistry {
    public static let lifetime: TimeInterval = 5 * 60

    private struct Pending {
        let profileDir: String
        let issued: Date
    }

    private var pending: [String: Pending] = [:]
    private let now: () -> Date
    private let makeNonce: () -> String

    public init(now: @escaping () -> Date = Date.init,
                makeNonce: @escaping () -> String = ClaimRegistry.randomNonce) {
        self.now = now
        self.makeNonce = makeNonce
    }

    /// A fresh nonce that confirms `profileDir` once, within `lifetime`.
    public func issue(profileDir: String) -> String {
        prune()
        var nonce: String
        repeat { nonce = makeNonce() } while pending[nonce] != nil
        pending[nonce] = Pending(profileDir: profileDir, issued: now())
        return nonce
    }

    /// The profile a live nonce was issued for, without using it up (for the claim page's text).
    public func profileDir(forNonce nonce: String) -> String? {
        prune()
        return pending[nonce]?.profileDir
    }

    /// The profile a live nonce was issued for; the nonce can't be used again.
    public func confirm(_ nonce: String) -> String? {
        prune()
        return pending.removeValue(forKey: nonce)?.profileDir
    }

    private func prune() {
        let t = now()
        pending = pending.filter { t.timeIntervalSince($0.value.issued) < Self.lifetime }
    }

    /// 128 random bits as 32 lower-case hex digits.
    public nonisolated static func randomNonce() -> String {
        var rng = SystemRandomNumberGenerator()
        return (0..<2).map { _ in
            let s = String(rng.next() as UInt64, radix: 16)
            return String(repeating: "0", count: 16 - s.count) + s
        }.joined()
    }
}

private struct ClaimConfirmRequest: Codable { var nonce: String }
private struct ClaimConfirmReply: Codable { var profileDir: String }

/// The nonce in a `POST /claim/confirm` body (`{"nonce": "…"}`), if it is one.
public func claimConfirmNonce(from body: Data) -> String? {
    try? JSONDecoder().decode(ClaimConfirmRequest.self, from: body).nonce
}

/// The `POST /claim/confirm` reply body: `{"profileDir": "…"}`.
public func claimConfirmReply(profileDir: String) -> Data {
    (try? JSONEncoder().encode(ClaimConfirmReply(profileDir: profileDir))) ?? Data()
}
