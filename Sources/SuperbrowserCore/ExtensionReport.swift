import CoreGraphics

public struct ReportedWindow: Codable, Equatable, Sendable {
    public var id: Int
    public var left, top, width, height: Double
    public var focused: Bool
    public var state: String
    public var bounds: CGRect { CGRect(x: left, y: top, width: width, height: height) }

    public init(id: Int, left: Double, top: Double, width: Double, height: Double, focused: Bool, state: String) {
        self.id = id; self.left = left; self.top = top; self.width = width; self.height = height
        self.focused = focused; self.state = state
    }
}

public struct ExtensionReport: Codable, Equatable, Sendable {
    public var profileDir: String
    public var extensionVersion: Int
    public var windows: [ReportedWindow]

    public init(profileDir: String, extensionVersion: Int, windows: [ReportedWindow]) {
        self.profileDir = profileDir; self.extensionVersion = extensionVersion; self.windows = windows
    }
}

public struct ReportedWindowKey: Hashable, Sendable {
    public var profileDir: String
    public var chromeId: Int
    public init(profileDir: String, chromeId: Int) { self.profileDir = profileDir; self.chromeId = chromeId }
}
