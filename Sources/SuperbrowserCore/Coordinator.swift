import CoreGraphics
import Foundation

/// Chrome's windows as seen through Accessibility. All rects are AX coordinates.
@MainActor public protocol WindowSystem: AnyObject {
    /// Current standard Chrome windows.
    func chromeWindows() -> [AXWindowInfo]
    func setFrame(_ id: WindowID, _ rect: CGRect)
    /// Un-minimize, raise, activate Chrome.
    func raise(_ id: WindowID)
}

@MainActor public protocol ChromeLaunching: AnyObject {
    func openWindow(profileDir: String)
    func openClaim(profileDir: String)
}

public struct BarTab: Equatable, Sendable {
    public var profileDir: String
    public var name: String
    public var color: RGB
    /// 1…9, nil beyond the ninth tab.
    public var slot: Int?
    public var isActive: Bool
    public var windowCount: Int
    public var isLinked: Bool

    public init(profileDir: String, name: String, color: RGB, slot: Int?, isActive: Bool, windowCount: Int, isLinked: Bool) {
        self.profileDir = profileDir; self.name = name; self.color = color; self.slot = slot
        self.isActive = isActive; self.windowCount = windowCount; self.isLinked = isLinked
    }
}

public struct BarModel: Equatable, Sendable {
    public var position: BarPosition
    public var barRect: CGRect
    public var tabs: [BarTab]
    public var modifier: HotkeyModifier

    public init(position: BarPosition, barRect: CGRect, tabs: [BarTab], modifier: HotkeyModifier) {
        self.position = position; self.barRect = barRect; self.tabs = tabs; self.modifier = modifier
    }
}

/// Turns window, report, screen and settings events into window moves, raises, launches and bar updates.
@MainActor public final class Coordinator {
    public var onBarChange: ((BarModel) -> Void)?
    public private(set) var settings: Settings
    public private(set) var barModel: BarModel

    private let windows: WindowSystem
    private let now: () -> Date
    private let launcher: ChromeLaunching
    private let store: SettingsStore
    private var profiles: [ChromeProfile]
    private var screens: [CGRect]
    private(set) var frame: CGRect

    /// Latest report per profile dir (kept for every dir; unknown/hidden ones are filtered on use).
    private var reports: [String: ExtensionReport] = [:]
    /// Profiles that ever reported (for `isLinked`; survives clearing `reports` when Chrome quits).
    private var everReported: Set<String> = []
    /// Reported windows whose assigned AX window vanished; not matchable until their profile reports again.
    private var deadKeys: Set<ReportedWindowKey> = []
    /// Windows linked to a reported Chrome window of a managed profile.
    private var assigned: [WindowID: ReportedWindowKey] = [:]
    /// Windows adopted by the no-extension fallback profile (provisional: a later report match wins).
    private var fallbackOwned: [WindowID: String] = [:]
    /// Ambiguous windows moved to a unique fingerprint rect and waiting for the next report;
    /// tracked so a later fingerprint round never reuses a height still in use.
    private var pendingFingerprints: [WindowID: CGRect] = [:]
    /// Rects we last passed to `setFrame`, so the resulting move notifications are ignored.
    private var ownMoves: [WindowID: CGRect] = [:]
    /// Most-recently-front first.
    private var mru: [WindowID] = []
    private var front: WindowID?
    private var chromeActive = true
    /// The last time a user move was corrected to keep the bar on screen.
    private var lastCorrection: (id: WindowID, at: Date)?

    private static let ownMoveTolerance: CGFloat = 2
    private static let correctionGuard: TimeInterval = 1
    private static let inPlaceTolerance: CGFloat = 0.5
    private static let inactiveStates: Set<String> = ["minimized", "fullscreen", "locked-fullscreen"]

    public init(windows: WindowSystem, launcher: ChromeLaunching, store: SettingsStore,
                profiles: [ChromeProfile], screens: [CGRect], now: @escaping () -> Date = Date.init) {
        self.now = now
        self.windows = windows
        self.launcher = launcher
        self.store = store
        self.profiles = profiles
        self.screens = screens
        var s = store.load()
        let f = Coordinator.resolveFrame(s.frame, screens: screens, current: .zero)
        let clampedStoredFrame = s.frame != nil && s.frame != f
        if clampedStoredFrame { s.frame = f }
        self.settings = s
        self.frame = f
        self.barModel = BarModel(position: s.barPosition, barRect: .zero, tabs: [], modifier: s.hotkeyModifier)
        if clampedStoredFrame { persist() }
        barModel = makeBarModel()
    }

