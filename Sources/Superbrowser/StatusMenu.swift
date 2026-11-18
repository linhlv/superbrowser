import AppKit
import ServiceManagement
import SuperbrowserCore

/// A menu item that runs a closure.
@MainActor private final class ActionItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, state: NSControl.StateValue = .off, key: String = "", handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: key)
        target = self
        self.state = state
    }
    required init(coder: NSCoder) { fatalError() }

    @objc private func fire() { handler() }
}

/// The menu-bar item: settings, setup and status. Rebuilt every time it opens, so it always shows current state.
@MainActor final class StatusMenu: NSObject, NSMenuDelegate {
    /// Set when the local report server couldn't start; shown as a warning line.
    var serverFailed = false
    /// Slots (1…9) whose hot key the system refused for the current modifier.
    var failedSlots: [Int] = []

    private let coordinator: Coordinator
    private let allProfiles: () -> [ChromeProfile]
    private let showChecklist: () -> Void
    private let item: NSStatusItem
    private let menu = NSMenu()

    init(coordinator: Coordinator, allProfiles: @escaping () -> [ChromeProfile], showChecklist: @escaping () -> Void) {
        self.coordinator = coordinator
        self.allProfiles = allProfiles
        self.showChecklist = showChecklist
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        let image = NSImage(systemSymbolName: "rectangle.stack", accessibilityDescription: "Superbrowser")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "Superbrowser"
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
    }

