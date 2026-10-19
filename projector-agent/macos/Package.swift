// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "ProjectorMac", platforms: [.macOS(.v14)], products: [.executable(name: "ProjectorMac", targets: ["ProjectorMac"]), .executable(name: "ProjectorBootstrap", targets: ["ProjectorBootstrap"])], targets: [.executableTarget(name: "ProjectorMac"), .executableTarget(name: "ProjectorBootstrap")])
