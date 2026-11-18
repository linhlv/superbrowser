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

RunLoop.main.run()
