// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Superbrowser",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "SuperbrowserCore"),
        .executableTarget(name: "Superbrowser", dependencies: ["SuperbrowserCore"]),
        .testTarget(name: "SuperbrowserCoreTests", dependencies: ["SuperbrowserCore"]),
    ]
)
