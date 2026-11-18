import Foundation
import CoreGraphics

public enum BarPosition: String, Codable, CaseIterable, Sendable { case left, right, top, bottom }
public enum HotkeyModifier: String, Codable, CaseIterable, Sendable { case control, controlOption, controlCommand }

public struct Settings: Codable, Equatable, Sendable {
    public var barPosition: BarPosition = .top
    public var frame: CGRect? = nil
    public var profileOrder: [String] = []
    public var hiddenProfiles: Set<String> = []
    public var noExtensionProfiles: Set<String> = []
    public var hotkeyModifier: HotkeyModifier = .control
    public var launchAtLogin = false
    public var setupDone = false
    public init() {}
}

public struct SettingsStore {
    public let url: URL
    public init(url: URL) { self.url = url }

    public static let defaultURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Superbrowser/settings.json")

    /// Defaults if the file is missing or corrupt.
    public func load() -> Settings {
        guard let data = try? Data(contentsOf: url),
              let s = try? JSONDecoder().decode(Settings.self, from: data) else { return Settings() }
        return s
    }

    public func save(_ s: Settings) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        try enc.encode(s).write(to: url, options: .atomic)
    }
}

public func visibleProfiles(_ all: [ChromeProfile], settings: Settings) -> [ChromeProfile] {
    let byDir = Dictionary(all.map { ($0.dir, $0) }, uniquingKeysWith: { a, _ in a })
    var seen = Set<String>()
    var out: [ChromeProfile] = []
    for d in settings.profileOrder {
        if let p = byDir[d], seen.insert(d).inserted { out.append(p) }
    }
    for p in all where seen.insert(p.dir).inserted { out.append(p) }
    return out.filter { !settings.hiddenProfiles.contains($0.dir) }
}

/// `slot` is 1-based.
public func profile(forSlot slot: Int, in visible: [ChromeProfile]) -> ChromeProfile? {
    visible.indices.contains(slot - 1) ? visible[slot - 1] : nil
}
