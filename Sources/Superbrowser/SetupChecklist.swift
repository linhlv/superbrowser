import AppKit
import ApplicationServices
import SuperbrowserCore

/// First-run checklist window. Rows refresh every second while it is open; closing it marks setup done.
@MainActor final class SetupChecklist: NSObject, NSWindowDelegate {
    private static let accessibilitySettingsURL =
        URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
    private static let desktopDoneKey = "SetupChecklist.desktopAssigned"
    private static let contentWidth: CGFloat = 480
    private static let statusWidth: CGFloat = 18
    private static let textWidth: CGFloat = contentWidth - statusWidth - 10

    private let coordinator: Coordinator
    private var window: NSWindow?
    private var refreshTask: Task<Void, Never>?

    // Row 1: Accessibility
    private let axStatus = SetupChecklist.statusLabel()
    private let axDetail = SetupChecklist.detailLabel()
    private lazy var axGrant = button("Grant…") { [weak self] in self?.grantAccessibility() }
    // Row 2: helper extension
    private let linkStatus = SetupChecklist.statusLabel()
    private let linkDetail = SetupChecklist.detailLabel()
    private lazy var linkButton = button("Link Profiles") { [weak self] in self?.coordinator.linkUnlinkedProfiles() }
    // Row 3: one desktop
    private let desktopStatus = SetupChecklist.statusLabel()
    private lazy var desktopDone: NSButton = {
        let b = NSButton(checkboxWithTitle: "Done", target: self, action: #selector(desktopDoneChanged))
        b.state = UserDefaults.standard.bool(forKey: Self.desktopDoneKey) ? .on : .off
        return b
    }()
    // Row 4: restart Chrome
    private let restartStatus = SetupChecklist.statusLabel()
    private let restartDetail = SetupChecklist.detailLabel()
    private lazy var quitChrome = button("Quit Chrome") { [weak self] in self?.confirmQuitChrome() }
    // Row 5: bar position
    private let positions: [BarPosition] = [.left, .right, .top, .bottom]
    private lazy var positionPicker: NSSegmentedControl = {
        let c = NSSegmentedControl(labels: ["Left", "Right", "Top", "Bottom"], trackingMode: .selectOne,
                                   target: self, action: #selector(positionChanged))
        return c
    }()

    private var buttonActions: [ObjectIdentifier: () -> Void] = [:]

    init(coordinator: Coordinator) {
        self.coordinator = coordinator
    }

    func show() {
        if window == nil { window = makeWindow() }
        refresh()
        NSApp.activate()
        window?.makeKeyAndOrderFront(nil)
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self else { return }
                self.refresh()
            }
        }
    }

