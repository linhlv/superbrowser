import Foundation
import SuperbrowserCore

// Temporary wiring (replaced in Task 11): print every received report.
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
RunLoop.main.run()
