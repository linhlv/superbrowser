import CoreGraphics

/// All geometry is in AX/global coordinates (origin top-left of primary screen, y down).
public enum FrameLayout {
    public static let barHeight: CGFloat = 32
    public static let barWidth: CGFloat = 168

    public static func split(frame: CGRect, position: BarPosition) -> (bar: CGRect, content: CGRect) {
        let f = frame
        switch position {
        case .top:
            return (CGRect(x: f.minX, y: f.minY, width: f.width, height: barHeight),
                    CGRect(x: f.minX, y: f.minY + barHeight, width: f.width, height: f.height - barHeight))
        case .bottom:
            return (CGRect(x: f.minX, y: f.maxY - barHeight, width: f.width, height: barHeight),
                    CGRect(x: f.minX, y: f.minY, width: f.width, height: f.height - barHeight))
        case .left:
            return (CGRect(x: f.minX, y: f.minY, width: barWidth, height: f.height),
                    CGRect(x: f.minX + barWidth, y: f.minY, width: f.width - barWidth, height: f.height))
        case .right:
            return (CGRect(x: f.maxX - barWidth, y: f.minY, width: barWidth, height: f.height),
                    CGRect(x: f.minX, y: f.minY, width: f.width - barWidth, height: f.height))
        }
    }

    public static func frame(fromContent c: CGRect, position: BarPosition) -> CGRect {
        switch position {
        case .top: return CGRect(x: c.minX, y: c.minY - barHeight, width: c.width, height: c.height + barHeight)
        case .bottom: return CGRect(x: c.minX, y: c.minY, width: c.width, height: c.height + barHeight)
        case .left: return CGRect(x: c.minX - barWidth, y: c.minY, width: c.width + barWidth, height: c.height)
        case .right: return CGRect(x: c.minX, y: c.minY, width: c.width + barWidth, height: c.height)
        }
    }

    public static func clamp(_ frame: CGRect, into screens: [CGRect]) -> CGRect {
        guard let first = screens.first else { return frame }
        if screens.contains(where: { $0.contains(frame) }) { return frame }
        var best = first
        var bestArea: CGFloat = -1
        for s in screens {
            let i = s.intersection(frame)
            let area = i.isNull ? 0 : i.width * i.height
            if area > bestArea { bestArea = area; best = s }
        }
        var r = frame
        r.size.width = min(r.width, best.width)
        r.size.height = min(r.height, best.height)
        r.origin.x = min(max(r.minX, best.minX), best.maxX - r.width)
        r.origin.y = min(max(r.minY, best.minY), best.maxY - r.height)
        return r
    }

    public static func cocoaRect(fromAX r: CGRect, primaryScreenHeight h: CGFloat) -> CGRect {
        CGRect(x: r.minX, y: h - r.minY - r.height, width: r.width, height: r.height)
    }

    public static func axRect(fromCocoa r: CGRect, primaryScreenHeight h: CGFloat) -> CGRect {
        CGRect(x: r.minX, y: h - r.minY - r.height, width: r.width, height: r.height)
    }
}
