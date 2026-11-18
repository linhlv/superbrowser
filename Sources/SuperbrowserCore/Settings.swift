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
    /// Profiles whose helper extension has reported at least once.
    public var linkedProfiles: Set<String> = []
    public init() {}

    /// Every field is optional on disk, so settings written by an older version still load.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Settings()
        barPosition = try c.decodeIfPresent(BarPosition.self, forKey: .barPosition) ?? d.barPosition
        frame = try c.decodeIfPresent(CGRect.self, forKey: .frame) ?? d.frame
        profileOrder = try c.decodeIfPresent([String].self, forKey: .profileOrder) ?? d.profileOrder
        hiddenProfiles = try c.decodeIfPresent(Set<String>.self, forKey: .hiddenProfiles) ?? d.hiddenProfiles
        noExtensionProfiles = try c.decodeIfPresent(Set<String>.self, forKey: .noExtensionProfiles) ?? d.noExtensionProfiles
        hotkeyModifier = try c.decodeIfPresent(HotkeyModifier.self, forKey: .hotkeyModifier) ?? d.hotkeyModifier
        launchAtLogin = try c.decodeIfPresent(Bool.self, forKey: .launchAtLogin) ?? d.launchAtLogin
        setupDone = try c.decodeIfPresent(Bool.self, forKey: .setupDone) ?? d.setupDone
        linkedProfiles = try c.decodeIfPresent(Set<String>.self, forKey: .linkedProfiles) ?? d.linkedProfiles
    }
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

/// Every profile dir (hidden ones included) in the current order, with `dir` swapped with its nearest
/// visible neighbour above (`up`) or below. Hidden profiles keep their places. Unchanged order when
/// `dir` is hidden, unknown or already at that edge.
public func movedProfileOrder(_ all: [ChromeProfile], settings: Settings, dir: String, up: Bool) -> [String] {
    var unhidden = settings
    unhidden.hiddenProfiles = []
    var order = visibleProfiles(all, settings: unhidden).map(\.dir)
    guard !settings.hiddenProfiles.contains(dir), let i = order.firstIndex(of: dir) else { return order }
    let candidates = up ? Array(order.indices[..<i].reversed()) : Array(order.indices[(i + 1)...])
    guard let j = candidates.first(where: { !settings.hiddenProfiles.contains(order[$0]) }) else { return order }
    order.swapAt(i, j)
    return order
}
