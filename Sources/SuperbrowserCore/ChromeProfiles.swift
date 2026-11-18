import Foundation

public struct RGB: Equatable, Codable, Sendable {
    public let r, g, b: UInt8
    public init(r: UInt8, g: UInt8, b: UInt8) { self.r = r; self.g = g; self.b = b }
    /// Chrome stores colors as signed 32-bit ARGB integers.
    public init(argb: Int) {
        let v = UInt32(truncatingIfNeeded: argb)
        self.init(r: UInt8((v >> 16) & 0xFF), g: UInt8((v >> 8) & 0xFF), b: UInt8(v & 0xFF))
    }
    public static let fallbackGray = RGB(r: 128, g: 128, b: 128)
}

public struct ChromeProfile: Equatable, Sendable {
    public let dir: String
    public let name: String
    public let color: RGB
    public init(dir: String, name: String, color: RGB) {
        self.dir = dir; self.name = name; self.color = color
    }
}

public struct LocalStateError: Error, Equatable { public init() {} }

/// Parses Chrome's `Local State`. Only dirs in `existingDirs` are returned.
public func parseLocalState(_ data: Data, existingDirs: Set<String>) throws -> [ChromeProfile] {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let profile = root["profile"] as? [String: Any],
          let cache = profile["info_cache"] as? [String: Any] else { throw LocalStateError() }

    func make(_ dir: String) -> ChromeProfile? {
        guard existingDirs.contains(dir), let info = cache[dir] as? [String: Any] else { return nil }
        let name = info["name"] as? String ?? dir
        let argb = (info["profile_color_seed"] as? NSNumber)?.intValue
            ?? (info["default_avatar_fill_color"] as? NSNumber)?.intValue
        return ChromeProfile(dir: dir, name: name, color: argb.map(RGB.init(argb:)) ?? .fallbackGray)
    }

    var result: [ChromeProfile] = []
    var seen = Set<String>()
    for dir in (profile["profiles_order"] as? [String]) ?? [] where seen.insert(dir).inserted {
        if let p = make(dir) { result.append(p) }
    }
    let rest = cache.keys.filter { !seen.contains($0) }.compactMap(make)
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    return result + rest
}

public let chromeUserDataURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Google/Chrome")

/// Reads (never writes) Chrome's profile list from disk.
public func loadChromeProfiles(userDataURL: URL = chromeUserDataURL) -> [ChromeProfile] {
    guard let data = try? Data(contentsOf: userDataURL.appendingPathComponent("Local State")) else { return [] }
    let fm = FileManager.default
    var dirs = Set<String>()
    if let names = try? fm.contentsOfDirectory(atPath: userDataURL.path) {
        for n in names {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: userDataURL.appendingPathComponent(n).path, isDirectory: &isDir), isDir.boolValue {
                dirs.insert(n)
            }
        }
    }
    return (try? parseLocalState(data, existingDirs: dirs)) ?? []
}