    // MARK: - NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        refreshTask?.cancel()
        refreshTask = nil
        if !coordinator.settings.setupDone {
            coordinator.updateSettings { $0.setupDone = true }
        }
    }

    // MARK: - Live state

    private func refresh() {
        let trusted = AXIsProcessTrusted()
        set(axStatus, done: trusted)
        axDetail.stringValue = trusted
            ? "Granted. Superbrowser can move Chrome's windows."
            : "Needed to move Chrome's windows. Click Grant…, then turn on Superbrowser in Settings."
        axGrant.isHidden = trusted

        let tabs = coordinator.barModel.tabs
        let unlinked = tabs.filter { !$0.isLinked }.map(\.name)
        set(linkStatus, done: !tabs.isEmpty && unlinked.isEmpty)
        var text = "\(tabs.count - unlinked.count) of \(tabs.count) profiles"
        if !unlinked.isEmpty { text += " — not linked: " + unlinked.joined(separator: ", ") }
        linkDetail.stringValue = text
        linkButton.isEnabled = !unlinked.isEmpty

        set(desktopStatus, done: desktopDone.state == .on)

        let chromeRunning = !Self.runningChrome().isEmpty
        restartStatus.stringValue = "•"
        restartStatus.textColor = .secondaryLabelColor
        restartDetail.stringValue = chromeRunning
            ? "Chrome is running. Quit it, then open it again on the browser desktop."
            : "Chrome isn't running. Open it on the browser desktop."
        quitChrome.isEnabled = chromeRunning

        if let i = positions.firstIndex(of: coordinator.settings.barPosition) {
            positionPicker.selectedSegment = i
        }
    }

    private func set(_ status: NSTextField, done: Bool) {
        status.stringValue = done ? "✓" : "✗"
        status.textColor = done ? .systemGreen : .systemRed
    }

    // MARK: - Actions

    private func grantAccessibility() {
        // Shows the system prompt (once per app identity) that leads to Privacy & Security › Accessibility.
        _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
        refresh()
    }

    @objc private func desktopDoneChanged() {
        UserDefaults.standard.set(desktopDone.state == .on, forKey: Self.desktopDoneKey)
        refresh()
    }

    @objc private func positionChanged() {
        let i = positionPicker.selectedSegment
        guard positions.indices.contains(i) else { return }
        let pos = positions[i]
        coordinator.updateSettings { $0.barPosition = pos }
    }

    private func confirmQuitChrome() {
        let alert = NSAlert()
        alert.messageText = "Quit Google Chrome?"
        alert.informativeText = "Chrome will close all its windows. Reopen it on the browser desktop so they gather there."
        alert.addButton(withTitle: "Quit Chrome")
        alert.addButton(withTitle: "Cancel")
        let quit: () -> Void = { [weak self] in
            for app in Self.runningChrome() { app.terminate() }
            self?.refresh()
        }
        if let window {
            alert.beginSheetModal(for: window) { response in
                if response == .alertFirstButtonReturn { MainActor.assumeIsolated { quit() } }
            }
        } else if alert.runModal() == .alertFirstButtonReturn {
            quit()
        }
    }

    private static func runningChrome() -> [NSRunningApplication] {
        NSRunningApplication.runningApplications(withBundleIdentifier: ChromeAX.bundleID).filter { !$0.isTerminated }
    }

    // MARK: - Layout

    private func makeWindow() -> NSWindow {
        let rows: [NSView] = [
            row(axStatus, "Accessibility permission", detail: axDetail,
                controls: [axGrant, button("Open Settings") { NSWorkspace.shared.open(Self.accessibilitySettingsURL) }]),
            row(linkStatus, "Helper extension linked", detail: linkDetail, controls: [linkButton]),
            row(desktopStatus, "Assign Chrome to one desktop: right-click Chrome in the Dock → Options → Assign To → This Desktop",
                detail: nil, controls: [desktopDone]),
            row(restartStatus, "Quit and reopen Chrome so its windows gather on that desktop",
                detail: restartDetail, controls: [quitChrome]),
            row(Self.statusLabel("•"), "Bar position", detail: nil, controls: [positionPicker]),
        ]
        let intro = NSTextField(wrappingLabelWithString:
            "Superbrowser stacks every Chrome profile's windows in one frame with a tab bar. Finish these steps once:")
        intro.preferredMaxLayoutWidth = Self.contentWidth

        let close = NSButton(title: "Finish", target: nil, action: #selector(NSWindow.performClose(_:)))
        close.keyEquivalent = "\r"
        let footer = NSStackView()
        footer.orientation = .horizontal
        footer.addView(close, in: .trailing)

        let stack = NSStackView(views: [intro] + rows + [footer])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        footer.widthAnchor.constraint(equalToConstant: Self.contentWidth).isActive = true

        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: Self.contentWidth + 40, height: 400),
                         styleMask: [.titled, .closable], backing: .buffered, defer: true)
        w.title = "Superbrowser Setup"
        w.isReleasedWhenClosed = false
        w.delegate = self
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.widthAnchor.constraint(equalToConstant: Self.contentWidth + 40),
        ])
        w.contentView = content
        close.target = w
        content.layoutSubtreeIfNeeded()
        w.setContentSize(content.fittingSize)
        w.center()
        return w
    }

    /// Status mark | title, detail, controls (stacked so long text never pushes the controls off the row).
    private func row(_ status: NSTextField, _ title: String, detail: NSTextField?, controls: [NSView]) -> NSView {
        let titleLabel = NSTextField(wrappingLabelWithString: title)
        titleLabel.font = .systemFont(ofSize: 13, weight: .medium)
        titleLabel.preferredMaxLayoutWidth = Self.textWidth

        let buttons = NSStackView(views: controls)
        buttons.orientation = .horizontal
        buttons.spacing = 8

        let text = NSStackView(views: [titleLabel] + (detail.map { [$0] } ?? []) + [buttons])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 5
        text.setCustomSpacing(8, after: detail ?? titleLabel)
        text.widthAnchor.constraint(equalToConstant: Self.textWidth).isActive = true

        let row = NSStackView(views: [status, text])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 10
        status.widthAnchor.constraint(equalToConstant: Self.statusWidth).isActive = true
        return row
    }

    private static func statusLabel(_ initial: String = "") -> NSTextField {
        let l = NSTextField(labelWithString: initial)
        l.font = .boldSystemFont(ofSize: 14)
        l.textColor = .secondaryLabelColor
        l.alignment = .center
        return l
    }

    private static func detailLabel() -> NSTextField {
        let l = NSTextField(wrappingLabelWithString: "")
        l.font = .systemFont(ofSize: 11)
        l.textColor = .secondaryLabelColor
        l.preferredMaxLayoutWidth = textWidth
        return l
    }

    private func button(_ title: String, _ action: @escaping () -> Void) -> NSButton {
        let b = NSButton(title: title, target: self, action: #selector(buttonPressed(_:)))
        b.bezelStyle = .rounded
        buttonActions[ObjectIdentifier(b)] = action
        return b
    }

    @objc private func buttonPressed(_ sender: NSButton) {
        buttonActions[ObjectIdentifier(sender)]?()
    }
}
