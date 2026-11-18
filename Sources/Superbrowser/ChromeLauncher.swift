import Foundation
import SuperbrowserCore

/// Opens Chrome windows / the claim page via `/usr/bin/open`.
@MainActor
final class ChromeLauncher: ChromeLaunching {
    private let port: UInt16
    init(port: UInt16 = 47321) { self.port = port }

    func openWindow(profileDir: String) {
        run(profileDir: profileDir, urls: [])
    }

    func openClaim(profileDir: String) {
        let encoded = profileDir.addingPercentEncoding(withAllowedCharacters: .unreservedURLChars) ?? profileDir
        run(profileDir: profileDir, urls: ["http://127.0.0.1:\(port)/claim?dir=\(encoded)"])
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

extension CharacterSet {
    /// RFC 3986 unreserved characters only, so `&`, `=`, `+`, `%` and `/` are all encoded.
    static let unreservedURLChars = CharacterSet(charactersIn:
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
}