    // MARK: - Events

    public func receive(_ report: ExtensionReport) {
        reports[report.profileDir] = report
        everReported.insert(report.profileDir)
        // A newer report is the truth for its profile: a key it still lists is alive again.
        deadKeys = deadKeys.filter { $0.profileDir != report.profileDir }
        sync()
    }

    public func windowsChanged() { sync() }

    /// Chrome quit: every report is stale and every window is gone.
    /// (An empty window list alone doesn't mean this: Chrome's windows may be on another Space.)
    public func chromeTerminated() {
        reports = [:]
        dropVanished([:])
        refreshBar()
    }

    public func windowMoved(_ id: WindowID, to rect: CGRect) {
        if let own = ownMoves[id], rect.isWithin(Self.ownMoveTolerance, of: own) { return }
        guard isManaged(id) else { return }
        let ax = currentWindows()
        guard let w = ax[id], isSnappable(w) else { return }
        // The user moved a managed window: it leads, everything else follows.
        ownMoves[id] = rect
        let derived = FrameLayout.frame(fromContent: rect, position: settings.barPosition)
        let clamped = FrameLayout.clamp(derived, into: screens)
        applyFrame(clamped)
        // Moved or zoomed so the bar would leave the screen: pull the leader back in too, once per
        // user move. A second off-screen report right after a correction means Chrome didn't honour
        // it; trying again would loop.
        let recentlyCorrected = lastCorrection.map {
            $0.id == id && now().timeIntervalSince($0.at) < Self.correctionGuard
        } ?? false
        if clamped != derived, !recentlyCorrected {
            lastCorrection = (id, now())
            snapAll(ax)
        } else {
            snapAll(ax, except: id)
        }
        refreshBar()
    }

    public func frontWindowChanged(_ id: WindowID?) {
        front = id
        if let id {
            mru.removeAll { $0 == id }
            mru.insert(id, at: 0)
        }
        refreshBar()
    }

    /// Chrome became (in)active. While it isn't, its front window isn't in front of the user, so a
    /// shortcut raises the profile's most recent window instead of cycling past it.
    public func chromeActiveChanged(_ active: Bool) {
        chromeActive = active
    }

    public func activate(slot: Int) {
        guard let p = profile(forSlot: slot, in: visibleProfiles(profiles, settings: settings)) else { return }
        activate(profileDir: p.dir)
    }

    public func activate(profileDir: String) {
        guard managedDirs.contains(profileDir) else { return }
        switch switchAction(profileDir: profileDir, windows: windowsByRecency(of: profileDir),
                             front: chromeActive ? front : nil) {
        case .raise(let id): windows.raise(id)
        case .openNewWindow(let dir): launcher.openWindow(profileDir: dir)
        case .none: break
        }
    }

    /// Opens the claim page for visible profiles that never reported and don't use the fallback.
    public func linkUnlinkedProfiles() {
        for p in visibleProfiles(profiles, settings: settings) where !isLinked(p.dir) {
            launcher.openClaim(profileDir: p.dir)
        }
    }

    public func updateProfiles(_ profiles: [ChromeProfile]) {
        self.profiles = profiles
        sync()
    }

    /// Saves, re-snaps every managed window and updates the bar.
    public func updateSettings(_ change: (inout Settings) -> Void) {
        change(&settings)
        applyFrame(Self.resolveFrame(settings.frame, screens: screens, current: frame))
        sync()
        snapAll(currentWindows())
        refreshBar()
    }

    public func screensChanged(_ screens: [CGRect]) {
        self.screens = screens
        guard !screens.isEmpty else { return }
        let clamped = FrameLayout.clamp(frame, into: screens)
        guard clamped != frame else { return }
        applyFrame(clamped)
        snapAll(currentWindows())
        refreshBar()
    }

    // MARK: - Testing hooks

