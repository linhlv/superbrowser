import AppKit
import ApplicationServices
import SuperbrowserCore

/// Chrome's standard windows through the Accessibility API.
///
/// The registry is the source of truth: `kAXWindowsAttribute` may list only windows on the current
/// Space, so a window leaves the registry only when it is destroyed, its element turns invalid, or
/// Chrome terminates — never merely because it is missing from that list.
@MainActor
final class ChromeAX: WindowSystem {
    nonisolated static let bundleID = "com.google.Chrome"

    var onWindowsChanged: (() -> Void)?
    /// A user move/resize (debounced), or the actual frame when Chrome didn't honour a `setFrame`.
    var onWindowMoved: ((WindowID, CGRect) -> Void)?
    var onFrontWindowChanged: ((WindowID?) -> Void)?
    var onChromeActiveChanged: ((Bool) -> Void)?
    /// The attached Chrome quit (fired before the matching `onWindowsChanged`).
    var onChromeTerminated: (() -> Void)?

    private static let moveDebounce: Duration = .milliseconds(150)
    private static let ownMoveSettle: Duration = .milliseconds(250)
    private static let changeDebounce: Duration = .milliseconds(100)
    private static let trustPoll: Duration = .seconds(2)
    private static let observeRetry: Duration = .milliseconds(500)
    private static let slowObserveRetry: Duration = .seconds(5)
    private static let quickObserveAttempts = 6
    private static let messagingTimeout: Float = 1.0
    private static let appNotifications = [kAXWindowCreatedNotification, kAXFocusedWindowChangedNotification,
                                           kAXMainWindowChangedNotification]
    private static let windowNotifications = [kAXMovedNotification, kAXResizedNotification,
                                              kAXUIElementDestroyedNotification]
    private static let ownMoveTolerance: CGFloat = 2

    private struct Entry {
        let element: AXUIElement
        var info: AXWindowInfo
        var isStandard: Bool
    }

    private enum ReadResult { case ok, invalid }

    private var registry: [WindowID: Entry] = [:]
    private var nextID: WindowID = 1

    private var app: NSRunningApplication?
    private var appElement: AXUIElement?
    private var observer: AXObserver?

    /// Pending trailing-debounce tasks for user moves, per window.
    private var moveTasks: [WindowID: Task<Void, Never>] = [:]
    /// Windows inside a `setFrame` call or its settle period, with the requested rect and the settle task.
    private var settling: [WindowID: (rect: CGRect, task: Task<Void, Never>?)] = [:]
    private var changeTask: Task<Void, Never>?
    private var trustTask: Task<Void, Never>?
    private var observeTask: Task<Void, Never>?
    private var workspaceTokens: [NSObjectProtocol] = []
    private var started = false
    private var warnedUntrusted = false

    var isChromeActive: Bool { NSWorkspace.shared.frontmostApplication?.bundleIdentifier == Self.bundleID }

    init() {}

    isolated deinit {
        detach()
        for token in workspaceTokens { NSWorkspace.shared.notificationCenter.removeObserver(token) }
        trustTask?.cancel()
    }

    // MARK: - Lifecycle

    func start() {
        guard !started else { return }
        started = true
        // Don't let a busy Chrome stall the main thread for the default ~6 s per AX call.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), Self.messagingTimeout)
        observe(NSWorkspace.didLaunchApplicationNotification) { me, _ in me.chromeLaunched() }
        observe(NSWorkspace.didTerminateApplicationNotification) { me, pid in me.chromeTerminated(pid: pid) }
        observe(NSWorkspace.didActivateApplicationNotification) { me, _ in me.onChromeActiveChanged?(true) }
        observe(NSWorkspace.didDeactivateApplicationNotification) { me, _ in me.onChromeActiveChanged?(false) }

        if AXIsProcessTrusted() {
            attachToRunningChrome()
        } else {
            warnUntrusted()
            pollForTrust()
        }
    }

