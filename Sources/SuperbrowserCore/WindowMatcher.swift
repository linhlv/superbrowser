import CoreGraphics

public typealias WindowID = Int

public struct AXWindowInfo: Equatable, Sendable {
    public var id: WindowID
    public var frame: CGRect
    public var title: String
    public var isMinimized: Bool
    public var isFullScreen: Bool

    public init(id: WindowID, frame: CGRect, title: String, isMinimized: Bool, isFullScreen: Bool) {
        self.id = id; self.frame = frame; self.title = title
        self.isMinimized = isMinimized; self.isFullScreen = isFullScreen
    }
}

public struct MatchResult: Equatable {
    public var assigned: [WindowID: ReportedWindowKey] = [:]
    public var fallback: [WindowID: String] = [:]
    public var ambiguous: [WindowID] = []
    public init() {}
}

private let matchTolerance: CGFloat = 1
private let fingerprintStep: CGFloat = 4
private let minFallbackSize = CGSize(width: 700, height: 500)

private func edgesMatch(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) <= matchTolerance && abs(a.minY - b.minY) <= matchTolerance
        && abs(a.maxX - b.maxX) <= matchTolerance && abs(a.maxY - b.maxY) <= matchTolerance
}

public func matchWindows(unassigned: [AXWindowInfo], available: [ReportedWindowKey: CGRect], fallbackProfile: String?) -> MatchResult {
    var result = MatchResult()
    let eligible = unassigned.filter { !$0.isMinimized && !$0.isFullScreen }.sorted { $0.id < $1.id }

    var candidates: [WindowID: [ReportedWindowKey]] = [:]
    var claimCount: [ReportedWindowKey: Int] = [:]
    for w in eligible {
        let c = available.filter { edgesMatch(w.frame, $0.value) }.map(\.key)
        candidates[w.id] = c
        for k in c { claimCount[k, default: 0] += 1 }
    }

    var ambiguous: [WindowID] = []
    var unmatched: [AXWindowInfo] = []
    for w in eligible {
        let c = candidates[w.id] ?? []
        if c.isEmpty {
            unmatched.append(w)
        } else if c.count == 1, claimCount[c[0]] == 1 {
            result.assigned[w.id] = c[0]
        } else {
            ambiguous.append(w.id)
        }
    }
    result.ambiguous = ambiguous.sorted()

    if let profile = fallbackProfile, Set(result.assigned.values) == Set(available.keys) {
        for w in unmatched where w.frame.width >= minFallbackSize.width && w.frame.height >= minFallbackSize.height {
            result.fallback[w.id] = profile
        }
    }
    return result
}

/// Gives each id the content rect with a unique height (content height minus 4, 8, 12, … pt), so the
/// next report tells stacked windows apart. The 4 pt step is well above twice the 1 pt match tolerance,
/// so a fingerprinted window matches only the report at its own height. Heights closer than one step
/// to any of `excludingHeights` (fingerprints still in use) are skipped.
public func fingerprintFrames(_ ids: [WindowID], content: CGRect,
                              excludingHeights inUse: Set<CGFloat> = []) -> [WindowID: CGRect] {
    var out: [WindowID: CGRect] = [:]
    var step: CGFloat = 0
    for id in ids {
        var height: CGFloat
        repeat {
            step += 1
            height = content.height - fingerprintStep * step
        } while inUse.contains { abs($0 - height) < fingerprintStep }
        var f = content
        f.size.height = height
        out[id] = f
    }
    return out
}
