import AppKit
import SuperbrowserCore

/// One tab: profile-color stripe on the edge facing the content, name, hotkey hint, window badge, link warning.
@MainActor private final class TabView: NSView {
    let tab: BarTab
    private let position: BarPosition
    private let onClick: () -> Void
    private static let stripe: CGFloat = 3

    init(tab: BarTab, position: BarPosition, hintPrefix: String, onClick: @escaping () -> Void) {
        self.tab = tab; self.position = position; self.onClick = onClick
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        let name = NSTextField(labelWithString: tab.name)
        name.font = tab.isActive ? .boldSystemFont(ofSize: 12) : .systemFont(ofSize: 12)
        name.lineBreakMode = .byTruncatingTail
        name.textColor = .labelColor
        name.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        name.setContentHuggingPriority(.defaultLow, for: .horizontal)

        var views: [NSView] = [name]
        func small(_ s: String, tip: String? = nil) -> NSTextField {
            let f = NSTextField(labelWithString: s)
            f.font = .systemFont(ofSize: 10)
            f.textColor = .secondaryLabelColor
            f.toolTip = tip
            f.setContentCompressionResistancePriority(.required, for: .horizontal)
            f.setContentHuggingPriority(.required, for: .horizontal)
            return f
        }
        if tab.windowCount > 1 { views.append(small("×\(tab.windowCount)")) }
        if let slot = tab.slot { views.append(small(hintPrefix + String(slot))) }
        if !tab.isLinked {
            let bang = small("!", tip: "Helper extension not linked")
            bang.textColor = .systemOrange
            bang.font = .boldSystemFont(ofSize: 11)
            views.append(bang)
        }
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.spacing = 5
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        // Keep content clear of the stripe edge.
        let s = Self.stripe
        let inset: (top: CGFloat, bottom: CGFloat, leading: CGFloat, trailing: CGFloat) = switch position {
        case .top: (0, s, 8, 8)
        case .bottom: (s, 0, 8, 8)
        case .left: (0, 0, 8, 8 + s)
        case .right: (0, 0, 8 + s, 8)
        }
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: inset.top),
            row.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -inset.bottom),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: inset.leading),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -inset.trailing),
            row.centerYAnchor.constraint(equalTo: centerYAnchor, constant: (inset.top - inset.bottom) / 2),
        ])
        alphaValue = tab.windowCount == 0 ? 0.5 : 1
    }
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onClick() }

    override func draw(_ dirtyRect: NSRect) {
        let c = NSColor(srgbRed: CGFloat(tab.color.r) / 255, green: CGFloat(tab.color.g) / 255,
                        blue: CGFloat(tab.color.b) / 255, alpha: 1)
        if tab.isActive {
            c.withAlphaComponent(0.25).setFill()
            bounds.fill()
        }
        c.setFill()
        let s = Self.stripe, b = bounds
        let r: NSRect = switch position {
        case .top: NSRect(x: b.minX, y: b.minY, width: b.width, height: s)        // content is below
        case .bottom: NSRect(x: b.minX, y: b.maxY - s, width: b.width, height: s) // content is above
        case .left: NSRect(x: b.maxX - s, y: b.minY, width: s, height: b.height)  // content is right
        case .right: NSRect(x: b.minX, y: b.minY, width: s, height: b.height)     // content is left
        }
        r.fill()
    }
}

/// Borderless non-activating panel showing one tab per profile, attached to the managed frame.
@MainActor final class BarPanel {
    private let panel: NSPanel
    private let stack = NSStackView()
    private let onSelect: (String) -> Void
    private var model: BarModel?

    init(onSelect: @escaping (String) -> Void) {
        self.onSelect = onSelect
        panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: true)
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isFloatingPanel = false
        panel.level = .normal
        panel.hasShadow = false
        panel.isOpaque = false
        panel.backgroundColor = .clear

        let bg = NSVisualEffectView()
        bg.material = .headerView
        bg.blendingMode = .behindWindow
        bg.state = .active
        stack.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(stack)
        panel.contentView = bg
    }

    func setChromeActive(_ active: Bool) {
        panel.level = active ? .floating : .normal
    }

    func apply(_ model: BarModel) {
        guard model != self.model else { return }
        self.model = model
        let primaryHeight = NSScreen.screens.first?.frame.height ?? model.barRect.maxY
        panel.setFrame(FrameLayout.cocoaRect(fromAX: model.barRect, primaryScreenHeight: primaryHeight), display: true)
        rebuild(model)
        panel.orderFrontRegardless()
    }

    private func rebuild(_ model: BarModel) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        NSLayoutConstraint.deactivate(stack.constraints)
        guard let bg = panel.contentView else { return }
        let horizontal = model.position == .top || model.position == .bottom
        stack.orientation = horizontal ? .horizontal : .vertical
        stack.spacing = 2
        stack.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: 0, right: 0)
        stack.distribution = horizontal ? .fillEqually : .fill
        stack.alignment = horizontal ? .centerY : .leading
        let prefix: String = switch model.modifier {
        case .control: "⌃"
        case .controlOption: "⌃⌥"
        case .controlCommand: "⌃⌘"
        }
        for tab in model.tabs {
            let v = TabView(tab: tab, position: model.position, hintPrefix: prefix) { [onSelect] in onSelect(tab.profileDir) }
            stack.addArrangedSubview(v)
            if horizontal {
                v.heightAnchor.constraint(equalTo: stack.heightAnchor).isActive = true
            } else {
                v.heightAnchor.constraint(equalToConstant: 28).isActive = true
                v.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            }
        }
        var cs = [
            stack.topAnchor.constraint(equalTo: bg.topAnchor),
            stack.leadingAnchor.constraint(equalTo: bg.leadingAnchor),
        ]
        if horizontal {
            cs += [stack.bottomAnchor.constraint(equalTo: bg.bottomAnchor),
                   stack.trailingAnchor.constraint(lessThanOrEqualTo: bg.trailingAnchor)]
            // Fill the bar width when there are few tabs by capping each tab's width.
            for v in stack.arrangedSubviews { v.widthAnchor.constraint(lessThanOrEqualToConstant: 220).isActive = true }
        } else {
            cs += [stack.trailingAnchor.constraint(equalTo: bg.trailingAnchor),
                   stack.bottomAnchor.constraint(lessThanOrEqualTo: bg.bottomAnchor)]
        }
        NSLayoutConstraint.activate(cs)
    }
}
