// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Superbrowser",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "SuperbrowserCore"),
        .executableTarget(name: "Superbrowser", dependencies: ["SuperbrowserCore"]),
        .testTarget(
            name: "SuperbrowserCoreTests",
            dependencies: ["SuperbrowserCore"],
            // Command Line Tools toolchain doesn't pass the swift-testing macro plugin path.
            swiftSettings: [.unsafeFlags(["-plugin-path", "/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing"])]
        ),
    ]
)
