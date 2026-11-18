import Foundation
import SuperbrowserCore

// Temporary wiring (replaced in Task 11): print every received report and every ChromeAX event.
setvbuf(stdout, nil, _IOLBF, 0)
let profiles = loadChromeProfiles()
let server = MainActor.assumeIsolated {
    ReportServer(
        onReport: { report in print("report:", report) },
        profileName: { dir in profiles.first { $0.dir == dir }?.name }
    )
}
MainActor.assumeIsolated {
    server.onStateChange = { state in
        switch state {
        case .ready: print("Superbrowser \(superbrowserVersion) listening on 127.0.0.1:47321")
        case .failed(let message): print("Superbrowser couldn't start its local server (port 47321 in use?): \(message)"); exit(1)
        }
    }
}
do { try MainActor.assumeIsolated { try server.start() } } catch { print("failed to start server: \(error)"); exit(1) }

let chrome = MainActor.assumeIsolated { ChromeAX() }

@MainActor func describe(_ r: CGRect) -> String {
    "(\(Int(r.minX)), \(Int(r.minY)), \(Int(r.width))x\(Int(r.height)))"
}

@MainActor func logWindows(_ reason: String) {
    let windows = chrome.chromeWindows()
    print("ax: \(reason): \(windows.count) window(s)")
    for w in windows {
        print("ax:   #\(w.id) \(describe(w.frame)) minimized=\(w.isMinimized) fullscreen=\(w.isFullScreen) \"\(w.title)\"")
    }
}

/// Debug commands on stdin: `list`, `frame <id> <x> <y> <w> <h>`, `raise <id>`.
@MainActor func runCommand(_ line: String) {
    let parts = line.split(separator: " ").map(String.init)
    switch parts.first {
    case "list": logWindows("list")
    case "frame" where parts.count == 6:
        let n = parts[2...].compactMap(Double.init)
        guard let id = Int(parts[1]), n.count == 4 else { break }
        let rect = CGRect(x: n[0], y: n[1], width: n[2], height: n[3])
        print("ax: setFrame #\(id) \(describe(rect))")
        chrome.setFrame(id, rect)
    case "raise" where parts.count == 2:
        guard let id = Int(parts[1]) else { break }
        print("ax: raise #\(id)")
        chrome.raise(id)
    default:
        if !line.isEmpty { print("ax: commands: list | frame <id> <x> <y> <w> <h> | raise <id>") }
    }
}

MainActor.assumeIsolated {
    chrome.onWindowsChanged = { logWindows("windows changed") }
    chrome.onWindowMoved = { id, rect in print("ax: moved #\(id) -> \(describe(rect))") }
    chrome.onFrontWindowChanged = { id in print("ax: front window -> \(id.map { "#\($0)" } ?? "none")") }
    chrome.onChromeActiveChanged = { active in print("ax: chrome active -> \(active)") }
    chrome.onChromeTerminated = { print("ax: chrome terminated") }
    chrome.start()
    logWindows("initial")
}

FileHandle.standardInput.readabilityHandler = { handle in
    let data = handle.availableData
    if data.isEmpty { handle.readabilityHandler = nil; return }
    let lines = String(decoding: data, as: UTF8.self).split(whereSeparator: \.isNewline).map(String.init)
    DispatchQueue.main.async {
        MainActor.assumeIsolated { lines.forEach { runCommand($0.trimmingCharacters(in: .whitespaces)) } }
    }
}

// Temporary demo (Task 10): `--demo-bar` cycles a hard-coded 3-tab bar through the four positions.
@MainActor final class BarDemo {
    let panel = BarPanel(onSelect: { print("bar: selected", $0) })
    var i = 0
    let tabs = [
        BarTab(profileDir: "Default", name: "Linh", color: RGB(r: 66, g: 133, b: 244), slot: 1, isActive: true, windowCount: 1, isLinked: true),
        BarTab(profileDir: "Profile 1", name: "Nguyễn Thị Hương - công việc rất dài", color: RGB(r: 219, g: 68, b: 55), slot: 2, isActive: false, windowCount: 2, isLinked: false),
        BarTab(profileDir: "Profile 2", name: "Trường", color: RGB(r: 15, g: 157, b: 88), slot: 3, isActive: false, windowCount: 0, isLinked: true),
    ]
    func show() {
        let pos = [BarPosition.top, .right, .bottom, .left][i % 4]; i += 1
        let bar = FrameLayout.split(frame: CGRect(x: 200, y: 150, width: 900, height: 600), position: pos).bar
        print("bar: position \(pos) rect \(describe(bar))")
        panel.apply(BarModel(position: pos, barRect: bar, tabs: tabs, modifier: .controlOption))
        panel.setChromeActive(true)
    }
}
if CommandLine.arguments.contains("--demo-bar") {
    MainActor.assumeIsolated {
        let demo = BarDemo()
        demo.show()
        let t = Timer(timeInterval: 2, repeats: true) { _ in MainActor.assumeIsolated { demo.show() } }
        RunLoop.main.add(t, forMode: .common)
    }
}

RunLoop.main.run()