    // MARK: - NSMenuDelegate

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === self.menu else { return }
        menu.removeAllItems()
        if serverFailed {
            menu.addItem(Self.warning("Local server couldn't start (port 47321 in use?)"))
            menu.addItem(.separator())
        }
        menu.addItem(submenu("Bar Position", barPositionMenu()))
        menu.addItem(submenu("Profiles", profilesMenu()))
        let warnings = shortcutWarnings()
        let shortcuts = submenu("Shortcut Keys", shortcutMenu(warnings: warnings))
        if !warnings.isEmpty {
            shortcuts.image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Warning")
        }
        menu.addItem(shortcuts)
        menu.addItem(.separator())
        menu.addItem(ActionItem("Link Profiles…") { [coordinator] in coordinator.linkUnlinkedProfiles() })
        menu.addItem(ActionItem("Setup Checklist…") { [showChecklist] in showChecklist() })
        menu.addItem(ActionItem("Launch at Login", state: Self.launchAtLoginState) { [weak self] in self?.toggleLaunchAtLogin() })
        menu.addItem(.separator())
        menu.addItem(ActionItem("Quit Superbrowser", key: "q") { NSApp.terminate(nil) })
    }

    // MARK: - Submenus

    private func submenu(_ title: String, _ sub: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        sub.autoenablesItems = false
        item.submenu = sub
        return item
    }

    private func barPositionMenu() -> NSMenu {
        let m = NSMenu()
        let current = coordinator.settings.barPosition
        for (pos, title) in [(BarPosition.left, "Left"), (.right, "Right"), (.top, "Top"), (.bottom, "Bottom")] {
            m.addItem(ActionItem(title, state: pos == current ? .on : .off) { [coordinator] in
                coordinator.updateSettings { $0.barPosition = pos }
            })
        }
        return m
    }

    private func profilesMenu() -> NSMenu {
        let m = NSMenu()
        let settings = coordinator.settings
        let all = allProfiles()
        let visible = visibleProfiles(all, settings: settings)
        let visibleDirs = Set(visible.map(\.dir))
        // Bar order first, then hidden profiles in their stored order.
        var unhidden = settings
        unhidden.hiddenProfiles = []
        let hidden = visibleProfiles(all, settings: unhidden).filter { !visibleDirs.contains($0.dir) }
        if all.isEmpty {
            let none = NSMenuItem(title: "No Chrome profiles found", action: nil, keyEquivalent: "")
            none.isEnabled = false
            m.addItem(none)
        }
        for p in visible + hidden {
            let item = NSMenuItem(title: p.name, action: nil, keyEquivalent: "")
            item.image = Self.colorDot(p.color)
            item.submenu = profileMenu(p, visibleOrder: visible.map(\.dir))
            m.addItem(item)
        }
        return m
    }

    private func profileMenu(_ p: ChromeProfile, visibleOrder: [String]) -> NSMenu {
        let m = NSMenu()
        m.autoenablesItems = false
        let settings = coordinator.settings
        let dir = p.dir
        let shown = !settings.hiddenProfiles.contains(dir)
        m.addItem(ActionItem("Show on bar", state: shown ? .on : .off) { [coordinator] in
            coordinator.updateSettings { s in
                if shown { s.hiddenProfiles.insert(dir) } else { s.hiddenProfiles.remove(dir) }
            }
        })
        let index = visibleOrder.firstIndex(of: dir)
        let up = ActionItem("Move Up") { [weak self] in self?.move(dir, up: true) }
        up.isEnabled = (index ?? 0) > 0
        let down = ActionItem("Move Down") { [weak self] in self?.move(dir, up: false) }
        down.isEnabled = index.map { $0 < visibleOrder.count - 1 } ?? false
        m.addItem(up)
        m.addItem(down)
        m.addItem(.separator())
        let fallback = settings.noExtensionProfiles.contains(dir)
        m.addItem(ActionItem("Helper extension blocked — use fallback", state: fallback ? .on : .off) { [coordinator] in
            coordinator.updateSettings { s in
                if fallback { s.noExtensionProfiles.remove(dir) } else { s.noExtensionProfiles.insert(dir) }
            }
        })
        if fallback && settings.noExtensionProfiles.count > 1 {
            m.addItem(Self.warning("Fallback works for only one profile at a time"))
        }
        return m
    }

    /// Swaps `dir` with its visible neighbour in the full stored order; hidden profiles keep their places.
    private func move(_ dir: String, up: Bool) {
        let order = movedProfileOrder(allProfiles(), settings: coordinator.settings, dir: dir, up: up)
        coordinator.updateSettings { $0.profileOrder = order }
    }

    private func shortcutMenu(warnings: [String]) -> NSMenu {
        let m = NSMenu()
        let current = coordinator.settings.hotkeyModifier
        for mod in HotkeyModifier.allCases {
            m.addItem(ActionItem("\(Self.symbol(mod))1 … \(Self.symbol(mod))9", state: mod == current ? .on : .off) { [coordinator] in
                coordinator.updateSettings { $0.hotkeyModifier = mod }
            })
        }
        if !warnings.isEmpty {
            m.addItem(.separator())
            for w in warnings { m.addItem(Self.warning(w)) }
        }
        return m
    }

    private func shortcutWarnings() -> [String] {
        let mod = coordinator.settings.hotkeyModifier
        let sym = Self.symbol(mod)
        var out: [String] = []
        let conflicts = desktopShortcutConflicts(symbolicHotKeys: Self.symbolicHotKeys(), modifier: mod)
        if !conflicts.isEmpty {
            let keys = conflicts.map { "\(sym)\($0)" }.joined(separator: ", ")
            out.append("\(keys) also switch desktops — pick another modifier or turn off “Switch to Desktop” in Keyboard Shortcuts")
        }
        if !failedSlots.isEmpty {
            out.append("Couldn't register " + failedSlots.map { "\(sym)\($0)" }.joined(separator: ", "))
        }
        return out
    }

    // MARK: - Launch at Login

    private static var launchAtLoginState: NSControl.StateValue {
        switch SMAppService.mainApp.status {
        case .enabled: .on
        case .requiresApproval: .mixed
        default: .off
        }
    }

    private func toggleLaunchAtLogin() {
        let service = SMAppService.mainApp
        let enable = service.status != .enabled && service.status != .requiresApproval
        do {
            if enable { try service.register() } else { try service.unregister() }
        } catch {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = enable ? "Couldn't turn on Launch at Login" : "Couldn't turn off Launch at Login"
            alert.informativeText = "\(error.localizedDescription)\n\nLaunch at Login works only for the installed Superbrowser.app."
            NSApp.activate()
            alert.runModal()
        }
        let status = service.status
        coordinator.updateSettings { $0.launchAtLogin = status == .enabled }
        if status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
    }

    // MARK: - Helpers

    static func symbol(_ mod: HotkeyModifier) -> String {
        switch mod {
        case .control: "⌃"
        case .controlOption: "⌃⌥"
        case .controlCommand: "⌃⌘"
        }
    }

    private static func symbolicHotKeys() -> [String: Any] {
        let app = "com.apple.symbolichotkeys" as CFString
        CFPreferencesAppSynchronize(app)
        return CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString, app) as? [String: Any] ?? [:]
    }

    private static func warning(_ text: String) -> NSMenuItem {
        let item = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        item.attributedTitle = NSAttributedString(string: text, attributes: [
            .foregroundColor: NSColor.systemRed, .font: NSFont.menuFont(ofSize: 0),
        ])
        let image = NSImage(systemSymbolName: "exclamationmark.triangle.fill", accessibilityDescription: "Warning")
        item.image = image?.withSymbolConfiguration(.init(paletteColors: [.systemRed]))
        item.isEnabled = false
        return item
    }

    static func colorDot(_ c: RGB) -> NSImage {
        let color = NSColor(srgbRed: CGFloat(c.r) / 255, green: CGFloat(c.g) / 255, blue: CGFloat(c.b) / 255, alpha: 1)
        return NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
            return true
        }
    }
}
