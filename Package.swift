// swift-tools-version:6.0
import PackageDescription
import Foundation

// The Command Line Tools toolchain doesn't pass the swift-testing macro plugin path; add it only on CLT-only machines.
let cltTestingPlugins = "/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing"
let needsPluginPath = FileManager.default.fileExists(atPath: cltTestingPlugins)
    && !FileManager.default.fileExists(atPath: "/Applications/Xcode.app")
let testSettings: [SwiftSetting] = needsPluginPath
    ? [.unsafeFlags(["-plugin-path", cltTestingPlugins])]
    : []

let package = Package(
    name: "Superbrowser",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "SuperbrowserCore"),
        .executableTarget(name: "Superbrowser", dependencies: ["SuperbrowserCore"]),
        .testTarget(
            name: "SuperbrowserCoreTests",
            dependencies: ["SuperbrowserCore"],
            swiftSettings: testSettings
        ),
    ]
)
