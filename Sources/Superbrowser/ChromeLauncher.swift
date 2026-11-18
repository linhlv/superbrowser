import Foundation
import SuperbrowserCore

/// Opens Chrome windows / the claim page via `/usr/bin/open`.
@MainActor
final class ChromeLauncher: ChromeLaunching {
    private let port: UInt16
    private let claims: ClaimRegistry
    init(port: UInt16 = 47321, claims: ClaimRegistry) {
        self.port = port
        self.claims = claims
    }

    func openWindow(profileDir: String) {
        run(profileDir: profileDir, urls: [])
    }

    /// The page carries a one-time nonce; the extension trades it with the app for the profile dir.
    func openClaim(profileDir: String) {
        let nonce = claims.issue(profileDir: profileDir)
        run(profileDir: profileDir, urls: ["http://127.0.0.1:\(port)/claim?nonce=\(nonce)"])
    }

    private func run(profileDir: String, urls: [String]) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-na", "Google Chrome", "--args", "--profile-directory=\(profileDir)"] + urls
        do { try process.run() } catch {
            FileHandle.standardError.write(Data("ChromeLauncher: failed to run open: \(error)\n".utf8))
        }
    }
}