    /// Observes an `NSWorkspace` app notification, filtered to Chrome; `action` gets Chrome's pid.
    private func observe(_ name: Notification.Name, _ action: @escaping @MainActor (ChromeAX, pid_t) -> Void) {
        let token = NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
            guard let running = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  running.bundleIdentifier == ChromeAX.bundleID else { return }
            let pid = running.processIdentifier
            MainActor.assumeIsolated {
                guard let self else { return }
                action(self, pid)
            }
        }
        workspaceTokens.append(token)
    }

    private func chromeLaunched() {
        guard app == nil, AXIsProcessTrusted() else { return }
        attachToRunningChrome()
        scheduleWindowsChanged()
    }

    private func chromeTerminated(pid: pid_t) {
        // `open -na` briefly starts a second Chrome process that hands off and exits; ignore it.
        guard let app, app.processIdentifier == pid else { return }
        detach()
        onChromeTerminated?()
        if AXIsProcessTrusted() { attachToRunningChrome() }
        scheduleWindowsChanged()
    }

    /// Lists the running Chrome's windows right away; observing them follows, retrying until Chrome is ready.
    private func attachToRunningChrome() {
        // The oldest instance: a transient `open -na` process must not be mistaken for Chrome.
        guard app == nil,
              let running = NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID)
                .filter({ !$0.isTerminated })
                .min(by: { ($0.launchDate ?? .distantFuture) < ($1.launchDate ?? .distantFuture) }) else { return }
        app = running
        appElement = AXUIElementCreateApplication(running.processIdentifier)
        scanWindows()
        startObserving(attempt: 1)
    }

    private func startObserving(attempt: Int) {
        guard observer == nil, let app, let appElement else { return }
        var created: AXObserver?
        var error = AXObserverCreate(app.processIdentifier, axCallback, &created)
        if error == .success, let observer = created {
            let refcon = Unmanaged.passUnretained(self).toOpaque()
            let failures = Self.appNotifications
                .map { AXObserverAddNotification(observer, appElement, $0 as CFString, refcon) }
                .filter { $0 != .success && $0 != .notificationAlreadyRegistered }
            if failures.isEmpty {
                CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
                self.observer = observer
                for entry in registry.values { subscribe(entry.element) }
                if scanWindows() { scheduleWindowsChanged() }
                return
            }
            error = failures[0]
            for name in Self.appNotifications { AXObserverRemoveNotification(observer, appElement, name as CFString) }
        }
        // Chrome may not be ready for AX right after launching: retry quickly, then keep trying slowly.
        if attempt == Self.quickObserveAttempts {
            log("couldn't observe Chrome yet (AX error \(error.rawValue)); retrying every 5 s")
        }
        let delay = attempt < Self.quickObserveAttempts ? Self.observeRetry : Self.slowObserveRetry
        observeTask?.cancel()
        observeTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            self.startObserving(attempt: attempt + 1)
        }
    }

    private func detach() {
        observeTask?.cancel(); observeTask = nil
        if let observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        }
        for task in moveTasks.values { task.cancel() }
        for entry in settling.values { entry.task?.cancel() }
        moveTasks = [:]
        settling = [:]
        registry = [:]
        observer = nil
        appElement = nil
        app = nil
    }

    private func pollForTrust() {
        trustTask?.cancel()
        trustTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.trustPoll)
                guard let self else { return }
                if AXIsProcessTrusted() {
                    self.log("Accessibility access granted")
                    self.attachToRunningChrome()
                    self.scheduleWindowsChanged()
                    return
                }
            }
        }
    }

    private func warnUntrusted() {
        guard !warnedUntrusted else { return }
        warnedUntrusted = true
        log("Accessibility access not granted (AXIsProcessTrusted() is false); no Chrome windows are visible")
    }

    // MARK: - WindowSystem

    func chromeWindows() -> [AXWindowInfo] {
        guard AXIsProcessTrusted() else { warnUntrusted(); return [] }
        if app == nil { attachToRunningChrome() }
        guard app != nil else { return [] }
        scanWindows()
        var removed = false
        for id in registry.keys where refresh(id) == .invalid {
            forget(id)
            removed = true
        }
        if removed { scheduleWindowsChanged() }
        return registry.values.filter(\.isStandard).map(\.info).sorted { $0.id < $1.id }
    }

    func setFrame(_ id: WindowID, _ rect: CGRect) {
        guard let element = registry[id]?.element else { return }
        moveTasks.removeValue(forKey: id)?.cancel()
        settling.removeValue(forKey: id)?.task?.cancel()
        settling[id] = (rect, nil)  // suppress move/resize notifications from here on
        // Position, size, position: Chrome clamps the size against the old position.
        let invalid = setPosition(element, rect.origin) == .invalidUIElement
            || setSize(element, rect.size) == .invalidUIElement
            || setPosition(element, rect.origin) == .invalidUIElement
        if invalid {
            settling.removeValue(forKey: id)
            forget(id)
            scheduleWindowsChanged()
            return
        }
        settling[id]?.task = Task { [weak self] in
            try? await Task.sleep(for: Self.ownMoveSettle)
            guard !Task.isCancelled, let self else { return }
            self.settled(id, requested: rect)
        }
    }

    func raise(_ id: WindowID) {
        guard let element = registry[id]?.element else { return }
        var steps: [() -> AXError] = [
            { AXUIElementSetAttributeValue(element, kAXMinimizedAttribute as CFString, kCFBooleanFalse) },
            { AXUIElementPerformAction(element, kAXRaiseAction as CFString) },
            { AXUIElementSetAttributeValue(element, kAXMainAttribute as CFString, kCFBooleanTrue) },
        ]
        if let appElement {
            steps += [
                { AXUIElementSetAttributeValue(appElement, kAXMainWindowAttribute as CFString, element) },
                { AXUIElementSetAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, element) },
            ]
        }
        for step in steps where step() == .invalidUIElement {
            forget(id)
            scheduleWindowsChanged()
            return
        }
        if let appElement {
            AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        }
        app?.activate()
    }

    // MARK: - Registry

    /// Adds standard windows newly listed by `kAXWindowsAttribute`; true if any were added. Never removes anything.
    @discardableResult
    private func scanWindows() -> Bool {
        guard let appElement else { return false }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value) == .success,
              let elements = value as? [AXUIElement] else { return false }
        var added = false
        for element in elements where lookup(element) == nil {
            if register(element) != nil { added = true }
        }
        return added
    }

    /// The window's id, registering it (and observing it, once the observer exists) if it's a new standard window.
    private func register(_ element: AXUIElement) -> WindowID? {
        if let id = lookup(element) { return id }
        guard stringAttr(element, kAXSubroleAttribute) == kAXStandardWindowSubrole else { return nil }
        let id = nextID
        nextID += 1
        let placeholder = AXWindowInfo(id: id, frame: .zero, title: "", isMinimized: false, isFullScreen: false)
        registry[id] = Entry(element: element, info: placeholder, isStandard: true)
        if refresh(id) == .invalid { registry[id] = nil; return nil }
        subscribe(element)
        return id
    }

    private func subscribe(_ element: AXUIElement) {
        guard let observer else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for name in Self.windowNotifications {
            AXObserverAddNotification(observer, element, name as CFString, refcon)
        }
    }

    private func lookup(_ element: AXUIElement) -> WindowID? {
        registry.first { CFEqual($0.value.element, element) }?.key
    }

    private func forget(_ id: WindowID) {
        guard let entry = registry.removeValue(forKey: id) else { return }
        moveTasks.removeValue(forKey: id)?.cancel()
        settling.removeValue(forKey: id)?.task?.cancel()
        if let observer {
            for name in Self.windowNotifications {
                AXObserverRemoveNotification(observer, entry.element, name as CFString)
            }
        }
    }

    /// Re-reads a registered window's attributes. A failed read keeps the last value; after a timeout
    /// (`cannotComplete`) the remaining attributes aren't read either, so a hung Chrome costs one timeout.
    private func refresh(_ id: WindowID) -> ReadResult {
        guard var entry = registry[id] else { return .invalid }
        let el = entry.element
        var invalid = false
        var stop = false
        func read(_ attr: String) -> CFTypeRef? {
            guard !stop else { return nil }
            var value: CFTypeRef?
            switch AXUIElementCopyAttributeValue(el, attr as CFString, &value) {
            case .success: return value
            case .invalidUIElement: invalid = true; stop = true
            case .cannotComplete: stop = true
            default: break
            }
            return nil
        }
        if let v = read(kAXPositionAttribute), let p = point(v) { entry.info.frame.origin = p }
        if let v = read(kAXSizeAttribute), let s = size(v) { entry.info.frame.size = s }
        if let v = read(kAXTitleAttribute) as? String { entry.info.title = v }
        if let v = read(kAXMinimizedAttribute) as? Bool { entry.info.isMinimized = v }
        if let v = read("AXFullScreen") as? Bool { entry.info.isFullScreen = v }
        if let v = read(kAXSubroleAttribute) as? String { entry.isStandard = v == kAXStandardWindowSubrole }
        if invalid { return .invalid }
        registry[id] = entry
        return .ok
    }

    /// The window's current frame, or nil if it's gone (then it has been forgotten and a change scheduled).
    private func currentFrame(_ id: WindowID) -> CGRect? {
        if refresh(id) == .invalid {
            forget(id)
            scheduleWindowsChanged()
            return nil
        }
        return registry[id]?.info.frame
    }

    // MARK: - Events

    fileprivate func handle(_ notification: String, _ element: AXUIElement) {
        switch notification {
        case kAXWindowCreatedNotification:
            if register(element) != nil { scheduleWindowsChanged() }
        case kAXUIElementDestroyedNotification:
            guard let id = lookup(element) else { return }
            forget(id)
            scheduleWindowsChanged()
        case kAXFocusedWindowChangedNotification, kAXMainWindowChangedNotification:
            let known = lookup(element)
            let id = known ?? register(element)
            if known == nil, id != nil { scheduleWindowsChanged() }
            onFrontWindowChanged?(id)
        case kAXMovedNotification, kAXResizedNotification:
            guard let id = lookup(element), settling[id] == nil else { return }
            moveTasks[id]?.cancel()
            moveTasks[id] = Task { [weak self] in
                try? await Task.sleep(for: Self.moveDebounce)
                guard !Task.isCancelled, let self else { return }
                self.moveTasks[id] = nil
                if let frame = self.currentFrame(id) { self.onWindowMoved?(id, frame) }
            }
        default:
            break
        }
    }

    private func settled(_ id: WindowID, requested: CGRect) {
        settling[id] = nil
        guard let frame = currentFrame(id) else { return }
        if !frame.isWithin(Self.ownMoveTolerance, of: requested) { onWindowMoved?(id, frame) }
    }

    private func scheduleWindowsChanged() {
        changeTask?.cancel()
        changeTask = Task { [weak self] in
            try? await Task.sleep(for: Self.changeDebounce)
            guard !Task.isCancelled, let self else { return }
            self.changeTask = nil
            self.onWindowsChanged?()
        }
    }

    // MARK: - AX helpers

    private func stringAttr(_ element: AXUIElement, _ attr: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attr as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private func point(_ value: CFTypeRef) -> CGPoint? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var result = CGPoint.zero
        return AXValueGetValue(value as! AXValue, .cgPoint, &result) ? result : nil
    }

    private func size(_ value: CFTypeRef) -> CGSize? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var result = CGSize.zero
        return AXValueGetValue(value as! AXValue, .cgSize, &result) ? result : nil
    }

    @discardableResult
    private func setPosition(_ element: AXUIElement, _ point: CGPoint) -> AXError {
        var p = point
        guard let value = AXValueCreate(.cgPoint, &p) else { return .failure }
        return AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, value)
    }

    @discardableResult
    private func setSize(_ element: AXUIElement, _ size: CGSize) -> AXError {
        var s = size
        guard let value = AXValueCreate(.cgSize, &s) else { return .failure }
        return AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, value)
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(Data("ChromeAX: \(message)\n".utf8))
    }
}

/// AX observer callback. The observer's run-loop source is on the main run loop, so this runs on
/// the main thread; `refcon` is an unretained `ChromeAX` that removes the source before it goes away.
private func axCallback(_ observer: AXObserver, _ element: AXUIElement, _ notification: CFString,
                        _ refcon: UnsafeMutableRawPointer?) {
    guard let refcon else { return }
    // Safe: we're on the main thread (asserted by `assumeIsolated`), which runs the closure synchronously.
    nonisolated(unsafe) let element = element
    let address = UInt(bitPattern: refcon)
    let name = notification as String
    MainActor.assumeIsolated {
        guard let pointer = UnsafeRawPointer(bitPattern: address) else { return }
        Unmanaged<ChromeAX>.fromOpaque(pointer).takeUnretainedValue().handle(name, element)
    }
}

private extension CGRect {
    func isWithin(_ tolerance: CGFloat, of other: CGRect) -> Bool {
        abs(minX - other.minX) <= tolerance && abs(minY - other.minY) <= tolerance
            && abs(maxX - other.maxX) <= tolerance && abs(maxY - other.maxY) <= tolerance
    }
}
