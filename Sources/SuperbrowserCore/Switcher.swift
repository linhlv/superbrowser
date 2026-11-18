public enum SwitchAction: Equatable, Sendable {
    case raise(WindowID)
    case openNewWindow(profileDir: String)
    case none
}

/// Decide what clicking a profile tab should do.
/// `windows` are the profile's managed windows, most-recently-front first.
public func switchAction(profileDir: String, windows: [WindowID], front: WindowID?) -> SwitchAction {
    guard let first = windows.first else { return .openNewWindow(profileDir: profileDir) }
    guard let front, let idx = windows.firstIndex(of: front) else { return .raise(first) }
    if windows.count < 2 { return .none }
    return .raise(windows[(idx + 1) % windows.count])
}