    /// The profile dir owning a managed window, if any.
    func owner(of id: WindowID) -> String? {
        assigned[id]?.profileDir ?? fallbackOwned[id]
    }

    // MARK: - Frame

    private var content: CGRect { FrameLayout.split(frame: frame, position: settings.barPosition).content }

    private static func resolveFrame(_ stored: CGRect?, screens: [CGRect], current: CGRect) -> CGRect {
        guard let first = screens.first else { return stored ?? current }
        return FrameLayout.clamp(stored ?? first, into: screens)
    }

    /// Sets the frame and saves it (also saves any other pending settings change).
    private func applyFrame(_ f: CGRect) {
        frame = f
        settings.frame = f
        persist()
    }

    private func persist() {
        try? store.save(settings)
    }

    // MARK: - Window bookkeeping

    private func currentWindows() -> [WindowID: AXWindowInfo] {
        Dictionary(windows.chromeWindows().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private var managedDirs: Set<String> {
        Set(visibleProfiles(profiles, settings: settings).map(\.dir))
    }

    /// The single no-extension profile, if exactly one is configured and it is visible.
    private var fallbackProfile: String? {
        guard settings.noExtensionProfiles.count == 1, let dir = settings.noExtensionProfiles.first,
              managedDirs.contains(dir) else { return nil }
        return dir
    }

    private func isManaged(_ id: WindowID) -> Bool { owner(of: id) != nil }

    private func isLinked(_ dir: String) -> Bool {
        everReported.contains(dir) || settings.noExtensionProfiles.contains(dir)
    }

    private func reportedWindow(_ key: ReportedWindowKey) -> ReportedWindow? {
        reports[key.profileDir]?.windows.first { $0.id == key.chromeId }
    }

    /// Bounds of every reported window that can be matched (not minimized / full screen, not dead), any profile.
    /// Hidden and unknown profiles are included so their windows are recognised and left alone.
    private func matchableReportedBounds() -> [ReportedWindowKey: CGRect] {
        var out: [ReportedWindowKey: CGRect] = [:]
        for (dir, r) in reports {
            for w in r.windows where !Self.inactiveStates.contains(w.state) {
                let key = ReportedWindowKey(profileDir: dir, chromeId: w.id)
                if !deadKeys.contains(key) { out[key] = w.bounds }
            }
        }
        return out
    }

    private func sync() {
        let ax = currentWindows()
        dropVanished(ax)
        adoptNewWindows(ax)
        refreshBar()
    }

    /// Forgets windows that are gone on either side, or whose profile is no longer managed.
    /// Reports describing windows that are gone are stale and must not match a new window.
    private func dropVanished(_ ax: [WindowID: AXWindowInfo]) {
        for (id, key) in assigned where ax[id] == nil { deadKeys.insert(key) }
        let dirs = managedDirs
        let fallback = fallbackProfile
        assigned = assigned.filter { id, key in
            ax[id] != nil && dirs.contains(key.profileDir) && reportedWindow(key) != nil
        }
        fallbackOwned = fallbackOwned.filter { id, dir in ax[id] != nil && dir == fallback }
        // A fingerprinted window that left its fingerprint rect (e.g. the user moved it) stops waiting.
        pendingFingerprints = pendingFingerprints.filter { id, rect in
            ax[id].map { $0.frame.isWithin(Self.inPlaceTolerance, of: rect) } ?? false
        }
        ownMoves = ownMoves.filter { ax[$0.key] != nil }
        mru.removeAll { ax[$0] == nil }
        if let f = front, ax[f] == nil { front = nil }
    }

    private func adoptNewWindows(_ ax: [WindowID: AXWindowInfo]) {
        let linked = Set(assigned.values)
        let available = matchableReportedBounds().filter { !linked.contains($0.key) }
        // Fallback-owned windows stay candidates, so a later report match takes them over.
        let candidates = ax.values.filter { assigned[$0.id] == nil }.sorted { $0.id < $1.id }
        let result = matchWindows(unassigned: candidates, available: available,
                                  fallbackProfile: reports.isEmpty ? nil : fallbackProfile)

        let dirs = managedDirs
        for (id, key) in result.assigned.sorted(by: { $0.key < $1.key }) {
            fallbackOwned[id] = nil
            pendingFingerprints[id] = nil
            guard dirs.contains(key.profileDir) else { continue }   // hidden/unknown profile: leave it alone
            assigned[id] = key
            snap(id, ax)
        }
        for (id, dir) in result.fallback.sorted(by: { $0.key < $1.key }) where fallbackOwned[id] == nil {
            pendingFingerprints[id] = nil
            fallbackOwned[id] = dir
            snap(id, ax)
        }
        fingerprint(result.ambiguous, ax)
    }

    /// Moves newly ambiguous windows to unique heights so the next report tells them apart.
    /// Windows already waiting are never moved again (a report about them may be in flight),
    /// and their heights are not reused.
    private func fingerprint(_ ambiguous: [WindowID], _ ax: [WindowID: AXWindowInfo]) {
        let fresh = ambiguous.filter { pendingFingerprints[$0] == nil }
        guard !fresh.isEmpty else { return }
        let inUse = Set(pendingFingerprints.values.map(\.height))
        for (id, rect) in fingerprintFrames(fresh, content: content, excludingHeights: inUse) {
            fallbackOwned[id] = nil
            pendingFingerprints[id] = rect
            move(id, to: rect, ax)
        }
    }

    // MARK: - Moving windows

    private func isSnappable(_ w: AXWindowInfo) -> Bool {
        guard !w.isMinimized, !w.isFullScreen else { return false }
        if let key = assigned[w.id], let state = reportedWindow(key)?.state, Self.inactiveStates.contains(state) {
            return false
        }
        return true
    }

    private func snap(_ id: WindowID, _ ax: [WindowID: AXWindowInfo]) {
        move(id, to: content, ax)
    }

    private func snapAll(_ ax: [WindowID: AXWindowInfo], except leader: WindowID? = nil) {
        let ids = Set(assigned.keys).union(fallbackOwned.keys).subtracting(leader.map { [$0] } ?? [])
        for id in ids.sorted() { snap(id, ax) }
    }

    /// Never touches minimized or full-screen windows; skips windows already in place.
    private func move(_ id: WindowID, to rect: CGRect, _ ax: [WindowID: AXWindowInfo]) {
        guard let w = ax[id], isSnappable(w) else { return }
        if w.frame.isWithin(Self.inPlaceTolerance, of: rect) { return }
        ownMoves[id] = rect
        windows.setFrame(id, rect)
    }

    // MARK: - Switching

    /// A profile's managed windows, most-recently-front first, then by id.
    private func windowsByRecency(of dir: String) -> [WindowID] {
        let mine = Set(assigned.filter { $0.value.profileDir == dir }.keys)
            .union(fallbackOwned.filter { $0.value == dir }.keys)
        let recent = mru.filter { mine.contains($0) }
        return recent + mine.subtracting(recent).sorted()
    }

    // MARK: - Bar

    private func makeBarModel() -> BarModel {
        let activeDir = front.flatMap(owner(of:))
        var counts: [String: Int] = [:]
        for key in assigned.values { counts[key.profileDir, default: 0] += 1 }
        for dir in fallbackOwned.values { counts[dir, default: 0] += 1 }
        let tabs = visibleProfiles(profiles, settings: settings).enumerated().map { i, p in
            BarTab(profileDir: p.dir, name: p.name, color: p.color,
                   slot: i < 9 ? i + 1 : nil,
                   isActive: p.dir == activeDir,
                   windowCount: counts[p.dir] ?? 0,
                   isLinked: isLinked(p.dir))
        }
        return BarModel(position: settings.barPosition,
                        barRect: FrameLayout.split(frame: frame, position: settings.barPosition).bar,
                        tabs: tabs, modifier: settings.hotkeyModifier)
    }

    private func refreshBar() {
        let model = makeBarModel()
        guard model != barModel else { return }
        barModel = model
        onBarChange?(model)
    }
}

private extension CGRect {
    func isWithin(_ tolerance: CGFloat, of other: CGRect) -> Bool {
        abs(minX - other.minX) <= tolerance && abs(minY - other.minY) <= tolerance
            && abs(maxX - other.maxX) <= tolerance && abs(maxY - other.maxY) <= tolerance
    }
}
