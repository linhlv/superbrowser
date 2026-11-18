import AppKit
import SuperbrowserCore

/// Builds every piece and wires their events together.
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    private var profiles: [ChromeProfile] = []
    private var chrome: ChromeAX!
    private var coordinator: Coordinator!
    private var bar: BarPanel!
    private var server: ReportServer!
    private var hotkeys: Hotkeys!
    private var statusMenu: StatusMenu!
    private var checklist: SetupChecklist!
    private var registeredModifier: HotkeyModifier?
    private var observers: [NSObjectProtocol] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        profiles = loadChromeProfiles()
        let chrome = ChromeAX()
        let coordinator = Coordinator(windows: chrome, launcher: ChromeLauncher(),
                                      store: SettingsStore(url: SettingsStore.defaultURL),
                                      profiles: profiles, screens: Self.axScreens())
        self.chrome = chrome
        self.coordinator = coordinator
        log("Superbrowser \(superbrowserVersion) starting; \(profiles.count) Chrome profile(s)")

        bar = BarPanel(onSelect: { [weak coordinator] dir in coordinator?.activate(profileDir: dir) })
        coordinator.onBarChange = { [weak self] model in self?.barChanged(model) }

        checklist = SetupChecklist(coordinator: coordinator)
        statusMenu = StatusMenu(coordinator: coordinator,
                                allProfiles: { [weak self] in
                                    self?.refreshProfiles()
                                    return self?.profiles ?? []
                                },
                                showChecklist: { [weak self] in self?.checklist.show() })

        hotkeys = Hotkeys(onSlot: { [weak coordinator] slot in coordinator?.activate(slot: slot) })
        registerHotkeys(coordinator.settings.hotkeyModifier)

        startServer(coordinator)

        chrome.onWindowsChanged = { [weak coordinator] in coordinator?.windowsChanged() }
        chrome.onWindowMoved = { [weak coordinator] id, rect in coordinator?.windowMoved(id, to: rect) }
        chrome.onFrontWindowChanged = { [weak coordinator] id in coordinator?.frontWindowChanged(id) }
        chrome.onChromeTerminated = { [weak coordinator] in coordinator?.chromeTerminated() }
        chrome.onChromeActiveChanged = { [weak self] active in
            guard let self else { return }
            self.coordinator.chromeActiveChanged(active)
            self.bar.setChromeActive(active)
            if active { self.refreshProfiles() }
        }
        chrome.start()
        coordinator.chromeActiveChanged(chrome.isChromeActive)
        bar.setChromeActive(chrome.isChromeActive)
        coordinator.windowsChanged()
        bar.apply(coordinator.barModel)

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didBecomeActiveNotification,
                                            object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshProfiles() }
        })
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                            object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.coordinator.screensChanged(Self.axScreens())
                // The AX bar rect may be unchanged while its Cocoa position (primary height) moved.
                self.bar.apply(self.coordinator.barModel, force: true)
            }
        })
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.chrome.isChromeActive else { return }
                self.bar.setChromeActive(true)   // re-homes the bar onto Chrome's desktop if needed
            }
        })

        if !coordinator.settings.setupDone { checklist.show() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    // MARK: - Wiring

    private func startServer(_ coordinator: Coordinator) {
        let server = ReportServer(
            onReport: { [weak coordinator] report in coordinator?.receive(report) },
            profileName: { [weak self] dir in self?.profiles.first { $0.dir == dir }?.name })
        server.onStateChange = { [weak self] state in
            switch state {
            case .ready:
                self?.statusMenu.serverFailed = false
                log("listening on 127.0.0.1:47321")
            case .failed(let message):
                self?.serverFailed(message)
            }
        }
        self.server = server
        do { try server.start() } catch { serverFailed("\(error)") }
    }

    private func serverFailed(_ message: String) {
        statusMenu.serverFailed = true
        log("local server couldn't start (port 47321 in use?): \(message); continuing without extension reports")
    }

    private func barChanged(_ model: BarModel) {
        bar.apply(model)
        if model.modifier != registeredModifier { registerHotkeys(model.modifier) }
    }

    private func registerHotkeys(_ modifier: HotkeyModifier) {
        registeredModifier = modifier
        let failed = hotkeys.register(modifier: modifier)
        statusMenu.failedSlots = failed
        if !failed.isEmpty {
            log("couldn't register shortcuts for slot(s) \(failed.map(String.init).joined(separator: ", "))")
        }
    }

    /// Re-reads Chrome's `Local State`; tells the coordinator only when the list changed.
    private func refreshProfiles() {
        let fresh = loadChromeProfiles()
        guard fresh != profiles else { return }
        profiles = fresh
        coordinator.updateProfiles(fresh)
    }

    /// Each screen's visible frame in AX coordinates (origin top-left of the primary screen).
    private static func axScreens() -> [CGRect] {
        let screens = NSScreen.screens
        guard let primaryHeight = screens.first?.frame.height else { return [] }
        return screens.map { FrameLayout.axRect(fromCocoa: $0.visibleFrame, primaryScreenHeight: primaryHeight) }
    }
}

func log(_ message: String) {
    FileHandle.standardError.write(Data("Superbrowser: \(message)\n".utf8))
}
